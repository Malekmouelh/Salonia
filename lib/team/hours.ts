import { minutesToHhmm, parseRange } from "@/lib/booking/time";

// F4 — Horaires de travail individuels (User.workingHours). Fonctions pures, utilisables côté client.
//
// Convention (par jour) :
//   objet entier null ou jour absent → l'employé suit les horaires du centre
//   jour à null                      → repos
//   jour à « 09:00-17:00 »           → travaille sur cette plage (jamais au-delà de minuit)

// Jours de travail, dans l'ordre d'affichage (mêmes clés que Center.openingHours).
export const WORKING_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export type WorkingDay = (typeof WORKING_DAYS)[number];

// Format accepté pour une plage : heures de 00:00 à 23:59.
export const RANGE_FORMAT = /^([01]?\d|2[0-3]):[0-5]\d\s*-\s*([01]?\d|2[0-3]):[0-5]\d$/;

export type DayHours = { mode: "center" } | { mode: "off" } | { mode: "range"; open: string; close: string };
export type WeekHours = Record<WorkingDay, DayHours>;
// Valeur telle qu'enregistrée en base (jours « comme le centre » omis).
export type StoredWorkingHours = Partial<Record<WorkingDay, string | null>>;

export function centerWeek(): WeekHours {
  return Object.fromEntries(WORKING_DAYS.map((d) => [d, { mode: "center" }])) as WeekHours;
}

// Lecture indulgente d'une valeur de la base : une valeur absente ou invalide est traitée « comme le centre »,
// jamais de blocage ni d'exception (anciens comptes, données inattendues).
export function parseStoredHours(raw: unknown): WeekHours {
  const week = centerWeek();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return week;
  const stored = raw as Record<string, unknown>;
  for (const day of WORKING_DAYS) {
    const value = stored[day];
    if (value === null) week[day] = { mode: "off" };
    else if (typeof value === "string" && RANGE_FORMAT.test(value.trim())) {
      const range = parseRange(value);
      if (range) week[day] = { mode: "range", open: minutesToHhmm(range.open), close: minutesToHhmm(range.close) };
    }
  }
  return week;
}

// État d'édition → valeur à enregistrer. Tout « comme le centre » donne null. Les plages ne sont pas validées ici
// (c'est le rôle de WorkingHoursSchema, côté serveur) : elles sont recopiées telles que saisies.
export function serializeHours(week: WeekHours): StoredWorkingHours | null {
  const stored: StoredWorkingHours = {};
  for (const day of WORKING_DAYS) {
    const d = week[day];
    if (d.mode === "off") stored[day] = null;
    else if (d.mode === "range") stored[day] = `${d.open}-${d.close}`;
  }
  return Object.keys(stored).length > 0 ? stored : null;
}

// Valeur lisible (indulgente) d'un champ de la base, au format d'enregistrement : null si rien de personnalisé.
export function readStoredHours(raw: unknown): StoredWorkingHours | null {
  return serializeHours(parseStoredHours(raw));
}
