"use server";

import { revalidatePath, updateTag } from "next/cache";
import { logEvent } from "@/lib/audit";
import { requireRole } from "@/lib/dal";
import {
  createStaffAccount,
  createStaffTimeOff,
  deactivateManager,
  deleteStaffTimeOff,
  listStaffTimeOff,
  saveStaffHours,
  updateManager,
  updateStaffTimeOff,
  type CreateStaffResult,
  type CreateStaffTimeOffResult,
  type DeactivateManagerResult,
  type DeleteStaffTimeOffResult,
  type ListStaffTimeOffResult,
  type SaveStaffHoursResult,
  type UpdateManagerResult,
  type UpdateStaffTimeOffResult,
} from "@/lib/team/service";
import { forecastCenterLoad, type ForecastResult } from "@/lib/team/forecast-service";
import { suggestPractitionerForSlot, type SuggestPractitionerResult } from "@/lib/team/assignment-service";
import { analyzeStaffPerformance, type PerformanceResult } from "@/lib/team/performance-service";
import { timeOffAuditDetail } from "@/lib/team/timeoff";

// F4 — Server Actions de l'équipe. Les droits et la validation sont dans lib/team/service.ts ;
// l'action ajoute le journal d'audit et l'invalidation des caches.

export type CreateStaffActionResult = CreateStaffResult & { message?: string };

// Le propriétaire crée des gérants et du personnel ; un gérant crée du personnel dans ses centres, avec un mot de passe temporaire.
// Le mot de passe n'est jamais renvoyé, journalisé ni écrit dans l'audit.
export async function createStaffAction(raw: unknown): Promise<CreateStaffActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await createStaffAccount(user, raw);
  if (!result.ok) return result;

  // Le détail porte l'identifiant du compte et son rôle d'accès : jamais le mot de passe ni le hash.
  await logEvent("STAFF_CREATED", { userId: user.id, organizationId: user.organization.id, detail: `staff:${result.staff.id}:${result.staff.role}` });
  // La liste des praticiens de la page publique est mise en cache : elle change avec ce compte.
  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/equipe");
  revalidatePath("/dashboard/calendar");
  return { ...result, message: result.staff.role === "MANAGER" ? "Gérant ajouté." : "Membre du personnel ajouté." };
}

// ── Gérants : centres, modification, désactivation (propriétaire seulement, voir lib/team/service.ts) ──

export type UpdateManagerActionResult = UpdateManagerResult & { message?: string };

// Affecte le gérant à un ou plusieurs centres et/ou modifie son nom. Sans changement : aucune écriture, aucun événement d'audit.
export async function updateManagerAction(managerId: unknown, raw: unknown): Promise<UpdateManagerActionResult> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await updateManager(user, managerId, raw);
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("STAFF_UPDATED", { userId: user.id, organizationId: user.organization.id, detail: `staff:${result.manager.id}:MANAGER` });
  revalidatePath("/dashboard/equipe");
  revalidatePath("/dashboard");
  return { ...result, message: "Gérant modifié." };
}

export type DeactivateManagerActionResult = DeactivateManagerResult & { message?: string };

// Désactive un gérant (rien n'est supprimé). Le gérant ne peut plus se connecter, même avec une session ouverte.
export async function deactivateManagerAction(managerId: unknown): Promise<DeactivateManagerActionResult> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await deactivateManager(user, managerId);
  if (!result.ok) return result;

  await logEvent("STAFF_DEACTIVATED", { userId: user.id, organizationId: user.organization.id, detail: `staff:${result.manager.id}:MANAGER` });
  revalidatePath("/dashboard/equipe");
  revalidatePath("/dashboard");
  return { ...result, message: "Gérant désactivé." };
}

export type SaveStaffHoursActionResult = SaveStaffHoursResult & { message?: string };

// Horaires de travail individuels d'un employé. Droits, cible et validation : voir lib/team/service.ts.
// Aucune écriture ni événement d'audit si rien ne change.
export async function saveStaffHoursAction(staffId: unknown, raw: unknown): Promise<SaveStaffHoursActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await saveStaffHours(user, staffId, raw);
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("STAFF_HOURS_UPDATED", { userId: user.id, organizationId: user.organization.id, detail: `staff:${String(staffId)}` });
  revalidatePath("/dashboard/equipe");
  return { ...result, message: "Horaires enregistrés." };
}

// ── Congés et absences (F4, étape 5c) ──
// Droits, cible, validation, chevauchements : voir lib/team/service.ts. ENREGISTREMENT SEUL : ces absences ne bloquent
// encore aucun créneau. Le motif n'apparaît jamais dans l'audit (détail = employé, type, dates).

