import { dayKey, fromLocal, startOfLocalDay } from "@/lib/booking/time";

// Module 5 — Dates « jour » (matériel, maintenance) : saisies et affichées en AAAA-MM-JJ, stockées à minuit heure de Tunis.

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

// null si le format est faux, si le jour n'existe pas (30 février) ou si l'année est absurde.
export function parseDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const date = fromLocal(year, Number(m[2]), Number(m[3]));
  return dayKey(date) === value ? date : null;
}

export const formatDate = (date: Date | null | undefined) => (date ? dayKey(date) : null);

// Vrai si le jour est strictement après aujourd'hui (heure de Tunis).
export const isAfterToday = (date: Date, now = new Date()) => date.getTime() > startOfLocalDay(now).getTime();
