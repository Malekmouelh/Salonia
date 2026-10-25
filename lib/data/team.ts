import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { Service } from "@/lib/models/catalog";
import { User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { readStoredHours, type StoredWorkingHours } from "@/lib/team/hours";
import { canEditStaffHours, teamCenters } from "@/lib/team/scope";
import { buildSkillSuggestions } from "@/lib/team/skills";
import { summarizeTimeOff, type TimeOffSummary } from "@/lib/team/timeoff";

// Suggestions de compétences pour la fiche employé : celles déjà exigées par les services de l'organisation
// (Service.requiredSkills, tous services confondus), les plus utilisées d'abord.
export async function getSkillSuggestions(
  organizationId: string,
  options: { query?: string; exclude?: readonly string[]; limit?: number } = {},
) {
  await connectDB();
  // Tri par identifiant : l'ordre de lecture est stable, donc le libellé retenu pour une même compétence aussi
  // (« Coiffure » ou « coiffure » : celui du service le plus ancien).
  const services = await Service.find({ organizationId }).select("requiredSkills").sort({ _id: 1 }).lean();
  return buildSkillSuggestions(
    services.map((s) => (s.requiredSkills ?? []).map(String)),
    options,
  );
}

// ── F4 — Liste de l'équipe (lecture seule) ──

export type TeamMember = {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  skills: string[];
  // true si des horaires individuels sont définis (sinon : suit les horaires du centre).
  hasCustomHours: boolean;
  // Horaires individuels (lecture indulgente) : null = suit le centre ; jour absent = comme le centre ; null = repos.
  workingHours: StoredWorkingHours | null;
  // Droit de modifier ses horaires (règle des centres partagés : voir canEditStaffHours).
  canEditHours: boolean;
  // Absence en cours (la plus longue si plusieurs) et prochaine absence. Jamais de motif : il n'est même pas lu en base.
  timeOff: { current: TimeOffSummary | null; next: TimeOffSummary | null };
  // Centres de l'employé visibles par l'utilisateur qui consulte la liste.
  centers: { id: string; name: string }[];
};

export type TeamRoster = {
  // Centres que l'utilisateur peut consulter (pour le filtre).
  centers: { id: string; name: string }[];
  selectedCenterId: string | null;
  members: TeamMember[];
};

const EMPTY_ROSTER: TeamRoster = { centers: [], selectedCenterId: null, members: [] };

// Personnel (rôle STAFF) de l'organisation, limité aux centres que l'utilisateur gère :
// tous pour le propriétaire, ses centres d'affectation pour un gérant. Les autres rôles ne voient rien.
// Périmètre : voir teamCenters (lib/team/scope.ts). Un employé est listé s'il est affecté à au moins un centre visible.
// « now » est injectable pour des tests déterministes (résumé des absences).
export async function getTeamRoster(user: CurrentUser, options: { centerId?: string | null; now?: Date } = {}): Promise<TeamRoster> {
  const centers = teamCenters(user);
  if (!user.organization || centers.length === 0) return EMPTY_ROSTER;

  const selectedCenterId = options.centerId && centers.some((c) => c.id === options.centerId) ? options.centerId : null;
  const scope = (selectedCenterId ? [selectedCenterId] : centers.map((c) => c.id)).map((id) => new Types.ObjectId(id));

  await connectDB();
  const staff = await User.find({ organizationId: user.organization.id, role: "STAFF", centerIds: { $in: scope } })
    .select("firstName lastName jobTitle skills workingHours centerIds")
    .lean();

  // Absences non terminées des employés listés. Le champ « reason » est exclu de la lecture (select) : le résumé ne
  // peut pas le contenir, et la liste générale de l'équipe ne l'expose jamais.
  const now = options.now ?? new Date();
  const timeOffRows = staff.length
    ? await StaffTimeOff.find({ organizationId: user.organization.id, userId: { $in: staff.map((u) => u._id) }, end: { $gt: now } })
        .select("userId kind start end allDay")
        .lean()
    : [];
  const timeOffByUser = new Map<string, typeof timeOffRows>();
  for (const row of timeOffRows) {
    const key = String(row.userId);
    timeOffByUser.set(key, [...(timeOffByUser.get(key) ?? []), row]);
  }

  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const members = staff
    .map<TeamMember>((u) => {
      // Anciens comptes : jobTitle, skills et workingHours peuvent être absents ou invalides.
      const workingHours = readStoredHours(u.workingHours);
      const allCenterIds = (u.centerIds ?? []).map(String);
      return {
        id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        jobTitle: u.jobTitle?.trim() || null,
        skills: (u.skills ?? []).map(String).filter((s) => s.trim() !== ""),
        hasCustomHours: workingHours !== null,
        workingHours,
        canEditHours: canEditStaffHours(user, allCenterIds),
        timeOff: summarizeTimeOff(timeOffByUser.get(String(u._id)) ?? [], now),
        centers: allCenterIds.filter((id) => centerName.has(id)).map((id) => ({ id, name: centerName.get(id)! })),
      };
    })
    .sort((a, b) => a.firstName.localeCompare(b.firstName, "fr") || a.lastName.localeCompare(b.lastName, "fr"));

  return { centers, selectedCenterId, members };
}