export type CreateStaffTimeOffActionResult = CreateStaffTimeOffResult & { message?: string };
export type UpdateStaffTimeOffActionResult = UpdateStaffTimeOffResult & { message?: string };
export type DeleteStaffTimeOffActionResult = DeleteStaffTimeOffResult & { message?: string };
export type ListStaffTimeOffActionResult = ListStaffTimeOffResult;

export async function createStaffTimeOffAction(staffId: unknown, raw: unknown): Promise<CreateStaffTimeOffActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await createStaffTimeOff(user, staffId, raw);
  if (!result.ok) return result;

  await logEvent("STAFF_TIMEOFF_CREATED", { userId: user.id, organizationId: user.organization.id, detail: timeOffAuditDetail(result.timeOff) });
  revalidatePath("/dashboard/equipe");
  return { ...result, message: "Absence enregistrée." };
}

// Sans changement réel : aucune écriture (garantie par le service), aucun événement d'audit, aucune invalidation.
export async function updateStaffTimeOffAction(timeOffId: unknown, raw: unknown): Promise<UpdateStaffTimeOffActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await updateStaffTimeOff(user, timeOffId, raw);
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("STAFF_TIMEOFF_UPDATED", { userId: user.id, organizationId: user.organization.id, detail: timeOffAuditDetail(result.timeOff) });
  revalidatePath("/dashboard/equipe");
  return { ...result, message: "Absence modifiée." };
}

export async function deleteStaffTimeOffAction(timeOffId: unknown): Promise<DeleteStaffTimeOffActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await deleteStaffTimeOff(user, timeOffId);
  if (!result.ok) return result;

  await logEvent("STAFF_TIMEOFF_DELETED", { userId: user.id, organizationId: user.organization.id, detail: timeOffAuditDetail(result.deleted) });
  revalidatePath("/dashboard/equipe");
  return { ...result, message: "Absence supprimée." };
}

// Consultation détaillée d'un employé (avec motif) : réservée aux OWNER/MANAGER autorisés sur cet employé. Lecture seule :
// ni audit ni invalidation.
export async function listStaffTimeOffAction(staffId: unknown): Promise<ListStaffTimeOffActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };
  return listStaffTimeOff(user, staffId);
}

export type StaffPerformanceActionResult = PerformanceResult;

// Analyse de performance d'un employé par l'IA (Gemini) : lecture seule, propose une évaluation, ne modifie rien.
// Détail d'audit : identifiant seulement (ni note, ni indicateur, ni motif d'absence).
export async function analyzeStaffPerformanceAction(staffId: unknown, lang: unknown): Promise<StaffPerformanceActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await analyzeStaffPerformance(user, staffId, { lang });
  if (!result.ok) return result;

  await logEvent("STAFF_PERFORMANCE_ANALYZED", { userId: user.id, organizationId: user.organization.id, detail: `staff:${result.staffId}:${result.report.source}` });
  return result;
}

export type SuggestPractitionerActionResult = SuggestPractitionerResult;

// Suggestion de praticien pour un créneau (IA Gemini) : lecture seule, ne crée ni n'affecte rien.
// Détail d'audit : centre et source seulement (ni nom, ni client, ni note).
export async function suggestPractitionerAction(raw: unknown, lang: unknown): Promise<SuggestPractitionerActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await suggestPractitionerForSlot(user, raw, { lang });
  if (!result.ok) return result;

  const centerId = typeof raw === "object" && raw !== null ? String((raw as { centerId?: unknown }).centerId) : "";
  await logEvent("STAFF_ASSIGNMENT_SUGGESTED", { userId: user.id, organizationId: user.organization.id, detail: `center:${centerId}:${result.source}` });
  return result;
}

export type ForecastActionResult = ForecastResult;

// Prévision de charge d'un centre (IA Gemini) : lecture seule, propose des pistes, ne modifie rien.
// Détail d'audit : centre et source seulement.
export async function forecastCenterLoadAction(raw: unknown, lang: unknown): Promise<ForecastActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await forecastCenterLoad(user, raw, { lang });
  if (!result.ok) return result;

  const centerId = typeof raw === "object" && raw !== null ? String((raw as { centerId?: unknown }).centerId) : "";
  await logEvent("TEAM_FORECAST_VIEWED", { userId: user.id, organizationId: user.organization.id, detail: `center:${centerId}:${result.advice.source}` });
  return result;
}
