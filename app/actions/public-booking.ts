"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getDaySlots, getRangeSlotCounts, isSlotAvailable, pickLeastBusy, type Slot } from "@/lib/booking/availability";
import { BookingError, createBooking, hashManageToken, resolveItems, upsertCustomer } from "@/lib/booking/create";
import { addDays, addMinutes, parseDayKey, startOfLocalDay } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import { isPhone, normalizePhone } from "@/lib/definitions";
import { Booking, WaitlistEntry } from "@/lib/models/booking";
import { Promotion } from "@/lib/models/catalog";
import { Organization } from "@/lib/models/core";
import { getBookingClient } from "@/lib/data/booking-client";
import { isObjectId } from "@/lib/data/public-salon";

// Actions publiques de réservation (F3.3, F3.5) : appelées par la page /reserver/[slug]
// et le lien « gérer ma réservation ». Pas de session : tout est revalidé côté serveur.

const MAX_DAYS_AHEAD = 365;
const MAX_SERVICES = 6;
const RATE_LIMIT = 8; // réservations par heure et par adresse IP
const hits = new Map<string, number[]>();

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function orgBySlug(slug: string) {
  await connectDB();
  const org = await Organization.findOne({ slug }).select("_id name").lean();
  return org ? { id: String(org._id), name: org.name } : null;
}

