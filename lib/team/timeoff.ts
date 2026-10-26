import type { TimeOffKind } from "@/lib/enums";
import { addDays, addMinutes, dayKey, hhmmToMinutes, minutesToHhmm, parseDayKey, startOfLocalDay, toLocal } from "@/lib/booking/time";

// F4 — Congés et absences : conversion pure entre le formulaire (dates locales de Tunis) et les dates enregistrées.
// Aucun accès à la base : utilisable côté serveur comme côté client. Pas de changement d'heure en Tunisie (UTC+1 fixe).

// Bornes (propositions validées pour l'étape 5, voir R3).
export const MAX_PAST_DAYS = 365; // le premier jour ne peut pas être plus ancien que « aujourd'hui − 365 jours »
export const MAX_FUTURE_DAYS = 730; // le dernier jour ne peut pas dépasser « aujourd'hui + 730 jours »
export const MAX_DURATION_DAYS = 366;
export const MAX_TIMEOFF_REASON = 120; // longueur maximale du motif

export type TimeOffMode = "days" | "range";
export type TimeOffField = "startDay" | "endDay" | "from" | "to";

// Saisie du formulaire. En mode « days » : journées complètes de startDay à endDay inclus (endDay facultatif = un jour).
// En mode « range » : plage horaire de from à to dans la seule journée startDay.
export type TimeOffForm = {
  mode: TimeOffMode;
  startDay: string;
  endDay?: string;
  from?: string;
  to?: string;
};

export type TimeOffRange = { start: Date; end: Date; allDay: boolean };
export type TimeOffRangeResult = ({ ok: true } & TimeOffRange) | { ok: false; field: TimeOffField; message: string };

const TIME_FORMAT = /^([01]?\d|2[0-3]):[0-5]\d$/;

// Date réelle du calendrier : « 2030-02-31 » est refusée (parseDayKey la ferait déborder sur mars).
export function parseRealDay(key: string | undefined | null) {
  if (typeof key !== "string") return null;
  const date = parseDayKey(key);
  return date && dayKey(date) === key ? date : null;
}

const fail = (field: TimeOffField, message: string): TimeOffRangeResult => ({ ok: false, field, message });
const blank = (value: string | undefined) => value === undefined || value.trim() === "";

// Formulaire → dates enregistrées (début inclus, fin exclusive). Vérifie la cohérence des champs, pas les bornes
// par rapport à aujourd'hui (voir checkTimeOffBounds).
export function computeTimeOffRange(form: TimeOffForm): TimeOffRangeResult {
  const first = parseRealDay(form.startDay);
  if (!first) return fail("startDay", "Date invalide.");

  if (form.mode === "days") {
    const last = blank(form.endDay) ? first : parseRealDay(form.endDay);
    if (!last) return fail("endDay", "Date invalide.");
    if (last < first) return fail("endDay", "La date de fin doit être le même jour ou après la date de début.");
    // Les heures n'ont pas de sens pour des journées complètes.
    if (!blank(form.from)) return fail("from", "Les heures ne s'appliquent qu'à une plage horaire.");
    if (!blank(form.to)) return fail("to", "Les heures ne s'appliquent qu'à une plage horaire.");
    return { ok: true, start: first, end: addDays(last, 1), allDay: true };
  }

  // Plage horaire : une seule journée, jamais au-delà de minuit.
  if (!blank(form.endDay) && form.endDay !== form.startDay) return fail("endDay", "Une plage horaire concerne une seule journée.");
  const from = form.from?.trim() ?? "";
  const to = form.to?.trim() ?? "";
  if (!TIME_FORMAT.test(from)) return fail("from", "Heure de début invalide.");
  if (!TIME_FORMAT.test(to)) return fail("to", "Heure de fin invalide.");
  const fromMinutes = hhmmToMinutes(from);
  const toMinutes = hhmmToMinutes(to);
  if (toMinutes <= fromMinutes) return fail("to", "L'heure de fin doit être après l'heure de début.");
  return { ok: true, start: addMinutes(first, fromMinutes), end: addMinutes(first, toMinutes), allDay: false };
}

