import bcrypt from "bcryptjs";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import type { TimeOffKind } from "@/lib/enums";
import { Booking } from "@/lib/models/booking";
import { User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { WORKING_DAYS } from "./hours";
import { CreateStaffSchema, StaffHoursInputSchema, createStaffTimeOffSchema } from "./schemas";
import { canEditStaffHours, teamCenters } from "./scope";

// F4 — Écritures sur l'équipe. Les droits sont vérifiés ici (et non dans l'action) pour rester testables.
// Aucune donnée de ce fichier ne doit contenir le mot de passe : ni dans le résultat, ni dans les messages d'erreur.

export type CreateStaffResult =
  | { ok: true; staff: { id: string; firstName: string; lastName: string } }
  | { ok: false; message?: string; errors?: Record<string, string[]> };

const BCRYPT_ROUNDS = 12; // même coût que l'inscription (app/actions/auth.ts)
const MSG_EMAIL_TAKEN = "Cet e-mail est déjà utilisé.";
const MSG_PHONE_TAKEN = "Ce numéro est déjà utilisé.";

// Erreur MongoDB de doublon sur un index unique (création simultanée, ou index plus strict que la pré-vérification).
export function duplicateFields(error: unknown): ("email" | "phone")[] | null {
  const e = error as { code?: number; keyPattern?: Record<string, unknown>; message?: string } | null;
  if (!e || e.code !== 11000) return null;
  const keys = Object.keys(e.keyPattern ?? {});
  const fields = (["email", "phone"] as const).filter((f) => keys.includes(f) || (keys.length === 0 && e.message?.includes(`${f}_`)));
  return fields;
}

// Crée un compte STAFF dans l'organisation de l'acteur, affecté à des centres qu'il gère.
export async function createStaffAccount(actor: CurrentUser, input: unknown): Promise<CreateStaffResult> {
  const allowedCenters = teamCenters(actor);
  if (!actor.organization || allowedCenters.length === 0) return { ok: false, message: "Accès refusé." };

  const parsed = CreateStaffSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: false, message: "Formulaire invalide." };
  }
  const data = parsed.data;

  // Tous les centres demandés doivent être dans le périmètre de l'acteur : un seul refusé annule la création.
  const allowed = new Set(allowedCenters.map((c) => c.id));
  if (!data.centerIds.every((id) => allowed.has(id))) {
    return { ok: false, errors: { centerIds: ["Centre invalide ou non autorisé."] } };
  }

  try {
    await connectDB();

    // Unicité (comme l'inscription) : e-mail et téléphone sont uniques sur toute la plateforme.
    const identifiers = [...(data.email ? [{ email: data.email }] : []), ...(data.phone ? [{ phone: data.phone }] : [])];
    const existing = await User.find({ $or: identifiers }).select("email phone").lean();
    const errors: Record<string, string[]> = {};
    if (data.email && existing.some((u) => u.email === data.email)) errors.email = [MSG_EMAIL_TAKEN];
    if (data.phone && existing.some((u) => u.phone === data.phone)) errors.phone = [MSG_PHONE_TAKEN];
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    // Rôle et organisation viennent du serveur, jamais du formulaire.
    const user = await User.create({
      organizationId: actor.organization.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      passwordHash,
      role: "STAFF",
      centerIds: data.centerIds,
      jobTitle: data.jobTitle,
      skills: data.skills ?? [],
    });
    return { ok: true, staff: { id: String(user._id), firstName: user.firstName, lastName: user.lastName } };
  } catch (error) {
    const dup = duplicateFields(error);
    if (dup) {
      const errors: Record<string, string[]> = {};
      if (dup.includes("email")) errors.email = [MSG_EMAIL_TAKEN];
      if (dup.includes("phone")) errors.phone = [MSG_PHONE_TAKEN];
      return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: false, errors: { email: [MSG_EMAIL_TAKEN] } };
    }
    // On ne journalise que le type de l'erreur : jamais l'entrée du formulaire.
    console.error("Erreur createStaffAccount :", (error as { name?: string })?.name, (error as { code?: unknown })?.code);
    return { ok: false, message: "Impossible de créer le compte. Réessayez." };
  }
}