const SelectionSchema = z.object({
  serviceIds: z.array(z.string()).max(MAX_SERVICES, "6 prestations maximum par rendez-vous.").default([]),
  packId: z.string().nullable().optional(),
  selectedOptions: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

function toSelection(s: z.infer<typeof SelectionSchema>) {
  return s.packId
    ? { packId: s.packId, selectedOptions: s.selectedOptions }
    : { serviceIds: s.serviceIds, selectedOptions: s.selectedOptions };
}

// Disponibilités d'une journée.
export async function getPublicSlots(input: {
  slug: string;
  centerId: string;
  selection: z.input<typeof SelectionSchema>;
  staffId: string | null;
  day: string;
}): Promise<{ slots: Slot[]; error?: string }> {
  const org = await orgBySlug(input.slug);
  const day = parseDayKey(input.day);
  if (!org || !day || !isObjectId(input.centerId)) return { slots: [], error: "Demande invalide." };
  if (day > addDays(new Date(), MAX_DAYS_AHEAD)) return { slots: [] };
  try {
    const selection = SelectionSchema.safeParse(input.selection);
    if (!selection.success) return { slots: [], error: selection.error.issues[0]?.message ?? "Demande invalide." };
    const { duration } = await resolveItems(org.id, toSelection(selection.data), input.centerId);
    const slots = await getDaySlots({
      organizationId: org.id,
      centerId: input.centerId,
      day,
      durationMinutes: duration,
      staffId: isObjectId(input.staffId) ? input.staffId : null,
    });
    return { slots };
  } catch (e) {
    if (e instanceof BookingError) return { slots: [], error: e.message };
    throw e;
  }
}

// Disponibilité jour par jour d'un mois entier (jusqu'à 12 mois à l'avance) pour le calendrier public.
export async function getPublicMonthAvailability(input: {
  slug: string;
  centerId: string;
  selection: z.input<typeof SelectionSchema>;
  staffId: string | null;
  month: string; // YYYY-MM
}): Promise<{ counts: Record<string, number>; durationMinutes: number }> {
  const empty = { counts: {}, durationMinutes: 0 };
  const org = await orgBySlug(input.slug);
  const m = /^(\d{4})-(\d{2})$/.exec(input.month);
  if (!org || !m || !isObjectId(input.centerId)) return empty;
  const selection = SelectionSchema.safeParse(input.selection);
  if (!selection.success) return empty;
  const { duration } = await resolveItems(org.id, toSelection(selection.data), input.centerId).catch(() => ({ duration: 0 }));
  if (!duration) return empty;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const first = parseDayKey(`${year}-${String(month).padStart(2, "0")}-01`);
  if (!first) return empty;
  const today = startOfLocalDay(new Date());
  const limit = addDays(today, MAX_DAYS_AHEAD);
  if (first > limit) return { counts: {}, durationMinutes: duration };
  const next = parseDayKey(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`)!;
  const from = first < today ? today : first;
  const to = next > limit ? limit : next;
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const counts = await getRangeSlotCounts({
    organizationId: org.id,
    centerId: input.centerId,
    from,
    days,
    durationMinutes: duration,
    staffId: isObjectId(input.staffId) ? input.staffId : null,
  });
  return { counts, durationMinutes: duration };
}

const OnlineBookingSchema = z.object({
  slug: z.string().min(1),
  centerId: z.string().refine(isObjectId),
  selection: SelectionSchema,
  staffId: z.string().nullable(),
  start: z.iso.datetime(),
  // Nom, téléphone et e-mail viennent du compte client connecté, jamais du formulaire.
  remindersConsent: z.boolean(),
  notes: z.string().trim().max(300).optional(),
  promoCode: z.string().trim().max(30).optional(),
  viaChatbot: z.boolean().optional(),
  // Champ invisible : rempli seulement par les robots.
  website: z.string().max(0).optional(),
});

export type OnlineBookingResult =
  | { ok: true; bookingId: string; manageUrl: string; start: string; staffName: string; totalTnd: number }
  | { ok?: false; error: string; field?: string };

export async function createOnlineBooking(input: z.input<typeof OnlineBookingSchema>): Promise<OnlineBookingResult> {
  const parsed = OnlineBookingSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? "Formulaire invalide.", field: String(issue?.path[0] ?? "") };
  }
  const d = parsed.data;

  // Confirmer une réservation demande un compte client (le parcours reste ouvert à tous jusque-là).
  const client = await getBookingClient();
  if (!client) return { error: "Connectez-vous ou créez votre compte client pour confirmer.", field: "auth" };
  if (client.kind !== "client") return { error: "Ce compte est un compte salon : connectez-vous avec un compte client pour réserver.", field: "auth" };
  if (!client.phone) return { error: "Ajoutez un numéro de téléphone à votre compte pour réserver.", field: "auth" };

  const ip = await clientIp();
  const recent = (hits.get(ip) ?? []).filter((t) => Date.now() - t < 3_600_000);
  if (recent.length >= RATE_LIMIT) return { error: "Trop de réservations depuis cette connexion. Réessayez plus tard." };
  hits.set(ip, [...recent, Date.now()]);

  const org = await orgBySlug(d.slug);
  if (!org) return { error: "Salon introuvable." };
  const start = new Date(d.start);
  if (start < new Date() || start > addDays(new Date(), MAX_DAYS_AHEAD)) return { error: "Ce créneau n'est plus disponible." };

  try {
    const selection = toSelection(d.selection);
    const { duration } = await resolveItems(org.id, selection, d.centerId);
    // « Peu importe le praticien » : le moins chargé parmi ceux qui sont libres.
    let staffId = isObjectId(d.staffId) ? d.staffId : null;
    if (!staffId) {
      const daySlots = await getDaySlots({ organizationId: org.id, centerId: d.centerId, day: startOfLocalDay(start), durationMinutes: duration });
      const slot = daySlots.find((s) => s.start === start.toISOString());
      if (!slot) return { error: "Ce créneau vient d'être pris. Choisissez-en un autre." };
      staffId = await pickLeastBusy(d.centerId, slot.staffIds, startOfLocalDay(start));
    }
    const customer = await upsertCustomer(org.id, {
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      email: client.email,
      remindersConsent: d.remindersConsent,
      userId: client.id,
    });
    const { booking, manageUrl } = await createBooking({
      organizationId: org.id,
      centerId: d.centerId,
      staffId: staffId!,
      customerId: String(customer._id),
      start,
      selection,
      promoCode: d.promoCode,
      source: d.viaChatbot ? "CHATBOT" : "ONLINE",
      notes: d.notes,
      baseUrl: await baseUrl(),
    });
    const staff = await Booking.findById(booking._id).populate<{ staffId: { firstName: string } }>("staffId", "firstName").lean();
    return {
      ok: true,
      bookingId: String(booking._id),
      manageUrl: manageUrl!,
      start: booking.start.toISOString(),
      staffName: staff?.staffId.firstName ?? "",
      totalTnd: booking.totalTnd,
    };
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
}

// Validation d'un code promo en temps réel lors du parcours de réservation.
export async function validatePromoCodeAction(input: {
  slug: string;
  centerId: string;
  code: string;
  selection: z.input<typeof SelectionSchema>;
}): Promise<
  | { ok: true; code: string; name: string; type: string; value: number; discountTnd: number; newTotalTnd: number }
  | { ok: false; error: string }
> {
  const org = await orgBySlug(input.slug);
  if (!org) return { ok: false, error: "Salon introuvable." };
  const rawCode = (input.code ?? "").trim().toUpperCase();
  if (!rawCode) return { ok: false, error: "Veuillez saisir un code promo." };

  const parsedSel = SelectionSchema.safeParse(input.selection);
  if (!parsedSel.success) return { ok: false, error: "Sélection invalide." };

  try {
    const sel = toSelection(parsedSel.data);
    const resolved = await resolveItems(org.id, sel, input.centerId);
    const now = new Date();
    const promo = await Promotion.findOne({
      organizationId: org.id,
      code: rawCode,
      active: true,
    }).lean();

    if (!promo) return { ok: false, error: "Code promo invalide ou inactif." };
    if (now < promo.startsAt) return { ok: false, error: "Ce code promo n'est pas encore actif." };
    if (now > promo.endsAt) return { ok: false, error: "Ce code promo a expiré." };
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      return { ok: false, error: "Ce code promo a atteint sa limite d'utilisation." };
    }
    if (promo.centerIds && promo.centerIds.length > 0) {
      const matchCenter = promo.centerIds.some((cid) => String(cid) === String(input.centerId));
      if (!matchCenter) return { ok: false, error: "Ce code promo n'est pas valable dans ce salon." };
    }
    const hasServiceFilter = promo.serviceIds && promo.serviceIds.length > 0;
    const hasPackFilter = promo.packIds && promo.packIds.length > 0;
    if (hasServiceFilter || hasPackFilter) {
      const matchesService = hasServiceFilter && resolved.items.some((it) => promo.serviceIds.some((sid) => String(sid) === String(it.serviceId)));
      const matchesPack = Boolean(hasPackFilter && resolved.packId && promo.packIds.some((pid) => String(pid) === String(resolved.packId)));
      if (!matchesService && !matchesPack) {
        return { ok: false, error: "Ce code promo ne s'applique pas aux prestations sélectionnées." };
      }
    }

    let discountTnd = 0;
    if (promo.type === "PERCENTAGE") {
      discountTnd = Math.round((resolved.totalTnd * promo.value) / 100);
      discountTnd = Math.min(resolved.totalTnd, Math.max(0, discountTnd));
    } else {
      discountTnd = Math.min(resolved.totalTnd, promo.value);
    }

    return {
      ok: true,
      code: promo.code!,
      name: promo.name,
      type: promo.type,
      value: promo.value,
      discountTnd,
      newTotalTnd: Math.max(0, resolved.totalTnd - discountTnd),
    };
  } catch (e) {
    return { ok: false, error: e instanceof BookingError ? e.message : "Erreur lors de la validation du code promo." };
  }
}

// Liste d'attente depuis la page publique quand une journée est complète.
export async function joinPublicWaitlist(input: {
  slug: string;
  centerId: string;
  serviceId: string;
  day: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<{ ok?: true; error?: string }> {
  const org = await orgBySlug(input.slug);
  const day = parseDayKey(input.day);
  if (!org || !day || !isObjectId(input.centerId) || !isObjectId(input.serviceId)) return { error: "Demande invalide." };
  if (input.firstName.trim().length < 2 || input.lastName.trim().length < 2 || !isPhone(input.phone)) {
    return { error: "Renseignez votre nom et un numéro tunisien valide." };
  }
  const customer = await upsertCustomer(org.id, {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phone: normalizePhone(input.phone),
  });
  const exists = await WaitlistEntry.exists({ customerId: customer._id, desiredDate: day, status: "WAITING" });
  if (!exists) {
    await WaitlistEntry.create({ organizationId: org.id, centerId: input.centerId, customerId: customer._id, serviceId: input.serviceId, desiredDate: day });
  }
  return { ok: true };
}

// ── Gérer ma réservation (lien reçu par WhatsApp/SMS) ──
const CANCEL_DEADLINE_H = 2;

async function bookingByToken(token: string) {
  if (!token || token.length < 20) return null;
  await connectDB();
  return Booking.findOne({ manageTokenHash: hashManageToken(token) });
}

export async function cancelByToken(token: string): Promise<{ ok?: true; error?: string }> {
  const booking = await bookingByToken(token);
  if (!booking || booking.status === "CANCELLED") return { error: "Réservation introuvable ou déjà annulée." };
  if (booking.start.getTime() - Date.now() < CANCEL_DEADLINE_H * 3_600_000) {
    return { error: `L'annulation en ligne est possible jusqu'à ${CANCEL_DEADLINE_H} h avant le rendez-vous. Appelez le salon.` };
  }
  booking.status = "CANCELLED";
  booking.cancelledAt = new Date();
  booking.cancelReason = "Annulé par le client en ligne";
  await booking.save();
  return { ok: true };
}

export async function rescheduleByToken(token: string, startIso: string): Promise<{ ok?: true; error?: string }> {
  const booking = await bookingByToken(token);
  if (!booking || booking.status === "CANCELLED") return { error: "Réservation introuvable." };
  if (booking.start.getTime() - Date.now() < CANCEL_DEADLINE_H * 3_600_000) {
    return { error: `Le report en ligne est possible jusqu'à ${CANCEL_DEADLINE_H} h avant le rendez-vous.` };
  }
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()) || start < new Date()) return { error: "Créneau invalide." };
  const duration = (booking.end.getTime() - booking.start.getTime()) / 60000;
  const ok = await isSlotAvailable({
    organizationId: String(booking.organizationId),
    centerId: String(booking.centerId),
    staffId: String(booking.staffId),
    start,
    durationMinutes: duration,
    excludeBookingId: String(booking._id),
  });
  if (!ok) return { error: "Ce créneau vient d'être pris. Choisissez-en un autre." };
  booking.rescheduledFromStart = booking.start;
  booking.start = start;
  booking.end = addMinutes(start, duration);
  booking.reminderSentAt = undefined;
  booking.status = "CONFIRMED";
  await booking.save();
  return { ok: true };
}

// Créneaux pour le report : même praticien, même durée, le rendez-vous lui-même exclu.
export async function getRescheduleSlots(token: string, day: string): Promise<Slot[]> {
  const booking = await bookingByToken(token);
  const date = parseDayKey(day);
  if (!booking || !date) return [];
  return getDaySlots({
    organizationId: String(booking.organizationId),
    centerId: String(booking.centerId),
    day: date,
    durationMinutes: (booking.end.getTime() - booking.start.getTime()) / 60000,
    staffId: String(booking.staffId),
    excludeBookingId: String(booking._id),
  });
}
