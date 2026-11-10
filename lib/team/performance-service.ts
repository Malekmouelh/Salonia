import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { evaluatePerformance, type AskModel, type PerformanceReport } from "@/lib/ai/team-performance";
import { Booking } from "@/lib/models/booking";
import { User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { PERFORMANCE_DAYS, computeIndicators } from "./performance";
import { teamCenters } from "./scope";

// F4 — Analyse de performance d'un employé. Les droits sont vérifiés ici (testable), l'action journalise.
// Propriétaire : tout le personnel de son organisation ; gérant : le personnel affecté à au moins un de ses centres ;
// les autres rôles : rien. Un gérant n'est pas évalué (pas praticien).

export type PerformanceResult = { ok: true; staffId: string; report: PerformanceReport } | { ok: false; message: string };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MSG_NOT_FOUND = "Employé introuvable.";

export async function analyzeStaffPerformance(
  actor: CurrentUser,
  staffId: unknown,
  options: { lang?: unknown; now?: Date; ask?: AskModel } = {},
): Promise<PerformanceResult> {
  const scope = teamCenters(actor);
  // Même message pour un identifiant invalide, inconnu, d'une autre organisation ou hors périmètre : on ne révèle pas pourquoi.
  if (!actor.organization || scope.length === 0 || typeof staffId !== "string" || !OBJECT_ID.test(staffId)) return { ok: false, message: MSG_NOT_FOUND };

  await connectDB();
  const staff = await User.findOne({
    _id: staffId,
    organizationId: actor.organization.id,
    role: "STAFF",
    deactivatedAt: null,
    centerIds: { $in: scope.map((c) => new Types.ObjectId(c.id)) },
  })
    .select("jobTitle")
    .lean();
  if (!staff) return { ok: false, message: MSG_NOT_FOUND };

  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - PERFORMANCE_DAYS * 86_400_000);
  const horizon = new Date(now.getTime() + 14 * 86_400_000);
  const filter = { organizationId: actor.organization.id, staffId: staff._id };
  const [bookings, timeOff] = await Promise.all([
    Booking.find({ ...filter, start: { $gte: from, $lt: horizon } }).select("start end status totalTnd customerId items.name").lean(),
    // « reason » n'est jamais lu : un motif peut être sensible.
    StaffTimeOff.find({ organizationId: actor.organization.id, userId: staff._id, end: { $gt: from }, start: { $lt: now } }).select("start end").lean(),
  ]);

  const indicators = computeIndicators(
    bookings.map((b) => ({
      start: b.start,
      end: b.end,
      status: b.status,
      totalTnd: b.totalTnd,
      customerId: String(b.customerId),
      serviceNames: (b.items ?? []).map((i: { name?: string }) => i.name ?? "").filter(Boolean),
    })),
    timeOff,
    now,
  );
  const lang = options.lang === "ar" ? "ar" : "fr";
  const report = await evaluatePerformance(indicators, staff.jobTitle?.trim() || null, lang, options.ask);
  return { ok: true, staffId: String(staff._id), report };
}