// ── Horaires de travail individuels (F4, étape 4) ──

export type SaveStaffHoursResult =
  | { ok: true; changed: boolean }
  | { ok: false; message?: string; errors?: Record<string, string[]> };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MSG_STAFF_NOT_FOUND = "Employé introuvable.";

// Employé STAFF de l'organisation de l'acteur dont celui-ci peut gérer le planning (horaires, absences), ou null.
// Règle des centres : voir canEditStaffHours (lib/team/scope.ts). Même résultat (null) pour un identifiant invalide,
// un employé inconnu, d'une autre organisation, non STAFF ou hors périmètre : on ne révèle pas pourquoi.
// À appeler après connectDB(), avec un acteur ayant une organisation.
async function findManageableStaff(actor: CurrentUser, staffId: unknown) {
  if (!actor.organization || typeof staffId !== "string" || !OBJECT_ID.test(staffId)) return null;
  const staff = await User.findOne({ _id: staffId, organizationId: actor.organization.id, role: "STAFF" }).select("centerIds workingHours").lean();
  if (!staff || !canEditStaffHours(actor, (staff.centerIds ?? []).map(String))) return null;
  return staff;
}

// Forme canonique pour comparer deux valeurs : null (ou objet vide) = rien de personnalisé ; sinon les jours dans l'ordre.
function canonicalHours(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entries = WORKING_DAYS.filter((d) => d in record && record[d] !== undefined).map((d) => [d, record[d]]);
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

// Enregistre les horaires d'un employé STAFF de l'organisation. L'objet reçu REMPLACE l'ancien (pas de fusion) :
// un jour remis « comme le centre » disparaît. null ou objet vide = tous les jours suivent le centre.
// Sans changement réel : aucune écriture. Ne touche à aucun autre champ ni aux horaires des centres.
export async function saveStaffHours(actor: CurrentUser, staffId: unknown, input: unknown): Promise<SaveStaffHoursResult> {
  if (!actor.organization || teamCenters(actor).length === 0) return { ok: false, message: "Accès refusé." };

  try {
    await connectDB();
    const staff = await findManageableStaff(actor, staffId);
    if (!staff) return { ok: false, message: MSG_STAFF_NOT_FOUND };

    const parsed = StaffHoursInputSchema.safeParse(input);
    if (!parsed.success) {
      // Erreurs par jour : « workingHours.lundi » ; erreur d'ensemble : « workingHours ».
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = typeof issue.path[0] === "string" ? `workingHours.${issue.path[0]}` : "workingHours";
        (errors[key] ??= []).push(issue.message);
      }
      return { ok: false, errors };
    }

    const value = parsed.data; // objet normalisé ou null
    if (canonicalHours(staff.workingHours) === canonicalHours(value)) return { ok: true, changed: false };

    await User.updateOne({ _id: staffId, organizationId: actor.organization.id, role: "STAFF" }, { $set: { workingHours: value } });
    return { ok: true, changed: true };
  } catch (error) {
    console.error("Erreur saveStaffHours :", (error as { name?: string })?.name, (error as { code?: unknown })?.code);
    return { ok: false, message: "Impossible d'enregistrer les horaires. Réessayez." };
  }
}

// ── Congés et absences (F4, étape 5b) ──
// ENREGISTREMENT SEUL : ces absences ne sont pas encore lues par le moteur de réservation (lib/booking/) ; elles ne
// bloquent donc aucun créneau. Les rendez-vous existants ne sont jamais modifiés, annulés ni déplacés.

