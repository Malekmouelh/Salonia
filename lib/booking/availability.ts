import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { AvailabilityBlock, Booking } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";
import { addDays, addMinutes, fromLocal, hoursForDay, overlaps, toLocal } from "./time";

// F3.2 — Moteur de disponibilités : horaires d'ouverture, réservations existantes,
// pauses, fermetures et créneaux bloqués.

export const SLOT_STEP_MIN = 15;
export const MIN_LEAD_MIN = 30; // pas de réservation en ligne à moins de 30 min

export type Practitioner = { id: string; firstName: string; lastName: string };
export type Slot = { start: string; end: string; staffIds: string[] };

const ACTIVE = { $ne: "CANCELLED" as const };

// Praticiens d'un centre (le Module 4 ajoutera les compétences par service).
export async function getPractitioners(organizationId: string, centerId: string): Promise<Practitioner[]> {
  await connectDB();
  const staff = await User.find({ organizationId, role: "STAFF", centerIds: new Types.ObjectId(centerId) })
    .select("firstName lastName")
    .sort({ firstName: 1 })
    .lean();
  return staff.map((s) => ({ id: String(s._id), firstName: s.firstName, lastName: s.lastName }));
}

type Busy = { staffId: string | null; start: Date; end: Date };

async function busyPeriods(centerId: string, from: Date, to: Date, excludeBookingId?: string): Promise<Busy[]> {
  const [bookings, blocks] = await Promise.all([
    Booking.find({
      centerId,
      status: ACTIVE,
      start: { $lt: to },
      end: { $gt: from },
      ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
    })
      .select("staffId start end")
      .lean(),
    AvailabilityBlock.find({ centerId, start: { $lt: to }, end: { $gt: from } })
      .select("staffId start end")
      .lean(),
  ]);
  return [
    ...bookings.map((b) => ({ staffId: String(b.staffId), start: b.start, end: b.end })),
    ...blocks.map((b) => ({ staffId: b.staffId ? String(b.staffId) : null, start: b.start, end: b.end })),
  ];
}

function isFree(busy: Busy[], staffId: string, start: Date, end: Date) {
  return !busy.some((b) => (b.staffId === null || b.staffId === staffId) && overlaps(start, end, b.start, b.end));
}

// Créneaux libres d'une journée (heure de Tunis) pour une durée donnée.
export async function getDaySlots(params: {
  organizationId: string;
  centerId: string;
  day: Date; // minuit local
  durationMinutes: number;
  staffId?: string | null; // null = peu importe
  now?: Date;
  excludeBookingId?: string;
}): Promise<Slot[]> {
  const { organizationId, centerId, day, durationMinutes } = params;
  await connectDB();
  const center = await Center.findOne({ _id: centerId, organizationId }).select("openingHours").lean();
  if (!center) return [];

  const hours = hoursForDay(center.openingHours as Record<string, string | null> | null, day);
  if (!hours) return [];

  const practitioners = await getPractitioners(organizationId, centerId);
  const staffIds = params.staffId ? practitioners.filter((p) => p.id === params.staffId).map((p) => p.id) : practitioners.map((p) => p.id);
  if (staffIds.length === 0) return [];

  const p = toLocal(day);
  const dayStart = fromLocal(p.year, p.month, p.day);
  const busy = await busyPeriods(centerId, dayStart, addDays(dayStart, 1), params.excludeBookingId);
  const earliest = addMinutes(params.now ?? new Date(), MIN_LEAD_MIN);
  return computeSlots(dayStart, hours, staffIds, busy, durationMinutes, earliest);
}

function computeSlots(
  dayStart: Date,
  hours: { open: number; close: number },
  staffIds: string[],
  busy: Busy[],
  durationMinutes: number,
  earliest: Date,
) {
  const slots: Slot[] = [];
  for (let m = hours.open; m + durationMinutes <= hours.close; m += SLOT_STEP_MIN) {
    const start = addMinutes(dayStart, m);
    const end = addMinutes(start, durationMinutes);
    if (start < earliest) continue;
    const free = staffIds.filter((id) => isFree(busy, id, start, end));
    if (free.length) slots.push({ start: start.toISOString(), end: end.toISOString(), staffIds: free });
  }
  return slots;
}

