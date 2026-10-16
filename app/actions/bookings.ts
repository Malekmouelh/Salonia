"use server";

import { revalidatePath, updateTag } from "next/cache";
import { headers } from "next/headers";
import { Types } from "mongoose";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { isSlotAvailable } from "@/lib/booking/availability";
import { BookingError, createBooking, upsertCustomer } from "@/lib/booking/create";
import { cancellationMessage, waitlistOfferMessage, whatsappLink } from "@/lib/booking/messages";
import { sendDueReminders } from "@/lib/booking/reminders";
import { addMinutes, fromLocal, hhmmToMinutes, parseDayKey, toLocal } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/dal";
import { canManageCenters, resolveCenterId } from "@/lib/data/bookings";
import { isPhone, normalizePhone } from "@/lib/definitions";
import { BLOCK_KINDS, type BookingStatus } from "@/lib/enums";
import { AvailabilityBlock, Booking, Customer, Notification, WaitlistEntry } from "@/lib/models/booking";
import { Center, Organization } from "@/lib/models/core";

// Server Actions du Module 3 côté salon (calendrier, statuts, blocages, rappels, liste d'attente).
// Chaque action revérifie la session et l'accès au centre : le client n'est jamais cru sur parole.

export type ActionResult = { ok?: true; error?: string; message?: string; link?: string };

async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Charge un rendez-vous de l'organisation en vérifiant les droits de l'utilisateur.
async function loadBooking(user: CurrentUser, bookingId: string) {
  if (!user.organization || !Types.ObjectId.isValid(bookingId)) return null;
  await connectDB();
  const booking = await Booking.findOne({ _id: bookingId, organizationId: user.organization.id });
  if (!booking) return null;
  const centerOk = resolveCenterId(user, String(booking.centerId)) === String(booking.centerId);
  const staffOk = user.role !== "STAFF" || String(booking.staffId) === user.id;
  return centerOk && staffOk ? booking : null;
}

const refresh = () => {
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/clients");
};

// ── Nouveau rendez-vous saisi par le salon ──
const StaffBookingSchema = z.object({
  centerId: z.string().min(1),
  staffId: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  serviceIds: z.array(z.string()).default([]),
  packId: z.string().optional(),
  customerId: z.string().optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
  force: z.boolean().optional(),
});

export async function createStaffBooking(input: z.input<typeof StaffBookingSchema>): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user.organization || user.role === "CLIENT") return { error: "Accès refusé." };
  const parsed = StaffBookingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const d = parsed.data;

  const centerId = resolveCenterId(user, d.centerId);
  if (centerId !== d.centerId) return { error: "Accès refusé à ce centre." };
  if (user.role === "STAFF" && d.staffId !== user.id) return { error: "Vous ne pouvez créer que vos propres rendez-vous." };

  const day = parseDayKey(d.day)!;
  const p = toLocal(day);
  const start = addMinutes(fromLocal(p.year, p.month, p.day), hhmmToMinutes(d.time));

  try {
    let customerId = d.customerId;
    if (!customerId) {
      if (!d.firstName || !d.lastName || !d.phone || !isPhone(d.phone)) {
        return { error: "Renseignez le prénom, le nom et un numéro tunisien valide du client." };
      }
      const customer = await upsertCustomer(user.organization.id, {
        firstName: d.firstName,
        lastName: d.lastName,
        phone: normalizePhone(d.phone),
      });
      customerId = String(customer._id);
    }
    const { booking } = await createBooking({
      organizationId: user.organization.id,
      centerId,
      staffId: d.staffId,
      customerId,
      start,
      selection: d.packId ? { packId: d.packId } : { serviceIds: d.serviceIds },
      source: "STAFF",
      notes: d.notes,
      // Le gérant peut placer un rendez-vous hors horaires (ex. mariée tôt le matin).
      ignoreOpeningHours: d.force && canManageCenters(user),
      baseUrl: await baseUrl(),
    });
    await logEvent("BOOKING_CREATED", { userId: user.id, organizationId: user.organization.id, detail: String(booking._id) });
    refresh();
    return { ok: true, message: "Rendez-vous enregistré." };
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

// ── Changement de statut (confirmé, terminé, absent) ──
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED", "PENDING"],
  COMPLETED: ["CONFIRMED"],
  NO_SHOW: ["CONFIRMED", "COMPLETED"],
  CANCELLED: ["CONFIRMED"],
};