// Bornes par rapport à « maintenant » (heure de Tunis, en jours entiers) : null si tout est valide.
export function checkTimeOffBounds(range: TimeOffRange, now: Date, mode: TimeOffMode): { field: TimeOffField; message: string } | null {
  const today = startOfLocalDay(now);
  if (range.start < addDays(today, -MAX_PAST_DAYS)) {
    return { field: "startDay", message: `Le début ne peut pas dater de plus de ${MAX_PAST_DAYS} jours.` };
  }
  // Le dernier jour concerné est celui de (fin − 1 ms) : la fin est exclusive.
  const lastDay = startOfLocalDay(new Date(range.end.getTime() - 1));
  if (lastDay > addDays(today, MAX_FUTURE_DAYS)) {
    return { field: mode === "days" ? "endDay" : "startDay", message: `La fin ne peut pas dépasser ${MAX_FUTURE_DAYS} jours à partir d'aujourd'hui.` };
  }
  const days = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
  if (days > MAX_DURATION_DAYS) {
    return { field: "endDay", message: `Une absence ne peut pas durer plus de ${MAX_DURATION_DAYS} jours.` };
  }
  return null;
}

// Absence enregistrée → valeurs du formulaire (pré-remplissage de la modification). Fonction totale : une plage
// enregistrée qui s'étendrait sur plusieurs jours (non créée par ce code) est ramenée à sa première journée, jusqu'à 23:59.
export function timeOffToForm(entry: { start: Date; end: Date; allDay: boolean }): Required<TimeOffForm> {
  const startDay = dayKey(entry.start);
  if (entry.allDay) {
    const lastDay = dayKey(new Date(entry.end.getTime() - 1));
    return { mode: "days", startDay, endDay: lastDay < startDay ? startDay : lastDay, from: "", to: "" };
  }
  const sameDay = dayKey(new Date(entry.end.getTime() - 1)) === startDay;
  const startLocal = toLocal(entry.start);
  const endLocal = toLocal(entry.end);
  return {
    mode: "range",
    startDay,
    endDay: startDay,
    from: minutesToHhmm(startLocal.hour * 60 + startLocal.minute),
    to: sameDay ? minutesToHhmm(endLocal.hour * 60 + endLocal.minute) : "23:59",
  };
}

// Résumé d'une absence pour la liste de l'équipe et l'audit : jamais de motif (donnée potentiellement sensible).
export type TimeOffSummary = { kind: TimeOffKind; start: string; end: string; allDay: boolean };

// « En cours » : l'absence qui se termine le plus tard parmi celles qui couvrent l'instant donné (début inclus, fin exclue).
// « Prochaine » : celle qui commence le plus tôt après cet instant. Les absences terminées sont ignorées.
export function summarizeTimeOff(
  entries: readonly { kind: string; start: Date; end: Date; allDay: boolean }[],
  now: Date,
): { current: TimeOffSummary | null; next: TimeOffSummary | null } {
  const toSummary = (e: { kind: string; start: Date; end: Date; allDay: boolean }): TimeOffSummary => ({
    kind: e.kind as TimeOffKind,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    allDay: e.allDay,
  });
  let current: (typeof entries)[number] | null = null;
  let next: (typeof entries)[number] | null = null;
  for (const e of entries) {
    if (e.start <= now && now < e.end) {
      if (!current || e.end > current.end) current = e;
    } else if (e.start > now) {
      if (!next || e.start < next.start) next = e;
    }
  }
  return { current: current ? toSummary(current) : null, next: next ? toSummary(next) : null };
}

// Texte du journal d'audit : « staff:<id> <TYPE> <dates> ». Le paramètre n'accepte volontairement pas de motif.
export function timeOffAuditDetail(entry: { staffId: string; kind: string; start: Date | string; end: Date | string; allDay: boolean }) {
  const form = timeOffToForm({ start: new Date(entry.start), end: new Date(entry.end), allDay: entry.allDay });
  const when =
    form.mode === "days"
      ? form.endDay === form.startDay
        ? form.startDay
        : `${form.startDay}→${form.endDay}`
      : `${form.startDay} ${form.from}-${form.to}`;
  return `staff:${entry.staffId} ${entry.kind} ${when}`;
}