// Nombre de créneaux libres par jour sur une période (calendrier mensuel de la page publique).
// Une seule lecture en base pour toute la période, puis calcul en mémoire jour par jour.
export async function getRangeSlotCounts(params: {
  organizationId: string;
  centerId: string;
  from: Date; // minuit local
  days: number;
  durationMinutes: number;
  staffId?: string | null;
}): Promise<Record<string, number>> {
  const { organizationId, centerId, from, days, durationMinutes } = params;
  await connectDB();
  const center = await Center.findOne({ _id: centerId, organizationId }).select("openingHours").lean();
  if (!center) return {};
  const practitioners = await getPractitioners(organizationId, centerId);
  const staffIds = params.staffId ? practitioners.filter((p) => p.id === params.staffId).map((p) => p.id) : practitioners.map((p) => p.id);
  const to = addDays(from, days);
  const busy = staffIds.length ? await busyPeriods(centerId, from, to) : [];
  const earliest = addMinutes(new Date(), MIN_LEAD_MIN);

  const counts: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const dayStart = addDays(from, i);
    const key = `${toLocal(dayStart).year}-${String(toLocal(dayStart).month).padStart(2, "0")}-${String(toLocal(dayStart).day).padStart(2, "0")}`;
    const hours = hoursForDay(center.openingHours as Record<string, string | null> | null, dayStart);
    if (!hours || staffIds.length === 0 || addDays(dayStart, 1) < earliest) {
      counts[key] = 0;
      continue;
    }
    const dayBusy = busy.filter((b) => b.start < addDays(dayStart, 1) && b.end > dayStart);
    counts[key] = computeSlots(dayStart, hours, staffIds, dayBusy, durationMinutes, earliest).length;
  }
  return counts;
}

// Durée maximale d'une journée d'ouverture du centre (pour prévenir les sélections trop longues).
export function longestOpening(openingHours: Record<string, string | null> | null) {
  let max = 0;
  for (let i = 0; i < 7; i++) {
    const h = hoursForDay(openingHours, addDays(fromLocal(2026, 1, 5), i));
    if (h) max = Math.max(max, h.close - h.open);
  }
  return max;
}

// Vérification au moment d'enregistrer (le créneau a pu être pris entre-temps).
export async function isSlotAvailable(params: {
  organizationId: string;
  centerId: string;
  staffId: string;
  start: Date;
  durationMinutes: number;
  excludeBookingId?: string;
  ignoreOpeningHours?: boolean;
}) {
  const { centerId, staffId, start, durationMinutes } = params;
  const end = addMinutes(start, durationMinutes);
  await connectDB();

  if (!params.ignoreOpeningHours) {
    const center = await Center.findOne({ _id: centerId, organizationId: params.organizationId })
      .select("openingHours")
      .lean();
    const hours = center && hoursForDay(center.openingHours as Record<string, string | null> | null, start);
    if (!hours) return false;
    const local = toLocal(start);
    const startMin = local.hour * 60 + local.minute;
    if (startMin < hours.open || startMin + durationMinutes > hours.close) return false;
  }

  const busy = await busyPeriods(centerId, start, end, params.excludeBookingId);
  return isFree(busy, staffId, start, end);
}

// Choisit le praticien le moins chargé de la journée parmi ceux qui sont libres.
export async function pickLeastBusy(centerId: string, staffIds: string[], day: Date) {
  if (staffIds.length <= 1) return staffIds[0];
  const counts = await Booking.aggregate<{ _id: Types.ObjectId; n: number }>([
    {
      $match: {
        centerId: new Types.ObjectId(centerId),
        staffId: { $in: staffIds.map((id) => new Types.ObjectId(id)) },
        status: ACTIVE,
        start: { $gte: day, $lt: addDays(day, 1) },
      },
    },
    { $group: { _id: "$staffId", n: { $sum: 1 } } },
  ]);
  const load = new Map(counts.map((c) => [String(c._id), c.n]));
  return [...staffIds].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
}