// Vue d'une absence pour le modal de l'employé (dates en ISO, sérialisable). Elle contient le motif : à ne servir qu'à
// un acteur autorisé sur cet employé, jamais dans la liste générale de l'équipe ni dans l'audit.
export type StaffTimeOffView = {
  id: string;
  staffId: string;
  kind: TimeOffKind;
  start: string;
  end: string;
  allDay: boolean;
  reason: string | null;
  // Rendez-vous actifs (confirmés ou en attente) de l'employé, encore à venir ou en cours, qui chevauchent l'absence.
  affectedBookings: number;
};

type Failure = { ok: false; message?: string; errors?: Record<string, string[]> };
export type CreateStaffTimeOffResult = { ok: true; timeOff: StaffTimeOffView } | Failure;
export type UpdateStaffTimeOffResult = { ok: true; changed: boolean; timeOff: StaffTimeOffView } | Failure;
// Résumé de l'absence supprimée, sans motif : sert au journal d'audit.
export type DeleteStaffTimeOffResult = { ok: true; deleted: { staffId: string; kind: TimeOffKind; start: string; end: string; allDay: boolean } } | Failure;
export type ListStaffTimeOffResult = { ok: true; items: StaffTimeOffView[] } | Failure;

const MSG_TIMEOFF_NOT_FOUND = "Absence introuvable.";
const MSG_TIMEOFF_OVERLAP = "Cet employé a déjà une absence sur cette période.";
const LIST_LIMIT = 200;

type TimeOffRow = { _id: Id; userId: Id; kind: string; start: Date; end: Date; allDay: boolean; reason?: string | null };

function toView(row: TimeOffRow, affectedBookings: number): StaffTimeOffView {
  return {
    id: String(row._id),
    staffId: String(row.userId),
    kind: row.kind as TimeOffKind,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    allDay: row.allDay,
    reason: row.reason ? row.reason : null,
    affectedBookings,
  };
}

// Rendez-vous actifs de l'employé qui chevauchent l'absence et ne sont pas terminés (fin après « maintenant »).
// Lecture seule : aucun rendez-vous n'est jamais modifié ici.
type Id = Types.ObjectId | string;

async function countAffectedBookings(organizationId: string, staffId: Id, range: { start: Date; end: Date }, now: Date) {
  const from = range.start > now ? range.start : now;
  if (range.end <= from) return 0; // absence entièrement passée : rien à traiter
  return Booking.countDocuments({
    organizationId,
    staffId,
    status: { $in: ["CONFIRMED", "PENDING"] },
    start: { $lt: range.end },
    end: { $gt: from },
  });
}

// Une autre absence du même employé partage-t-elle un instant avec cette période ? (adjacentes : non)
// Contrôle applicatif (lecture puis écriture), NON atomique : voir le risque de concurrence dans lib/models/team.ts.
async function hasOverlappingTimeOff(organizationId: string, userId: Id, range: { start: Date; end: Date }, excludeId?: Id) {
  const clash = await StaffTimeOff.exists({
    organizationId,
    userId,
    start: { $lt: range.end },
    end: { $gt: range.start },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  return Boolean(clash);
}

function validationErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) (errors[typeof issue.path[0] === "string" ? issue.path[0] : "form"] ??= []).push(issue.message);
  return errors;
}

// Journalise uniquement le type de l'erreur : jamais l'entrée du formulaire, donc jamais le motif.
function logTechnicalError(context: string, error: unknown) {
  console.error(`Erreur ${context} :`, (error as { name?: string })?.name, (error as { code?: unknown })?.code);
}

// Employé de l'absence visé, si l'acteur peut le gérer. Même résultat pour une absence inconnue, d'une autre
// organisation ou d'un employé hors de portée.
async function findManageableTimeOff(actor: CurrentUser, timeOffId: unknown) {
  if (!actor.organization || typeof timeOffId !== "string" || !OBJECT_ID.test(timeOffId)) return null;
  const entry = await StaffTimeOff.findOne({ _id: timeOffId, organizationId: actor.organization.id }).lean();
  if (!entry) return null;
  const staff = await findManageableStaff(actor, String(entry.userId));
  return staff ? { entry, staff } : null;
}

