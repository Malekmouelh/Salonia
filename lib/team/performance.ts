// F4 — Indicateurs de performance d'un employé : calcul PUR (aucun accès base), testable.
// Le résultat sert (1) à l'affichage, (2) de seule entrée envoyée à l'IA : agrégats anonymes, jamais de nom,
// de client, de contact ni de motif d'absence.

export const PERFORMANCE_DAYS = 30; // période analysée, jusqu'à maintenant
export const DAY_MINUTES = 8 * 60; // journée de référence pour le taux d'occupation (les horaires ne pilotent pas les créneaux)
const DAY_MS = 86_400_000;

export type PerfBooking = {
  start: Date;
  end: Date;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  totalTnd: number;
  customerId: string;
  serviceNames: string[];
};
export type PerfTimeOff = { start: Date; end: Date };

export type PerformanceIndicators = {
  periodDays: number;
  bookingsTotal: number; // rendez-vous de la période (hors à venir non traités)
  completed: number;
  cancelled: number;
  noShow: number;
  completionRate: number | null; // réalisés / (réalisés + annulés + absents), 0..1
  noShowRate: number | null; // absents / (réalisés + absents)
  cancellationRate: number | null;
  revenueTnd: number; // total des rendez-vous réalisés
  avgTicketTnd: number | null;
  workedMinutes: number; // durée des rendez-vous réalisés
  workingDays: number; // jours ouvrés (lundi-samedi) de la période
  absentDays: number; // jours ouvrés couverts par une absence
  presenceRate: number | null; // 0..1
  occupancyRate: number | null; // minutes réalisées / (jours présents × DAY_MINUTES), plafonné à 1
  uniqueClients: number;
  returningClientsRate: number | null; // clients vus au moins 2 fois / clients uniques
  serviceVariety: number; // nombre de prestations différentes réalisées
  upcoming: number; // rendez-vous à venir (information)
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const ratio = (a: number, b: number) => (b > 0 ? round(a / b) : null);

// Jour local de Tunis (UTC+1 fixe) d'un instant : clé AAAA-MM-JJ.
function tunisDay(date: Date) {
  return new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10);
}

export function computeIndicators(
  bookings: readonly PerfBooking[],
  timeOff: readonly PerfTimeOff[],
  now: Date,
  periodDays = PERFORMANCE_DAYS,
): PerformanceIndicators {
  const from = new Date(now.getTime() - periodDays * DAY_MS);
  const inPeriod = bookings.filter((b) => b.start >= from && b.start < now);
  const upcoming = bookings.filter((b) => b.start >= now && (b.status === "PENDING" || b.status === "CONFIRMED")).length;

  const completed = inPeriod.filter((b) => b.status === "COMPLETED");
  const cancelled = inPeriod.filter((b) => b.status === "CANCELLED").length;
  const noShow = inPeriod.filter((b) => b.status === "NO_SHOW").length;
  const handled = completed.length + cancelled + noShow;

  const revenueTnd = round(completed.reduce((s, b) => s + (b.totalTnd || 0), 0));
  const workedMinutes = Math.round(completed.reduce((s, b) => s + Math.max(0, (b.end.getTime() - b.start.getTime()) / 60_000), 0));

  // Jours ouvrés (lundi à samedi) de la période, et ceux couverts par une absence.
  const absent = new Set<string>();
  for (const t of timeOff) {
    for (let ms = Math.max(t.start.getTime(), from.getTime()); ms < Math.min(t.end.getTime(), now.getTime()); ms += DAY_MS) {
      absent.add(tunisDay(new Date(ms)));
    }
    // Dernier jour d'une plage qui ne tombe pas sur un multiple de 24 h.
    const last = Math.min(t.end.getTime() - 1, now.getTime());
    if (last >= Math.max(t.start.getTime(), from.getTime())) absent.add(tunisDay(new Date(last)));
  }
  let workingDays = 0;
  let absentDays = 0;
  for (let i = 0; i < periodDays; i++) {
    const day = tunisDay(new Date(now.getTime() - (i + 1) * DAY_MS + DAY_MS));
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = dimanche
    if (weekday === 0) continue;
    workingDays++;
    if (absent.has(day)) absentDays++;
  }
  const presentDays = workingDays - absentDays;

  const perClient = new Map<string, number>();
  for (const b of completed) perClient.set(b.customerId, (perClient.get(b.customerId) ?? 0) + 1);
  const returning = [...perClient.values()].filter((n) => n >= 2).length;
  const variety = new Set(completed.flatMap((b) => b.serviceNames.map((n) => n.trim().toLowerCase()))).size;

  return {
    periodDays,
    bookingsTotal: inPeriod.length,
    completed: completed.length,
    cancelled,
    noShow,
    completionRate: ratio(completed.length, handled),
    noShowRate: ratio(noShow, completed.length + noShow),
    cancellationRate: ratio(cancelled, handled),
    revenueTnd,
    avgTicketTnd: completed.length ? round(revenueTnd / completed.length) : null,
    workedMinutes,
    workingDays,
    absentDays,
    presenceRate: ratio(presentDays, workingDays),
    occupancyRate: presentDays > 0 ? Math.min(1, round(workedMinutes / (presentDays * DAY_MINUTES))) : null,
    uniqueClients: perClient.size,
    returningClientsRate: ratio(returning, perClient.size),
    serviceVariety: variety,
    upcoming,
  };
}

