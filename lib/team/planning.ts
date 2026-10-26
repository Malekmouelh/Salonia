import { WEEKDAYS, addDays, dayKey, hoursForDay, minutesToHhmm, startOfLocalDay, startOfLocalWeek, toLocal, type Weekday } from "@/lib/booking/time";
import type { BlockKind, BookingStatus, TimeOffKind } from "@/lib/enums";
import type { WeekHours } from "./hours";
import { parseRealDay } from "./timeoff";

// F4 — Planning personnel (lecture seule) : semaine du lundi au dimanche, heure de Tunis.
// Fonctions pures (aucun accès à la base), utilisables côté serveur comme côté client.

// Une semaine demandée à plus de 5 ans d'aujourd'hui est considérée invalide.
export const MAX_WEEK_DISTANCE_DAYS = 5 * 366;

// Lundi 00:00 (heure de Tunis) de la semaine demandée par « ?week=YYYY-MM-DD ». N'importe quel jour de la semaine convient.
// Valeur absente, mal formée, date impossible (2030-02-31) ou trop lointaine : semaine courante.
export function resolveWeekStart(param: unknown, now: Date = new Date()): Date {
  const current = startOfLocalWeek(now);
  if (typeof param !== "string") return current;
  const day = parseRealDay(param);
  if (!day) return current;
  const distance = Math.abs(day.getTime() - startOfLocalDay(now).getTime()) / 86_400_000;
  return distance > MAX_WEEK_DISTANCE_DAYS ? current : startOfLocalWeek(day);
}

export type PlanningDay = { key: string; start: Date; end: Date; weekday: Weekday };

// Les sept jours de la semaine : début inclus (00:00), fin exclue (00:00 du lendemain).
export function weekDays(weekStart: Date): PlanningDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const start = addDays(weekStart, i);
    return { key: dayKey(start), start, end: addDays(start, 1), weekday: WEEKDAYS[toLocal(start).weekday] };
  });
}

// Un élément apparaît sur chaque jour qu'il chevauche (début inclus, fin exclue) : un rendez-vous qui passe minuit
// figure sur les deux jours ; un élément qui finit à minuit pile n'apparaît pas sur le jour suivant.
export function overlapsDay(item: { start: string | Date; end: string | Date }, day: { start: Date; end: Date }) {
  return new Date(item.start) < day.end && new Date(item.end) > day.start;
}

// ── Données du planning (sérialisables : dates en ISO) ──

export type PlanningBooking = {
  id: string;
  start: string;
  end: string;
  status: BookingStatus;
  customer: string; // nom du client seulement : ni téléphone, ni notes, ni prix, ni risque
  services: string;
  center: string;
};
export type PlanningTimeOff = { id: string; kind: TimeOffKind; start: string; end: string; allDay: boolean }; // jamais de motif
export type PlanningBlock = { id: string; kind: BlockKind; start: string; end: string; center: string; wholeCenter: boolean }; // jamais de motif
export type PlanningHours = {
  mode: "center" | "off" | "range";
  open: string | null;
  close: string | null;
  // Horaires du centre ce jour-là, seulement s'il n'y a qu'un centre concerné : "closed" ou { open, close } ; sinon null.
  center: "closed" | { open: string; close: string } | null;
};
export type PlanningDayData = {
  key: string;
  weekday: Weekday;
  hours: PlanningHours;
  bookings: PlanningBooking[];
  timeOff: PlanningTimeOff[];
  blocks: PlanningBlock[];
};

// Horaires d'un jour : horaires personnels (jour absent = comme le centre, null = repos) et, si un seul centre est concerné,
// ses horaires d'ouverture. INFORMATIF : ces horaires ne sont pas encore pris en compte dans le calcul des créneaux.
export function planningHours(
  personal: WeekHours,
  day: PlanningDay,
  centerOpeningHours: readonly (Record<string, string | null> | null)[],
): PlanningHours {
  const mine = personal[day.weekday];
  let center: PlanningHours["center"] = null;
  if (centerOpeningHours.length === 1) {
    const h = hoursForDay(centerOpeningHours[0], day.start);
    center = h ? { open: minutesToHhmm(h.open), close: minutesToHhmm(h.close) } : "closed";
  }
  if (mine.mode === "range") return { mode: "range", open: mine.open, close: mine.close, center };
  return { mode: mine.mode, open: null, close: null, center };
}
