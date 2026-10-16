// Heures locales de la Tunisie (UTC+1, sans heure d'été depuis 2009).
// Toutes les dates sont stockées en UTC ; ces fonctions convertissent vers/depuis l'heure de Tunis,
// quel que soit le fuseau du serveur (Vercel tourne en UTC).

export const TZ = "Africa/Tunis";
const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Clés des horaires d'ouverture (Center.openingHours), index = getUTCDay().
export const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function toLocal(date: Date): LocalParts {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

export function fromLocal(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

// "2026-10-16" (jour local)
export function dayKey(date: Date) {
  const p = toLocal(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDayKey(key: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return fromLocal(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function startOfLocalDay(date: Date) {
  const p = toLocal(date);
  return fromLocal(p.year, p.month, p.day);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

// Lundi 00:00 (heure locale) de la semaine contenant la date.
export function startOfLocalWeek(date: Date) {
  const start = startOfLocalDay(date);
  const weekday = toLocal(start).weekday;
  return addDays(start, -((weekday + 6) % 7));
}

export function startOfLocalMonth(date: Date) {
  const p = toLocal(date);
  return fromLocal(p.year, p.month, 1);
}

// "09:30" → 570
export function hhmmToMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHhmm(total: number) {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// "09:00-19:00" → { open: 540, close: 1140 } ; null si fermé ou invalide.
export function parseRange(range: string | null | undefined) {
  if (!range) return null;
  const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(range.trim());
  if (!m) return null;
  const open = hhmmToMinutes(m[1]);
  const close = hhmmToMinutes(m[2]);
  return close > open ? { open, close } : null;
}

// Horaires par défaut si le centre n'en a pas encore : 9h-19h, fermé le dimanche.
export const DEFAULT_HOURS: Record<Weekday, string | null> = {
  lundi: "09:00-19:00",
  mardi: "09:00-19:00",
  mercredi: "09:00-19:00",
  jeudi: "09:00-19:00",
  vendredi: "09:00-19:00",
  samedi: "09:00-19:00",
  dimanche: null,
};

export function hoursForDay(openingHours: Record<string, string | null> | null | undefined, day: Date) {
  const key = WEEKDAYS[toLocal(day).weekday];
  const hours = openingHours ?? DEFAULT_HOURS;
  return parseRange(key in hours ? hours[key] : DEFAULT_HOURS[key]);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
