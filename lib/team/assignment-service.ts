import { Types } from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { suggestPractitioners, type Suggestion } from "@/lib/ai/team-assignment";
import type { AskModel } from "@/lib/ai/team-performance";
import { addMinutes, fromLocal, hhmmToMinutes, parseDayKey, toLocal } from "@/lib/booking/time";
import { AvailabilityBlock, Booking } from "@/lib/models/booking";
import { Service } from "@/lib/models/catalog";
import { User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { overlapsRange, skillMatch, type Candidate, type Conflict } from "./assignment";
import { PERFORMANCE_DAYS, baselineScores, computeIndicators, overallScore } from "./performance";
import { teamCenters } from "./scope";

// F4 — Suggestion de praticien (lecture seule : rien n'est créé ni affecté). Droits vérifiés ici : propriétaire ou gérant,
// centre dans son périmètre. Le contrôle de disponibilité de la création de rendez-vous (lib/booking/) reste seul juge.

export type PractitionerSuggestion = Suggestion & { name: string };
export type SuggestPractitionerResult =
  | { ok: true; source: "ai" | "offline"; blocked: number; suggestions: PractitionerSuggestion[] }
  | { ok: false; message: string };

const MSG_DENIED = "Accès refusé à ce centre.";
const Input = z.object({
  centerId: z.string().regex(/^[0-9a-f]{24}$/i),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  serviceIds: z.array(z.string().regex(/^[0-9a-f]{24}$/i)).min(1).max(10),
});
const DAY_MS = 86_400_000;
const MIN_COMPLETED_FOR_PERFORMANCE = 3;

export async function suggestPractitionerForSlot(
  actor: CurrentUser,
  raw: unknown,
  options: { lang?: unknown; now?: Date; ask?: AskModel } = {},
): Promise<SuggestPractitionerResult> {
  const scope = teamCenters(actor);
  const parsed = Input.safeParse(raw);
  if (!actor.organization || scope.length === 0 || !parsed.success) return { ok: false, message: parsed.success ? MSG_DENIED : "Choisissez une date, une heure et au moins une prestation." };
  const input = parsed.data;
  if (!scope.some((c) => c.id === input.centerId)) return { ok: false, message: MSG_DENIED };
  const dayDate = parseDayKey(input.day);
  if (!dayDate) return { ok: false, message: "Choisissez une date, une heure et au moins une prestation." };

  await connectDB();
  const orgId = actor.organization.id;
  const services = await Service.find({ _id: { $in: input.serviceIds }, organizationId: orgId }).select("name durationMinutes requiredSkills").lean();
  if (services.length !== new Set(input.serviceIds).size) return { ok: false, message: "Prestation introuvable." };

  const p = toLocal(dayDate);
  const start = addMinutes(fromLocal(p.year, p.month, p.day), hhmmToMinutes(input.time));
  const end = addMinutes(start, services.reduce((n, s) => n + (s.durationMinutes || 0), 0) || 30);
  const now = options.now ?? new Date();

  const staff = await User.find({ organizationId: orgId, role: "STAFF", deactivatedAt: null, centerIds: new Types.ObjectId(input.centerId) })
    .select("firstName lastName skills")
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  if (staff.length === 0) return { ok: true, source: "offline", blocked: 0, suggestions: [] };
  const ids = staff.map((s) => s._id);

  const from = new Date(now.getTime() - PERFORMANCE_DAYS * DAY_MS);
  const to7 = new Date(now.getTime() + 7 * DAY_MS);
  const [bookings, blocks, timeOff] = await Promise.all([
    Booking.find({ organizationId: orgId, staffId: { $in: ids }, start: { $gte: from, $lt: new Date(Math.max(to7.getTime(), end.getTime())) } })
      .select("staffId start end status totalTnd customerId items.name")
      .lean(),
    AvailabilityBlock.find({ organizationId: orgId, centerId: input.centerId, start: { $lt: end }, end: { $gt: start }, $or: [{ staffId: null }, { staffId: { $in: ids } }] })
      .select("staffId")
      .lean(),
    // « reason » n'est jamais lu : un motif d'absence peut être sensible.
    StaffTimeOff.find({ organizationId: orgId, userId: { $in: ids }, start: { $lt: end }, end: { $gt: start } }).select("userId").lean(),
  ]);

  const required = services.flatMap((s) => (s.requiredSkills ?? []).map(String));
  const centerClosed = blocks.some((b) => !b.staffId);
  const blockedStaff = new Set(blocks.filter((b) => b.staffId).map((b) => String(b.staffId)));
  const offStaff = new Set(timeOff.map((t) => String(t.userId)));

  const labels = "ABCDEFGH";
  const candidates: Candidate[] = staff.slice(0, labels.length).map((s, i) => {
    const id = String(s._id);
    const mine = bookings.filter((b) => String(b.staffId) === id);
    let conflict: Conflict = "none";
    if (centerClosed || blockedStaff.has(id)) conflict = "block";
    else if (offStaff.has(id)) conflict = "timeoff";
    else if (mine.some((b) => b.status !== "CANCELLED" && overlapsRange(b.start, b.end, start, end))) conflict = "booking";
    const loadMinutes = Math.round(
      mine.filter((b) => b.status !== "CANCELLED" && b.start >= now && b.start < to7).reduce((n, b) => n + (b.end.getTime() - b.start.getTime()) / 60_000, 0),
    );
    const indicators = computeIndicators(
      mine.map((b) => ({ start: b.start, end: b.end, status: b.status, totalTnd: b.totalTnd, customerId: String(b.customerId), serviceNames: (b.items ?? []).map((i2: { name?: string }) => i2.name ?? "") })),
      [],
      now,
    );
    return { id, label: labels[i], skillMatch: skillMatch(required, (s.skills ?? []).map(String)), conflict, loadMinutes, // Moins de 3 rendez-vous réalisés : échantillon trop faible, la performance reste inconnue (jamais 100 par défaut).
      performance: indicators.completed >= MIN_COMPLETED_FOR_PERFORMANCE ? overallScore(baselineScores(indicators)) : null };
  });

  const result = await suggestPractitioners(candidates, services.map((s) => s.name), options.lang === "ar" ? "ar" : "fr", options.ask);
  const names = new Map(staff.map((s) => [String(s._id), `${s.firstName} ${s.lastName}`]));
  return { ok: true, source: result.source, blocked: result.blocked, suggestions: result.suggestions.map((s) => ({ ...s, name: names.get(s.staffId) ?? "" })) };
}
