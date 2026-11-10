// F4 — Prévision de charge d'un centre : calcul PUR (aucun accès base), testable.
// Pour chaque jour : capacité (praticiens présents × heures d'ouverture) et rendez-vous réservés. Le résultat sert à
// l'affichage et, sous forme d'agrégats sans nom ni client, d'entrée à l'IA (Gemini). Lecture seule : rien n'est modifié.

export const FORECAST_DAYS = 28; // jours à venir analysés
export const REFERENCE_DAYS = 28; // jours passés servant de référence
export const OVERLOADED = 0.85;
export const BUSY = 0.65;
export const LOW = 0.25;

export type DayInput = {
  date: string; // AAAA-MM-JJ (jour local de Tunis)
  weekday: number; // 0 = dimanche
  openMinutes: number; // 0 = centre fermé
  staffTotal: number; // praticiens affectés au centre
  staffOff: number; // dont absents ce jour (absence ou congé couvrant l'ouverture)
  bookedMinutes: number; // rendez-vous non annulés
};

export type DayStatus = "closed" | "uncovered" | "overloaded" | "busy" | "ok" | "low";
export type DayLoad = DayInput & { capacityMinutes: number; rate: number | null; status: DayStatus };
export type WeekLoad = { start: string; days: number; avgRate: number | null; overloaded: number; low: number; uncovered: number; staffOffDays: number };
export type Forecast = {
  referenceAvgRate: number | null; // charge moyenne des jours ouverts passés
  days: DayLoad[]; // jours à venir
  weeks: WeekLoad[];
  alerts: { date: string; status: DayStatus; rate: number | null }[]; // jours à surveiller (surcharge, couverture, creux)
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function dayLoad(d: DayInput): DayLoad {
  const present = Math.max(0, d.staffTotal - d.staffOff);
  const capacityMinutes = d.openMinutes * present;
  if (d.openMinutes === 0) return { ...d, capacityMinutes: 0, rate: null, status: "closed" };
  // Des rendez-vous alors que personne n'est disponible : à traiter en priorité.
  if (capacityMinutes === 0) return { ...d, capacityMinutes, rate: null, status: d.bookedMinutes > 0 || d.staffTotal > 0 ? "uncovered" : "closed" };
  const rate = round(d.bookedMinutes / capacityMinutes);
  const status: DayStatus = rate >= OVERLOADED ? "overloaded" : rate >= BUSY ? "busy" : rate < LOW ? "low" : "ok";
  return { ...d, capacityMinutes, rate, status };
}

// Lundi (AAAA-MM-JJ) de la semaine d'un jour.
function mondayOf(date: string) {
  const dt = new Date(`${date}T12:00:00Z`);
  const back = (dt.getUTCDay() + 6) % 7;
  return new Date(dt.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

export function buildForecast(days: readonly DayInput[], todayKey: string): Forecast {
  const loads = days.map(dayLoad);
  const past = loads.filter((d) => d.date < todayKey && d.rate !== null);
  const future = loads.filter((d) => d.date >= todayKey);

  const byWeek = new Map<string, DayLoad[]>();
  for (const d of future) byWeek.set(mondayOf(d.date), [...(byWeek.get(mondayOf(d.date)) ?? []), d]);
  const weeks: WeekLoad[] = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, ds]) => {
      const rated = ds.filter((d) => d.rate !== null);
      return {
        start,
        days: ds.length,
        avgRate: rated.length ? round(rated.reduce((s, d) => s + d.rate!, 0) / rated.length) : null,
        overloaded: ds.filter((d) => d.status === "overloaded").length,
        low: ds.filter((d) => d.status === "low").length,
        uncovered: ds.filter((d) => d.status === "uncovered").length,
        staffOffDays: ds.reduce((s, d) => s + d.staffOff, 0),
      };
    });

  return {
    referenceAvgRate: past.length ? round(past.reduce((s, d) => s + d.rate!, 0) / past.length) : null,
    days: future,
    weeks,
    alerts: future.filter((d) => d.status === "overloaded" || d.status === "uncovered" || d.status === "low").map((d) => ({ date: d.date, status: d.status, rate: d.rate })),
  };
}
