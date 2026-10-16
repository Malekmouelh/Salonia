import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { BookingSource } from "@/lib/enums";
import { Booking, Customer, Notification } from "@/lib/models/booking";
import { Pack, Service } from "@/lib/models/catalog";
import { Center, Organization, User } from "@/lib/models/core";
import { isSlotAvailable } from "./availability";
import { confirmationMessage } from "./messages";
import { addMinutes } from "./time";

export const hashManageToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class BookingError extends Error {}

type Selection = { serviceIds: string[]; packId?: null } | { serviceIds?: string[]; packId: string };

// Prestations réservées : services choisis, ou services du pack (au prix du pack).
export async function resolveItems(organizationId: string, selection: Selection) {
  await connectDB();
  if (selection.packId) {
    const pack = await Pack.findOne({ _id: selection.packId, organizationId, active: true }).lean();
    if (!pack) throw new BookingError("Ce pack n'est plus disponible.");
    const services = await Service.find({ _id: { $in: pack.serviceIds }, organizationId }).lean();
    const items = services.map((s) => ({ serviceId: s._id, name: s.name, durationMinutes: s.durationMinutes, priceTnd: s.priceTnd }));
    return { items, packId: pack._id, packName: pack.name, totalTnd: pack.priceTnd, duration: items.reduce((n, i) => n + i.durationMinutes, 0) };
  }
  const ids = (selection.serviceIds ?? []).filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) throw new BookingError("Choisissez au moins une prestation.");
  const services = await Service.find({ _id: { $in: ids }, organizationId, active: true }).lean();
  if (services.length !== ids.length) throw new BookingError("Une prestation n'est plus disponible.");
  const ordered = ids.map((id) => services.find((s) => String(s._id) === id)!);
  const items = ordered.map((s) => ({ serviceId: s._id, name: s.name, durationMinutes: s.durationMinutes, priceTnd: s.priceTnd }));
  return {
    items,
    packId: null,
    packName: undefined,
    totalTnd: items.reduce((n, i) => n + i.priceTnd, 0),
    duration: items.reduce((n, i) => n + i.durationMinutes, 0),
  };
}

// Retrouve le client par téléphone dans le salon, ou le crée.
export async function upsertCustomer(
  organizationId: string,
  data: { firstName: string; lastName: string; phone: string; email?: string | null; remindersConsent?: boolean },
) {
  await connectDB();
  const existing = await Customer.findOne({ organizationId, phone: data.phone });
  if (existing) {
    if (data.email && !existing.email) existing.email = data.email;
    if (data.remindersConsent !== undefined) existing.remindersConsent = data.remindersConsent;
    await existing.save();
    return existing;
  }
  return Customer.create({ organizationId, ...data, email: data.email || undefined });
}

export async function createBooking(params: {
  organizationId: string;
  centerId: string;
  staffId: string;
  customerId: string;
  start: Date;
  selection: Selection;
  source: BookingSource;
  notes?: string;
  status?: "CONFIRMED" | "PENDING";
  ignoreOpeningHours?: boolean;
  baseUrl?: string;
}) {
  await connectDB();
  const { organizationId, centerId, staffId, start } = params;

  const [center, staff, organization, customer] = await Promise.all([
    Center.findOne({ _id: centerId, organizationId }).select("name").lean(),
    User.findOne({ _id: staffId, organizationId, role: "STAFF", centerIds: new Types.ObjectId(centerId) }).select("_id").lean(),
    Organization.findById(organizationId).select("name").lean(),
    Customer.findOne({ _id: params.customerId, organizationId }).lean(),
  ]);
  if (!center || !organization) throw new BookingError("Centre introuvable.");
  if (!staff) throw new BookingError("Ce praticien ne travaille pas dans ce centre.");
  if (!customer) throw new BookingError("Client introuvable.");

  const resolved = await resolveItems(organizationId, params.selection);
  const available = await isSlotAvailable({
    organizationId,
    centerId,
    staffId,
    start,
    durationMinutes: resolved.duration,
    ignoreOpeningHours: params.ignoreOpeningHours,
  });
  if (!available) throw new BookingError("Ce créneau vient d'être pris. Choisissez-en un autre.");

  const token = randomBytes(24).toString("base64url");
  const booking = await Booking.create({
    organizationId,
    centerId,
    staffId,
    customerId: customer._id,
    items: resolved.items,
    packId: resolved.packId,
    packName: resolved.packName,
    totalTnd: resolved.totalTnd,
    start,
    end: addMinutes(start, resolved.duration),
    status: params.status ?? "CONFIRMED",
    source: params.source,
    notes: params.notes || undefined,
    manageTokenHash: hashManageToken(token),
  });

  // Garde-fou contre deux réservations simultanées du même créneau : la plus récente est retirée.
  const clash = await Booking.findOne({
    _id: { $lt: booking._id },
    staffId,
    status: { $ne: "CANCELLED" },
    start: { $lt: booking.end },
    end: { $gt: booking.start },
  }).lean();
  if (clash) {
    await Booking.deleteOne({ _id: booking._id });
    throw new BookingError("Ce créneau vient d'être pris. Choisissez-en un autre.");
  }

  const manageUrl = params.baseUrl ? `${params.baseUrl}/reservation/${token}` : undefined;
  if (customer.remindersConsent) {
    await Notification.create({
      organizationId,
      bookingId: booking._id,
      customerId: customer._id,
      kind: "CONFIRMATION",
      to: customer.phone,
      message: confirmationMessage({
        firstName: customer.firstName,
        salon: organization.name,
        center: center.name,
        start,
        services: resolved.packName ?? resolved.items.map((i) => i.name).join(", "),
        manageUrl,
      }),
    });
  }

  return { booking, token, manageUrl };
}
