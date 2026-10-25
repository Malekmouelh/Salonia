import "server-only";
import { addDays, dayKey, startOfLocalDay, startOfLocalWeek } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import type { BlockKind, BookingStatus, TimeOffKind } from "@/lib/enums";
import { AvailabilityBlock, Booking } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { parseStoredHours } from "@/lib/team/hours";
import {
  overlapsDay,
  planningHours,
  resolveWeekStart,
  weekDays,
  type PlanningBlock,
  type PlanningBooking,
  type PlanningDayData,
  type PlanningTimeOff,
} from "@/lib/team/planning";
import { teamCenters } from "@/lib/team/scope";

// F4 — Planning personnel d'un employé, LECTURE SEULE. Aucune écriture : aucun rendez-vous, absence, bloc ou horaire
// n'est créé, modifié, déplacé ni annulé ici. Les horaires, absences et pauses affichés sont informatifs : le calcul
// des créneaux de réservation (lib/booking/) ne les lit pas pour les absences et horaires personnalisés.

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export type StaffPlanning = {
  staff: { id: string; firstName: string; lastName: string; jobTitle: string | null; isSelf: boolean };
  weekStart: string; // lundi, YYYY-MM-DD
  prevWeek: string;
  nextWeek: string;
  currentWeek: string;
  today: string;
  // Centres de l'employé visibles pour celui qui consulte (utile pour afficher le centre de chaque rendez-vous).
  centers: { id: string; name: string }[];
  days: PlanningDayData[];
  // Rendez-vous de la semaine hors annulés (un rendez-vous qui passe minuit n'est compté qu'une fois).
  bookingCount: number;
};

export type PlanningResult = { ok: true; planning: StaffPlanning } | { ok: false; reason: "forbidden" | "not-found" };