const canManageSchedules = (actor: CurrentUser) => Boolean(actor.organization) && teamCenters(actor).length > 0;

// Enregistre une absence (congé ou absence exceptionnelle) pour un employé STAFF que l'acteur peut gérer.
// « now » sert aux bornes de dates (testable). Les rendez-vous existants ne sont pas touchés.
export async function createStaffTimeOff(actor: CurrentUser, staffId: unknown, input: unknown, now: Date = new Date()): Promise<CreateStaffTimeOffResult> {
  if (!canManageSchedules(actor)) return { ok: false, message: "Accès refusé." };
  try {
    await connectDB();
    const staff = await findManageableStaff(actor, staffId);
    if (!staff) return { ok: false, message: MSG_STAFF_NOT_FOUND };

    const parsed = createStaffTimeOffSchema(now).safeParse(input);
    if (!parsed.success) return { ok: false, errors: validationErrors(parsed.error.issues) };
    const data = parsed.data;

    const organizationId = actor.organization!.id;
    if (await hasOverlappingTimeOff(organizationId, staff._id, data)) return { ok: false, errors: { startDay: [MSG_TIMEOFF_OVERLAP] } };

    const created = await StaffTimeOff.create({
      organizationId,
      userId: staff._id,
      kind: data.kind,
      start: data.start,
      end: data.end,
      allDay: data.allDay,
      ...(data.reason ? { reason: data.reason } : {}),
      ...(OBJECT_ID.test(actor.id) ? { createdBy: actor.id } : {}),
    });
    return { ok: true, timeOff: toView(created, await countAffectedBookings(organizationId, staff._id, data, now)) };
  } catch (error) {
    logTechnicalError("createStaffTimeOff", error);
    return { ok: false, message: "Impossible d'enregistrer l'absence. Réessayez." };
  }
}

// Modifie une absence (mêmes règles que la création). Sans changement réel : aucune écriture, changed = false.
// Bornes de dates : elles s'appliquent à la création et à tout changement de dates. Une absence ancienne dont les dates
// sortent des bornes d'aujourd'hui (début de plus de 365 jours) peut en revanche voir son type ou son motif corrigés tant
// que ses dates (début, fin, journée complète ou plage) ne changent pas. Les chevauchements ne sont contrôlés que si ces
// dates changent. Permissions, organisation et validation du formulaire restent contrôlées dans tous les cas.
export async function updateStaffTimeOff(actor: CurrentUser, timeOffId: unknown, input: unknown, now: Date = new Date()): Promise<UpdateStaffTimeOffResult> {
  if (!canManageSchedules(actor)) return { ok: false, message: "Accès refusé." };
  try {
    await connectDB();
    const found = await findManageableTimeOff(actor, timeOffId);
    if (!found) return { ok: false, message: MSG_TIMEOFF_NOT_FOUND };
    const { entry } = found;

    // 1. Toutes les règles sauf les bornes par rapport à aujourd'hui.
    const lenient = createStaffTimeOffSchema(now, { checkBounds: false }).safeParse(input);
    if (!lenient.success) return { ok: false, errors: validationErrors(lenient.error.issues) };
    let data = lenient.data;
    // 2. Si les dates changent, les nouvelles dates doivent respecter les bornes comme à la création.
    const datesChanged = entry.allDay !== data.allDay || entry.start.getTime() !== data.start.getTime() || entry.end.getTime() !== data.end.getTime();
    if (datesChanged) {
      const strict = createStaffTimeOffSchema(now).safeParse(input);
      if (!strict.success) return { ok: false, errors: validationErrors(strict.error.issues) };
      data = strict.data;
    }
    const organizationId = actor.organization!.id;

    const unchanged =
      entry.kind === data.kind &&
      entry.allDay === data.allDay &&
      entry.start.getTime() === data.start.getTime() &&
      entry.end.getTime() === data.end.getTime() &&
      (entry.reason || undefined) === data.reason;
    if (unchanged) return { ok: true, changed: false, timeOff: toView(entry, await countAffectedBookings(organizationId, entry.userId, entry, now)) };

    // Chevauchement : contrôlé seulement si la période effective change (début, fin ou journée complète / plage horaire).
    // Corriger le type ou le motif reste possible même si l'absence en chevauche déjà une autre. L'entrée modifiée
    // est exclue du contrôle : elle peut chevaucher son ancienne période.
    if (datesChanged && (await hasOverlappingTimeOff(organizationId, entry.userId, data, entry._id))) return { ok: false, errors: { startDay: [MSG_TIMEOFF_OVERLAP] } };

    // L'employé, l'organisation et l'auteur ne changent jamais.
    await StaffTimeOff.updateOne(
      { _id: entry._id, organizationId, userId: entry.userId },
      { $set: { kind: data.kind, start: data.start, end: data.end, allDay: data.allDay, ...(data.reason ? { reason: data.reason } : {}) }, ...(data.reason ? {} : { $unset: { reason: "" } }) },
    );
    const updated = { ...entry, kind: data.kind, start: data.start, end: data.end, allDay: data.allDay, reason: data.reason };
    return { ok: true, changed: true, timeOff: toView(updated, await countAffectedBookings(organizationId, entry.userId, data, now)) };
  } catch (error) {
    logTechnicalError("updateStaffTimeOff", error);
    return { ok: false, message: "Impossible d'enregistrer l'absence. Réessayez." };
  }
}