export async function setBookingStatus(bookingId: string, status: BookingStatus): Promise<ActionResult> {
  const user = await getCurrentUser();
  const booking = await loadBooking(user, bookingId);
  if (!booking) return { error: "Rendez-vous introuvable." };
  const from = booking.status as BookingStatus;
  if (!TRANSITIONS[from].includes(status)) return { error: "Changement de statut impossible." };
  if ((status === "COMPLETED" || status === "NO_SHOW") && booking.start > new Date()) {
    return { error: "Ce rendez-vous n'a pas encore eu lieu." };
  }
  if (from === "CANCELLED" && status === "CONFIRMED") {
    const ok = await isSlotAvailable({
      organizationId: String(booking.organizationId),
      centerId: String(booking.centerId),
      staffId: String(booking.staffId),
      start: booking.start,
      durationMinutes: (booking.end.getTime() - booking.start.getTime()) / 60000,
      excludeBookingId: String(booking._id),
      ignoreOpeningHours: true,
    });
    if (!ok) return { error: "Le créneau a été repris entre-temps." };
  }
  booking.status = status;
  if (status !== "CANCELLED") booking.cancelledAt = undefined;
  await booking.save();
  refresh();
  const labels: Record<BookingStatus, string> = {
    PENDING: "Rendez-vous remis en attente.",
    CONFIRMED: "Rendez-vous confirmé.",
    COMPLETED: "Prestation marquée comme terminée.",
    NO_SHOW: "Absence enregistrée : elle sera prise en compte par la prédiction.",
    CANCELLED: "Rendez-vous annulé.",
  };
  return { ok: true, message: labels[status] };
}

// ── Annulation (F3.5) : libère le créneau et propose de prévenir la liste d'attente ──
export async function cancelBooking(bookingId: string, reason: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const booking = await loadBooking(user, bookingId);
  if (!booking) return { error: "Rendez-vous introuvable." };
  if (booking.status === "CANCELLED") return { error: "Déjà annulé." };

  booking.status = "CANCELLED";
  booking.cancelledAt = new Date();
  booking.cancelReason = reason.slice(0, 200) || "Annulé par le salon";
  await booking.save();

  const [customer, organization] = await Promise.all([
    Customer.findById(booking.customerId).lean(),
    Organization.findById(booking.organizationId).select("name").lean(),
  ]);
  let link: string | undefined;
  if (customer && organization) {
    const message = cancellationMessage({
      firstName: customer.firstName,
      salon: organization.name,
      center: "",
      start: booking.start,
      services: booking.items.map((i) => i.name).join(", "),
    });
    link = whatsappLink(customer.phone, message);
    if (customer.remindersConsent) {
      await Notification.create({
        organizationId: booking.organizationId,
        bookingId: booking._id,
        customerId: customer._id,
        kind: "CANCELLATION",
        to: customer.phone,
        message,
      });
    }
  }
  await logEvent("BOOKING_CANCELLED", { userId: user.id, organizationId: user.organization!.id, detail: String(booking._id) });
  refresh();
  return { ok: true, message: "Rendez-vous annulé : le créneau est de nouveau libre.", link };
}

// ── Report (F3.5) ──
export async function rescheduleBooking(input: { bookingId: string; day: string; time: string; staffId?: string }): Promise<ActionResult> {
  const user = await getCurrentUser();
  const booking = await loadBooking(user, input.bookingId);
  if (!booking) return { error: "Rendez-vous introuvable." };
  const day = parseDayKey(input.day);
  if (!day || !/^\d{2}:\d{2}$/.test(input.time)) return { error: "Date ou heure invalide." };

  const staffId = input.staffId && user.role !== "STAFF" ? input.staffId : String(booking.staffId);
  const p = toLocal(day);
  const start = addMinutes(fromLocal(p.year, p.month, p.day), hhmmToMinutes(input.time));
  const duration = (booking.end.getTime() - booking.start.getTime()) / 60000;

  const ok = await isSlotAvailable({
    organizationId: String(booking.organizationId),
    centerId: String(booking.centerId),
    staffId,
    start,
    durationMinutes: duration,
    excludeBookingId: String(booking._id),
  });
  if (!ok) return { error: "Ce créneau n'est pas disponible (horaires, pause ou autre rendez-vous)." };

  booking.rescheduledFromStart = booking.start;
  booking.start = start;
  booking.end = addMinutes(start, duration);
  booking.staffId = new Types.ObjectId(staffId);
  booking.reminderSentAt = undefined;
  await booking.save();
  await logEvent("BOOKING_RESCHEDULED", { userId: user.id, organizationId: user.organization!.id, detail: String(booking._id) });
  refresh();
  return { ok: true, message: "Rendez-vous déplacé." };
}

