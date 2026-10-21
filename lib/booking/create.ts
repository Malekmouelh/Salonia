import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { BookingSource } from "@/lib/enums";
import { Booking, Customer, Notification } from "@/lib/models/booking";
import { Pack, Promotion, Service } from "@/lib/models/catalog";
import { Center, Organization, User } from "@/lib/models/core";
import { isSlotAvailable } from "./availability";
import { confirmationMessage } from "./messages";
import { addMinutes } from "./time";

export const hashManageToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class BookingError extends Error {}

export type BookingSelectedOptionInput = Record<string, Record<string, string>>; // { [serviceId]: { [optionName]: label } }

export type Selection =
  | { serviceIds: string[]; packId?: null; selectedOptions?: BookingSelectedOptionInput }
  | { serviceIds?: string[]; packId: string; selectedOptions?: BookingSelectedOptionInput };

export type ResolvedBookingItem = {
  serviceId: Types.ObjectId;
  name: string;
  durationMinutes: number;
  priceTnd: number;
  selectedOptions: {
    optionName: string;
    label: string;
    extraPriceTnd: number;
    extraDurationMinutes: number;
  }[];
};

// Tarif du centre s'il est défini, sinon prix global (F2.4).
export function resolvePrice(
  item: { priceTnd: number; centerPrices?: { centerId: unknown; priceTnd: number }[] },
  centerId?: string | null,
): number {
  if (!centerId || !item.centerPrices || item.centerPrices.length === 0) return item.priceTnd;
  const match = item.centerPrices.find((cp) => String(cp.centerId) === String(centerId));
  return match !== undefined ? match.priceTnd : item.priceTnd;
}

