// IA Module 6 — Statistiques simples sur l'historique du salon (cahier des charges §6) :
// détection d'anomalies (écart robuste à la médiane) et prévision du chiffre d'affaires du mois
// (moyenne par jour de la semaine + tendance). Fonctions pures : testées dans analytics.test.ts.
import { roundTnd } from "./money";

export type DayPoint = { day: string; weekday: number; value: number };

export type Anomaly = {
  id: string;
  severity: "high" | "medium";
  kind: "REVENUE_DROP" | "REVENUE_SPIKE" | "EXPENSE_SPIKE" | "LARGE_EXPENSE" | "REFUNDS" | "DISCOUNTS" | "NEGATIVE_MARGIN";
  title: string;
  detail: string;
  centerId: string | null;
  day?: string;
};

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Écart absolu médian, mis à l'échelle d'un écart-type (loi normale).
export function mad(values: number[]) {
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const dt = (x: number) => `${roundTnd(x).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} DT`;

// Chiffre d'affaires journalier anormal : chaque jour récent est comparé aux mêmes jours de la semaine
// précédents (8 semaines). Seuils : score robuste > 3 ET écart relatif > 40 %, pour éviter les fausses alertes.
export function revenueAnomalies(series: DayPoint[], opts: { recentDays?: number; centerId?: string | null; centerName?: string } = {}) {
  const recentDays = opts.recentDays ?? 14;
  const out: Anomaly[] = [];
  // Activité habituelle d'un jour ouvert : sert à ignorer les jours marginaux (ex. acomptes en ligne un jour de fermeture).
  const typical = median(series.map((p) => p.value).filter((v) => v > 0));
  for (let i = Math.max(0, series.length - recentDays); i < series.length; i++) {
    const point = series[i];
    const baseline = series
      .slice(0, i)
      .filter((p) => p.weekday === point.weekday)
      .slice(-8)
      .map((p) => p.value);
    if (baseline.length < 4) continue;
    const m = median(baseline);
    if (m <= 0 || m < typical * 0.25) continue; // jour habituellement fermé ou quasi sans activité
    const spread = Math.max(mad(baseline), m * 0.1);
    const z = (point.value - m) / spread;
    const rel = (point.value - m) / m;
    if (Math.abs(z) < 3 || Math.abs(rel) < 0.4) continue;
    const where = opts.centerName ? ` · ${opts.centerName}` : "";
    out.push({
      id: `rev-${opts.centerId ?? "all"}-${point.day}`,
      severity: Math.abs(rel) >= 0.7 ? "high" : "medium",
      kind: rel < 0 ? "REVENUE_DROP" : "REVENUE_SPIKE",
      title: rel < 0 ? `Chiffre d'affaires anormalement bas${where}` : `Chiffre d'affaires inhabituellement élevé${where}`,
      detail: `${point.day} : ${dt(point.value)} contre ${dt(m)} d'habitude ce jour de la semaine (${rel > 0 ? "+" : ""}${pct(rel)}).`,
      centerId: opts.centerId ?? null,
      day: point.day,
    });
  }
  return out;
}

export type ExpenseRow = { id: string; centerId: string; category: string; label: string; amountTnd: number; month: string };

// Dépenses : catégorie du mois en forte hausse par rapport à la moyenne des 3 mois précédents,
// ou dépense isolée bien supérieure aux dépenses habituelles de sa catégorie.
export function expenseAnomalies(
  rows: ExpenseRow[],
  currentMonth: string,
  previousMonths: string[],
  labels: { center: (id: string) => string; category: (c: string) => string },
) {
  const out: Anomaly[] = [];
  const groups = new Map<string, ExpenseRow[]>();
  for (const r of rows) {
    const key = `${r.centerId}|${r.category}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, list] of groups) {
    const [centerId, category] = key.split("|");
    const total = (month: string) => list.filter((r) => r.month === month).reduce((n, r) => n + r.amountTnd, 0);
    const current = total(currentMonth);
    const past = previousMonths.map(total).filter((v) => v > 0);
    if (past.length >= 2) {
      const avg = past.reduce((a, b) => a + b, 0) / past.length;
      if (current > avg * 1.5 && current - avg > 200) {
        out.push({
          id: `exp-${key}-${currentMonth}`,
          severity: current > avg * 2 ? "high" : "medium",
          kind: "EXPENSE_SPIKE",
          title: `Dépenses « ${labels.category(category)} » en hausse · ${labels.center(centerId)}`,
          detail: `${dt(current)} ce mois-ci contre ${dt(avg)} en moyenne sur les mois précédents (+${pct(current / avg - 1)}).`,
          centerId,
        });
      }
    }
    const history = list.filter((r) => r.month !== currentMonth).map((r) => r.amountTnd);
    if (history.length >= 4) {
      const m = median(history);
      for (const r of list.filter((x) => x.month === currentMonth)) {
        if (m > 0 && r.amountTnd > m * 3 && r.amountTnd - m > 300) {
          out.push({
            id: `big-${r.id}`,
            severity: "medium",
            kind: "LARGE_EXPENSE",
            title: `Dépense inhabituelle · ${labels.center(centerId)}`,
            detail: `« ${r.label} » : ${dt(r.amountTnd)}, soit ${Math.round(r.amountTnd / m)} fois la dépense habituelle en ${labels.category(category).toLowerCase()}.`,
            centerId,
          });
        }
      }
    }
  }
  return out;
}

// Indicateurs de caisse : remboursements et remises trop fréquents.
export function cashAnomalies(input: { revenue: number; refunds: number; subtotal: number; discounts: number; centerId?: string | null; centerName?: string }) {
  const out: Anomaly[] = [];
  const where = input.centerName ? ` · ${input.centerName}` : "";
  if (input.revenue > 0 && input.refunds / input.revenue > 0.05) {
    out.push({
      id: `refunds-${input.centerId ?? "all"}`,
      severity: input.refunds / input.revenue > 0.1 ? "high" : "medium",
      kind: "REFUNDS",
      title: `Remboursements élevés${where}`,
      detail: `${dt(input.refunds)} remboursés, soit ${pct(input.refunds / input.revenue)} du chiffre d'affaires (seuil d'alerte : 5 %).`,
      centerId: input.centerId ?? null,
    });
  }
  if (input.subtotal > 0 && input.discounts / input.subtotal > 0.1) {
    out.push({
      id: `discounts-${input.centerId ?? "all"}`,
      severity: "medium",
      kind: "DISCOUNTS",
      title: `Remises importantes${where}`,
      detail: `${pct(input.discounts / input.subtotal)} de remise moyenne sur les factures de la période (seuil d'alerte : 10 %).`,
      centerId: input.centerId ?? null,
    });
  }
  return out;
}