// ── Notation ────────────────────────────────────────────────────────────────────────────────────
// Critères notés de 0 à 100, avec leur poids. La note globale (0..100) est la moyenne pondérée des critères disponibles.

export const CRITERIA = [
  { key: "reliability", weight: 25, label: "Fiabilité (rendez-vous honorés)" },
  { key: "presence", weight: 15, label: "Assiduité (présence)" },
  { key: "occupancy", weight: 20, label: "Taux d'occupation" },
  { key: "revenue", weight: 20, label: "Chiffre d'affaires et panier moyen" },
  { key: "loyalty", weight: 10, label: "Fidélisation des clients" },
  { key: "versatility", weight: 10, label: "Polyvalence" },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]["key"];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Note de référence calculée sans IA : sert de repli et de garde-fou (l'IA ne peut pas s'en écarter de plus de 25 points).
export function baselineScores(i: PerformanceIndicators): Record<CriterionKey, number | null> {
  const reliabilityBase = i.completed + i.noShow + i.cancelled;
  return {
    reliability: reliabilityBase === 0 ? null : clamp(100 - (i.noShowRate ?? 0) * 200 - (i.cancellationRate ?? 0) * 100),
    presence: i.presenceRate === null ? null : clamp(i.presenceRate * 100),
    occupancy: i.occupancyRate === null || i.completed === 0 ? null : clamp((i.occupancyRate / 0.6) * 100), // 60 % d'occupation = pleine note
    revenue: i.completed === 0 ? null : clamp(((i.revenueTnd / Math.max(1, i.workingDays - i.absentDays)) / 150) * 70 + ((i.avgTicketTnd ?? 0) / 80) * 30), // ~150 DT/jour, panier ~80 DT
    loyalty: i.uniqueClients === 0 ? null : clamp((i.returningClientsRate ?? 0) * 200), // 50 % de clients revenus = pleine note
    versatility: i.completed === 0 ? null : clamp((i.serviceVariety / 5) * 100), // 5 prestations différentes = pleine note
  };
}

export function overallScore(scores: Partial<Record<CriterionKey, number | null>>): number | null {
  let sum = 0;
  let weights = 0;
  for (const c of CRITERIA) {
    const s = scores[c.key];
    if (typeof s === "number") {
      sum += s * c.weight;
      weights += c.weight;
    }
  }
  return weights === 0 ? null : clamp(sum / weights);
}

export function gradeFor(score: number | null): "A" | "B" | "C" | "D" | null {
  if (score === null) return null;
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";
}
