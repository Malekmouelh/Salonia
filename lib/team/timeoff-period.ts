import { fmtDay, fmtTime } from "@/lib/booking/format";

// F4 — Période d'une absence, découpée en parties à afficher séparément : une date (un jour) ou deux dates
// (plusieurs jours, dernier jour inclus), et éventuellement une plage horaire. Chaque partie est isolée à l'affichage
// (voir components/team/timeoff-period.tsx), ce qui évite tout mélange de sens d'écriture entre chiffres, mois et flèche.
export type TimeOffPeriodParts = { dates: [string] | [string, string]; times: [string, string] | null };

const DAY_FORMAT = { day: "numeric", month: "short", year: "numeric" } as const;

// « lang » : "fr" ou "ar" (heure de Tunis dans les deux cas). Fin exclusive des journées complètes : on affiche le dernier jour inclus.
export function timeOffPeriodParts(entry: { start: string; end: string; allDay: boolean }, lang: string): TimeOffPeriodParts {
  const first = fmtDay(entry.start, lang, DAY_FORMAT);
  if (!entry.allDay) return { dates: [first], times: [fmtTime(entry.start, lang), fmtTime(entry.end, lang)] };
  const last = fmtDay(new Date(new Date(entry.end).getTime() - 1), lang, DAY_FORMAT);
  return { dates: first === last ? [first] : [first, last], times: null };
}

// Texte brut (sans mise en forme) : étiquettes d'accessibilité des boutons.
export function timeOffPeriodText(parts: TimeOffPeriodParts) {
  return [parts.dates.join(" → "), parts.times?.join(" → ")].filter(Boolean).join(" · ");
}