// Planning d'une semaine (lundi → dimanche, heure de Tunis).
//  • STAFF : uniquement le sien, quel que soit le paramètre « staffId » demandé ; centres = ses affectations.
//  • MANAGER : un employé affecté à au moins un de ses centres ; rendez-vous limités à ses centres.
//  • OWNER : tout employé de son organisation.
//  • Autres rôles : refusé.
// « week » : n'importe quel jour de la semaine voulue (YYYY-MM-DD), semaine courante si invalide. « now » est injectable (tests).
export async function getStaffPlanning(
  user: CurrentUser,
  options: { staffId?: string | null; week?: string | null; now?: Date } = {},
): Promise<PlanningResult> {
  const organization = user.organization;
  if (!organization) return { ok: false, reason: "forbidden" };
  const now = options.now ?? new Date();

  let targetId: string;
  let scope: { id: string; name: string }[]; // centres dont l'utilisateur peut voir les rendez-vous
  if (user.role === "STAFF") {
    targetId = user.id;
    scope = organization.centers.filter((c) => user.centerIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name }));
  } else if (user.role === "OWNER" || user.role === "MANAGER") {
    scope = teamCenters(user);
    if (scope.length === 0) return { ok: false, reason: "forbidden" };
    if (typeof options.staffId !== "string" || !OBJECT_ID.test(options.staffId)) return { ok: false, reason: "not-found" };
    targetId = options.staffId;
  } else {
    return { ok: false, reason: "forbidden" };
  }

  await connectDB();
  const target = await User.findOne({ _id: targetId, organizationId: organization.id, role: "STAFF" })
    .select("firstName lastName jobTitle workingHours centerIds")
    .lean();
  if (!target) return { ok: false, reason: "not-found" };

  const scopeIds = new Set(scope.map((c) => c.id));
  const targetCenterIds = (target.centerIds ?? []).map(String);
  // Un gérant ne voit que les employés affectés à l'un de ses centres (même règle que la liste de l'équipe).
  if (user.role !== "STAFF" && !targetCenterIds.some((id) => scopeIds.has(id))) return { ok: false, reason: "not-found" };
  const centers = scope.filter((c) => targetCenterIds.includes(c.id));
  const centerName = new Map(scope.map((c) => [c.id, c.name]));

  const weekStart = resolveWeekStart(options.week, now);
  const weekEnd = addDays(weekStart, 7);
  const days = weekDays(weekStart);
  const range = { $lt: weekEnd };

  const [bookingRows, timeOffRows, blockRows, centerRows] = await Promise.all([
    Booking.find({ organizationId: organization.id, staffId: target._id, centerId: { $in: [...scopeIds] }, start: range, end: { $gt: weekStart } })
      .sort({ start: 1, end: 1 })
      // Seuls le nom du client, les prestations et le centre sont lus : ni téléphone, ni notes, ni prix, ni risque.
      .select("start end status items packName customerId centerId")
      .populate<{ customerId: { firstName: string; lastName: string } | null }>("customerId", "firstName lastName")
      .lean(),
    // Le motif n'est jamais lu (select explicite) : il ne peut pas apparaître dans le planning.
    StaffTimeOff.find({ organizationId: organization.id, userId: target._id, start: range, end: { $gt: weekStart } })
      .select("kind start end allDay")
      .sort({ start: 1 })
      .lean(),
    AvailabilityBlock.find({
      organizationId: organization.id,
      // Pauses et fermetures des centres où l'employé travaille (et que l'utilisateur peut voir) : une fermeture d'un autre centre ne le concerne pas.
      centerId: { $in: centers.map((c) => c.id) },
      start: range,
      end: { $gt: weekStart },
      $or: [{ staffId: target._id }, { staffId: null }],
    })
      .select("kind start end staffId centerId")
      .sort({ start: 1 })
      .lean(),
    Center.find({ _id: { $in: centers.map((c) => c.id) }, organizationId: organization.id }).select("openingHours").lean(),
  ]);

  const bookings: PlanningBooking[] = bookingRows.map((b) => ({
    id: String(b._id),
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    status: b.status as BookingStatus,
    customer: b.customerId ? `${b.customerId.firstName} ${b.customerId.lastName}` : "—",
    services: b.packName ?? b.items.map((i) => i.name).join(" + "),
    center: centerName.get(String(b.centerId)) ?? "",
  }));
  const timeOff: PlanningTimeOff[] = timeOffRows.map((t) => ({ id: String(t._id), kind: t.kind as TimeOffKind, start: t.start.toISOString(), end: t.end.toISOString(), allDay: t.allDay }));
  const blocks: PlanningBlock[] = blockRows.map((b) => ({
    id: String(b._id),
    kind: b.kind as BlockKind,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    center: centerName.get(String(b.centerId)) ?? "",
    wholeCenter: !b.staffId,
  }));

  const personal = parseStoredHours(target.workingHours);
  const openingHours = centerRows.map((c) => (c.openingHours as Record<string, string | null> | null) ?? null);
  const planningDays: PlanningDayData[] = days.map((day) => ({
    key: day.key,
    weekday: day.weekday,
    hours: planningHours(personal, day, openingHours),
    bookings: bookings.filter((b) => overlapsDay(b, day)),
    timeOff: timeOff.filter((t) => overlapsDay(t, day)),
    blocks: blocks.filter((b) => overlapsDay(b, day)),
  }));

  return {
    ok: true,
    planning: {
      staff: { id: String(target._id), firstName: target.firstName, lastName: target.lastName, jobTitle: target.jobTitle?.trim() || null, isSelf: user.role === "STAFF" },
      weekStart: dayKey(weekStart),
      prevWeek: dayKey(addDays(weekStart, -7)),
      nextWeek: dayKey(addDays(weekStart, 7)),
      currentWeek: dayKey(startOfLocalWeek(now)),
      today: dayKey(startOfLocalDay(now)),
      centers,
      days: planningDays,
      bookingCount: bookings.filter((b) => b.status !== "CANCELLED").length,
    },
  };
}
