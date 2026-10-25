"use server";

import { revalidatePath, updateTag } from "next/cache";
import { logEvent } from "@/lib/audit";
import { requireRole } from "@/lib/dal";
import {
  createStaffAccount,
  createStaffTimeOff,
  deleteStaffTimeOff,
  listStaffTimeOff,
  saveStaffHours,
  updateStaffTimeOff,
  type CreateStaffResult,
  type CreateStaffTimeOffResult,
  type DeleteStaffTimeOffResult,
  type ListStaffTimeOffResult,
  type SaveStaffHoursResult,
  type UpdateStaffTimeOffResult,
} from "@/lib/team/service";
import { timeOffAuditDetail } from "@/lib/team/timeoff";

// F4 — Server Actions de l'équipe. Les droits et la validation sont dans lib/team/service.ts ;
// l'action ajoute le journal d'audit et l'invalidation des caches.

export type CreateStaffActionResult = CreateStaffResult & { message?: string };

// Le propriétaire et les gérants créent un compte STAFF avec un mot de passe temporaire.
// Le mot de passe n'est jamais renvoyé, journalisé ni écrit dans l'audit.
export async function createStaffAction(raw: unknown): Promise<CreateStaffActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const result = await createStaffAccount(user, raw);
  if (!result.ok) return result;

  await logEvent("STAFF_CREATED", { userId: user.id, organizationId: user.organization.id, detail: `staff:${result.staff.id}` });
  // La liste des praticiens de la page publique est mise en cache : elle change avec ce compte.
  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/equipe");
  revalidatePath("/dashboard/calendar");
  return { ...result, message: "Membre du personnel ajouté." };
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