// Prestations réservées : services choisis (avec tarifs par centre et options), ou pack (au tarif du centre).
export async function resolveItems(organizationId: string, selection: Selection, centerId?: string | null) {
  await connectDB();
  if (selection.packId) {
    const pack = await Pack.findOne({ _id: selection.packId, organizationId, active: true }).lean();
    if (!pack) throw new BookingError("Ce pack n'est plus disponible.");
    const packPrice = resolvePrice(pack, centerId);
    const services = await Service.find({ _id: { $in: pack.serviceIds }, organizationId }).lean();
    const items: ResolvedBookingItem[] = services.map((s) => ({
      serviceId: s._id,
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceTnd: resolvePrice(s, centerId),
      selectedOptions: [],
    }));
    return {
      items,
      packId: pack._id,
      packName: pack.name,
      totalTnd: packPrice,
      duration: items.reduce((n, i) => n + i.durationMinutes, 0),
    };
  }

  const ids = (selection.serviceIds ?? []).filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) throw new BookingError("Choisissez au moins une prestation.");
  const services = await Service.find({ _id: { $in: ids }, organizationId, active: true }).lean();
  if (services.length !== ids.length) throw new BookingError("Une prestation n'est plus disponible.");

  const items: ResolvedBookingItem[] = ids.map((id) => {
    const s = services.find((srv) => String(srv._id) === id)!;
    const basePrice = resolvePrice(s, centerId);
    let durationMinutes = s.durationMinutes;
    let priceTnd = basePrice;
    const chosenOptions: ResolvedBookingItem["selectedOptions"] = [];

    const serviceChosenMap = selection.selectedOptions?.[id];
    if (serviceChosenMap && s.options && s.options.length > 0) {
      for (const opt of s.options) {
        const chosenLabel = serviceChosenMap[opt.name];
        if (chosenLabel) {
          const val = (opt.values ?? []).find((v) => v.label === chosenLabel);
          if (val) {
            const extraP = val.extraPriceTnd ?? 0;
            const extraD = val.extraDurationMinutes ?? 0;
            priceTnd += extraP;
            durationMinutes += extraD;
            chosenOptions.push({
              optionName: opt.name,
              label: val.label,
              extraPriceTnd: extraP,
              extraDurationMinutes: extraD,
            });
          }
        }
      }
    }

    return {
      serviceId: s._id,
      name: s.name,
      durationMinutes,
      priceTnd,
      selectedOptions: chosenOptions,
    };
  });

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
  data: { firstName: string; lastName: string; phone: string; email?: string | null; remindersConsent?: boolean; userId?: string | null },
) {
  await connectDB();
  // Compte client : sa fiche dans ce salon, sinon la fiche existante à son numéro (non encore reliée à un compte).
  const existing =
    (data.userId ? await Customer.findOne({ organizationId, userId: data.userId }) : null) ??
    (await Customer.findOne({ organizationId, phone: data.phone, ...(data.userId ? { userId: null } : {}) }));
  if (existing) {
    if (data.email && !existing.email) existing.email = data.email;
    if (data.remindersConsent !== undefined) existing.remindersConsent = data.remindersConsent;
    if (data.userId && !existing.userId) existing.userId = new Types.ObjectId(data.userId);
    await existing.save();
    return existing;
  }
  // Le numéro existe déjà dans ce salon, mais relié à un autre compte : on ne mélange pas les historiques.
  if (data.userId && (await Customer.exists({ organizationId, phone: data.phone }))) {
    throw new BookingError("Ce numéro est déjà associé à un autre compte dans ce salon. Contactez le salon.");
  }
  return Customer.create({ organizationId, ...data, email: data.email || undefined, userId: data.userId || undefined });
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
  promoCode?: string;
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

  const resolved = await resolveItems(organizationId, params.selection, centerId);
  const available = await isSlotAvailable({
    organizationId,
    centerId,
    staffId,
    start,
    durationMinutes: resolved.duration,
    ignoreOpeningHours: params.ignoreOpeningHours,
  });
  if (!available) throw new BookingError("Ce créneau vient d'être pris. Choisissez-en un autre.");

  // Validation du code promo si renseigné
  let promoDiscountTnd = 0;
  let promoDocId: Types.ObjectId | null = null;
  let appliedPromoCode: string | undefined = undefined;

  if (params.promoCode) {
    const normCode = params.promoCode.trim().toUpperCase();
    const now = new Date();
    const promo = await Promotion.findOne({
      organizationId,
      code: normCode,
      active: true,
    });
    if (!promo) {
      throw new BookingError("Code promo invalide.");
    }
    if (now < promo.startsAt) {
      throw new BookingError("Ce code promo n'est pas encore actif.");
    }
    if (now > promo.endsAt) {
      throw new BookingError("Ce code promo a expiré.");
    }
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      throw new BookingError("Ce code promo a atteint sa limite d'utilisation.");
    }
    if (promo.centerIds && promo.centerIds.length > 0) {
      const okCenter = promo.centerIds.some((cid) => String(cid) === String(centerId));
      if (!okCenter) throw new BookingError("Ce code promo n'est pas valable dans ce salon.");
    }
    const hasServiceFilter = promo.serviceIds && promo.serviceIds.length > 0;
    const hasPackFilter = promo.packIds && promo.packIds.length > 0;
    if (hasServiceFilter || hasPackFilter) {
      const matchesService = hasServiceFilter && resolved.items.some((it) => promo.serviceIds.some((sid) => String(sid) === String(it.serviceId)));
      const matchesPack = Boolean(hasPackFilter && resolved.packId && promo.packIds.some((pid) => String(pid) === String(resolved.packId)));
      if (!matchesService && !matchesPack) {
        throw new BookingError("Ce code promo ne s'applique pas aux prestations sélectionnées.");
      }
    }

    if (promo.type === "PERCENTAGE") {
      promoDiscountTnd = Math.round((resolved.totalTnd * promo.value) / 100);
      promoDiscountTnd = Math.min(resolved.totalTnd, Math.max(0, promoDiscountTnd));
    } else {
      promoDiscountTnd = Math.min(resolved.totalTnd, promo.value);
    }
    promoDocId = promo._id;
    appliedPromoCode = promo.code || undefined;
  }

  const token = randomBytes(24).toString("base64url");
  const finalTotalTnd = Math.max(0, resolved.totalTnd - promoDiscountTnd);

  const booking = await Booking.create({
    organizationId,
    centerId,
    staffId,
    customerId: customer._id,
    items: resolved.items,
    packId: resolved.packId,
    packName: resolved.packName,
    totalTnd: finalTotalTnd,
    promoCode: appliedPromoCode,
    discountTnd: promoDiscountTnd,
    promotionId: promoDocId,
    start,
    end: addMinutes(start, resolved.duration),
    status: params.status ?? "CONFIRMED",
    source: params.source,
    notes: params.notes || undefined,
    manageTokenHash: hashManageToken(token),
  });

  // Incrémenter l'utilisation du code promo
  if (promoDocId) {
    await Promotion.updateOne({ _id: promoDocId }, { $inc: { usedCount: 1 } });
  }

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
    if (promoDocId) {
      await Promotion.updateOne({ _id: promoDocId }, { $inc: { usedCount: -1 } });
    }
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