// ── Blocage de créneau, pause, fermeture (F3.2) ──
const BlockSchema = z.object({
  centerId: z.string().min(1),
  staffId: z.string().nullable(),
  kind: z.enum(BLOCK_KINDS),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reason: z.string().trim().max(120).optional(),
});

export async function createBlock(input: z.input<typeof BlockSchema>): Promise<ActionResult> {
  const user = await getCurrentUser();
  const parsed = BlockSchema.safeParse(input);
  if (!parsed.success || !user.organization) return { error: "Formulaire invalide." };
  const d = parsed.data;
  if (resolveCenterId(user, d.centerId) !== d.centerId) return { error: "Accès refusé à ce centre." };
  // Le staff ne peut bloquer que son propre planning ; seul un gérant ferme le centre.
  if (!canManageCenters(user) && (d.staffId !== user.id || d.kind === "CLOSURE")) return { error: "Accès refusé." };

  const dayStart = parseDayKey(d.day)!;
  let start: Date;
  let end: Date;
  if (d.kind === "CLOSURE") {
    start = dayStart;
    const last = d.endDay ? parseDayKey(d.endDay)! : dayStart;
    end = addMinutes(last, 24 * 60);
  } else {
    if (!d.from || !d.to) return { error: "Indiquez l'heure de début et de fin." };
    start = addMinutes(dayStart, hhmmToMinutes(d.from));
    end = addMinutes(dayStart, hhmmToMinutes(d.to));
  }
  if (end <= start) return { error: "La fin doit être après le début." };

  await AvailabilityBlock.create({
    organizationId: user.organization.id,
    centerId: d.centerId,
    staffId: d.kind === "CLOSURE" ? null : d.staffId,
    kind: d.kind,
    start,
    end,
    reason: d.reason,
    createdBy: user.id,
  });

  // Rendez-vous déjà placés sur la période : on prévient le salon sans les supprimer.
  const conflicts = await Booking.countDocuments({
    centerId: d.centerId,
    status: { $in: ["CONFIRMED", "PENDING"] },
    start: { $lt: end },
    end: { $gt: start },
    ...(d.kind !== "CLOSURE" && d.staffId ? { staffId: d.staffId } : {}),
  });
  refresh();
  return {
    ok: true,
    message: conflicts ? `Créneau bloqué. Attention : ${conflicts} rendez-vous existant(s) sur cette période.` : "Créneau bloqué.",
  };
}

export async function deleteBlock(blockId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user.organization || !Types.ObjectId.isValid(blockId)) return { error: "Introuvable." };
  await connectDB();
  const block = await AvailabilityBlock.findOne({ _id: blockId, organizationId: user.organization.id });
  if (!block || resolveCenterId(user, String(block.centerId)) !== String(block.centerId)) return { error: "Introuvable." };
  if (!canManageCenters(user) && String(block.staffId) !== user.id) return { error: "Accès refusé." };
  await block.deleteOne();
  refresh();
  return { ok: true };
}

// ── Horaires d'ouverture du centre (F3.2) ──
const HoursSchema = z.record(z.string(), z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).nullable());

export async function saveOpeningHours(centerId: string, hours: Record<string, string | null>): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!canManageCenters(user) || resolveCenterId(user, centerId) !== centerId) return { error: "Accès refusé." };
  const parsed = HoursSchema.safeParse(hours);
  if (!parsed.success) return { error: "Format attendu : 09:00-19:00." };
  for (const range of Object.values(parsed.data)) {
    if (range && hhmmToMinutes(range.split("-")[1]) <= hhmmToMinutes(range.split("-")[0])) {
      return { error: "L'heure de fermeture doit être après l'ouverture." };
    }
  }
  await connectDB();
  await Center.updateOne({ _id: centerId, organizationId: user.organization!.id }, { openingHours: parsed.data });
  updateTag(`salon:${user.organization!.slug}`);
  refresh();
  revalidatePath("/dashboard");
  return { ok: true, message: "Horaires enregistrés." };
}