export type Forecast = {
  actualToDate: number;
  forecastRemaining: number;
  forecastTotal: number;
  low: number;
  high: number;
  trend: number; // 1.05 = +5 % sur les 4 dernières semaines
  backtestError: number | null; // erreur moyenne relative sur les 4 dernières semaines (MAPE hebdomadaire)
  days: { day: string; value: number; predicted: boolean }[];
};

// Prévision d'une journée : moyenne des 8 derniers mêmes jours de la semaine.
function weekdayMeans(history: DayPoint[]) {
  const means = new Map<number, { mean: number; values: number[] }>();
  for (let wd = 0; wd < 7; wd++) {
    const values = history.filter((p) => p.weekday === wd).slice(-8).map((p) => p.value);
    means.set(wd, { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, values });
  }
  return means;
}

function trendFactor(history: DayPoint[]) {
  if (history.length < 56) return 1;
  const sum = (list: DayPoint[]) => list.reduce((n, p) => n + p.value, 0);
  const last = sum(history.slice(-28));
  const prev = sum(history.slice(-56, -28));
  if (prev <= 0) return 1;
  // Tendance amortie (racine) et bornée : on ne projette pas une semaine exceptionnelle sur tout le mois.
  return Math.min(1.15, Math.max(0.85, Math.sqrt(last / prev)));
}

// history : jours passés complets (jusqu'à hier inclus), monthToDate : jours du mois déjà écoulés,
// remaining : jours restants du mois (aujourd'hui compris).
export function forecastMonth(history: DayPoint[], monthToDate: DayPoint[], remaining: Omit<DayPoint, "value">[]): Forecast {
  const means = weekdayMeans(history);
  const trend = trendFactor(history);
  const predicted = remaining.map((d) => ({ ...d, value: roundTnd((means.get(d.weekday)?.mean ?? 0) * trend) }));
  const actualToDate = roundTnd(monthToDate.reduce((n, p) => n + p.value, 0));
  const forecastRemaining = roundTnd(predicted.reduce((n, p) => n + p.value, 0));

  // Incertitude : écart-type des valeurs de chaque jour de la semaine, cumulé sur les jours restants.
  const variance = predicted.reduce((n, d) => {
    const { mean, values } = means.get(d.weekday)!;
    const v = values.length > 1 ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1) : 0;
    return n + v;
  }, 0);
  const margin = 1.28 * Math.sqrt(variance); // intervalle ~80 %

  return {
    actualToDate,
    forecastRemaining,
    forecastTotal: roundTnd(actualToDate + forecastRemaining),
    low: roundTnd(Math.max(actualToDate, actualToDate + forecastRemaining - margin)),
    high: roundTnd(actualToDate + forecastRemaining + margin),
    trend,
    backtestError: backtest(history),
    days: [
      ...monthToDate.map((p) => ({ day: p.day, value: p.value, predicted: false })),
      ...predicted.map((p) => ({ day: p.day, value: p.value, predicted: true })),
    ],
  };
}

// Qualité du modèle : on prévoit chacune des 4 dernières semaines avec l'historique qui la précède.
export function backtest(history: DayPoint[]) {
  const errors: number[] = [];
  for (let w = 4; w >= 1; w--) {
    const cut = history.length - w * 7;
    if (cut < 28) continue;
    const past = history.slice(0, cut);
    const week = history.slice(cut, cut + 7);
    const means = weekdayMeans(past);
    const trend = trendFactor(past);
    const predicted = week.reduce((n, p) => n + (means.get(p.weekday)?.mean ?? 0) * trend, 0);
    const actual = week.reduce((n, p) => n + p.value, 0);
    if (actual > 0) errors.push(Math.abs(predicted - actual) / actual);
  }
  return errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
}