// Supprime définitivement une absence. Les rendez-vous ne sont pas touchés.
export async function deleteStaffTimeOff(actor: CurrentUser, timeOffId: unknown): Promise<DeleteStaffTimeOffResult> {
  if (!canManageSchedules(actor)) return { ok: false, message: "Accès refusé." };
  try {
    await connectDB();
    const found = await findManageableTimeOff(actor, timeOffId);
    if (!found) return { ok: false, message: MSG_TIMEOFF_NOT_FOUND };
    const { entry } = found;
    const result = await StaffTimeOff.deleteOne({ _id: entry._id, organizationId: actor.organization!.id, userId: entry.userId });
    if (result.deletedCount !== 1) return { ok: false, message: MSG_TIMEOFF_NOT_FOUND };
    return {
      ok: true,
      deleted: { staffId: String(entry.userId), kind: entry.kind as TimeOffKind, start: entry.start.toISOString(), end: entry.end.toISOString(), allDay: entry.allDay },
    };
  } catch (error) {
    logTechnicalError("deleteStaffTimeOff", error);
    return { ok: false, message: "Impossible de supprimer l'absence. Réessayez." };
  }
}

// Absences d'un employé pour son modal (avec motif) : d'abord celles en cours ou à venir (la plus proche en premier),
// puis les passées (la plus récente en premier). Limité aux LIST_LIMIT plus récentes par date de début.
export async function listStaffTimeOff(actor: CurrentUser, staffId: unknown, now: Date = new Date()): Promise<ListStaffTimeOffResult> {
  if (!canManageSchedules(actor)) return { ok: false, message: "Accès refusé." };
  try {
    await connectDB();
    const staff = await findManageableStaff(actor, staffId);
    if (!staff) return { ok: false, message: MSG_STAFF_NOT_FOUND };
    const organizationId = actor.organization!.id;

    const rows = await StaffTimeOff.find({ organizationId, userId: staff._id }).sort({ start: -1 }).limit(LIST_LIMIT).lean();
    const upcoming = rows.filter((r) => r.end > now).sort((a, b) => a.start.getTime() - b.start.getTime());
    const past = rows.filter((r) => r.end <= now); // déjà du plus récent au plus ancien
    const items = await Promise.all([...upcoming, ...past].map(async (r) => toView(r, await countAffectedBookings(organizationId, staff._id, r, now))));
    return { ok: true, items };
  } catch (error) {
    logTechnicalError("listStaffTimeOff", error);
    return { ok: false, message: "Impossible de charger les absences. Réessayez." };
  }
}