// ── Rappels manuels (F3.4) ──
export async function sendRemindersNow(centerId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!canManageCenters(user) || resolveCenterId(user, centerId) !== centerId) return { error: "Accès refusé." };
  const result = await sendDueReminders({ organizationId: user.organization!.id, centerId });
  await logEvent("REMINDERS_SENT", { userId: user.id, organizationId: user.organization!.id, detail: `${result.sent} rappel(s)` });
  refresh();
  return {
    ok: true,
    message:
      result.sent + result.skipped === 0
        ? "Aucun rappel à envoyer : tous les rendez-vous des prochaines 24 h ont déjà été prévenus."
        : `${result.sent} rappel(s) envoyé(s)${result.skipped ? `, ${result.skipped} client(s) sans consentement` : ""}.`,
  };
}

// ── Liste d'attente (F3.5) ──
export async function addToWaitlist(input: {
  centerId: string;
  serviceId: string;
  day: string;
  customerId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user.organization || resolveCenterId(user, input.centerId) !== input.centerId) return { error: "Accès refusé." };
  const day = parseDayKey(input.day);
  if (!day || !Types.ObjectId.isValid(input.serviceId)) return { error: "Formulaire invalide." };
  let customerId = input.customerId;
  if (!customerId) {
    if (!input.firstName || !input.lastName || !input.phone || !isPhone(input.phone)) {
      return { error: "Renseignez le client (nom et téléphone)." };
    }
    customerId = String(
      (await upsertCustomer(user.organization.id, { firstName: input.firstName, lastName: input.lastName, phone: normalizePhone(input.phone) }))._id,
    );
  }
  await WaitlistEntry.create({
    organizationId: user.organization.id,
    centerId: input.centerId,
    customerId,
    serviceId: input.serviceId,
    desiredDate: day,
  });
  refresh();
  return { ok: true, message: "Client ajouté à la liste d'attente." };
}

// Proposer un créneau libéré à un client : message WhatsApp prêt à envoyer.
export async function offerSlot(input: { customerId: string; start: string; waitlistId?: string; centerId: string }): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user.organization || resolveCenterId(user, input.centerId) !== input.centerId) return { error: "Accès refusé." };
  await connectDB();
  const [customer, center] = await Promise.all([
    Customer.findOne({ _id: input.customerId, organizationId: user.organization.id }).lean(),
    Center.findById(input.centerId).select("name").lean(),
  ]);
  if (!customer || !center) return { error: "Client introuvable." };
  const start = new Date(input.start);
  const message = waitlistOfferMessage({
    firstName: customer.firstName,
    salon: user.organization.name,
    center: center.name,
    start,
    services: "votre prestation",
  });
  if (input.waitlistId && Types.ObjectId.isValid(input.waitlistId)) {
    await WaitlistEntry.updateOne(
      { _id: input.waitlistId, organizationId: user.organization.id },
      { status: "OFFERED", offeredStart: start },
    );
  }
  await Notification.create({
    organizationId: user.organization.id,
    customerId: customer._id,
    kind: "WAITLIST_OFFER",
    to: customer.phone,
    message,
  });
  refresh();
  return { ok: true, link: whatsappLink(customer.phone, message) };
}

export async function removeWaitlistEntry(entryId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user.organization || !Types.ObjectId.isValid(entryId)) return { error: "Introuvable." };
  await connectDB();
  await WaitlistEntry.updateOne({ _id: entryId, organizationId: user.organization.id }, { status: "CANCELLED" });
  refresh();
  return { ok: true };
}

// ── Fiche client (F3.6) ──
export async function updateCustomer(input: { customerId: string; notes: string; remindersConsent: boolean }): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user.organization || user.role === "CLIENT" || !Types.ObjectId.isValid(input.customerId)) return { error: "Accès refusé." };
  await connectDB();
  await Customer.updateOne(
    { _id: input.customerId, organizationId: user.organization.id },
    { notes: input.notes.slice(0, 1000), remindersConsent: input.remindersConsent },
  );
  revalidatePath(`/dashboard/clients/${input.customerId}`);
  return { ok: true, message: "Fiche enregistrée." };
}

// Recherche rapide de client pour le formulaire de rendez-vous.
export async function findCustomers(query: string) {
  const user = await getCurrentUser();
  if (!user.organization || user.role === "CLIENT" || query.trim().length < 2) return [];
  await connectDB();
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(q, "i");
  const list = await Customer.find({
    organizationId: user.organization.id,
    $or: [{ firstName: re }, { lastName: re }, { phone: new RegExp(q.replace(/\s/g, "")) }],
  })
    .limit(6)
    .select("firstName lastName phone")
    .lean();
  return list.map((c) => ({ id: String(c._id), name: `${c.firstName} ${c.lastName}`, phone: c.phone }));
}
