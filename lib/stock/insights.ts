import type { StockUnit } from "@/lib/enums";

// Module 5 (IA) — Analyse de la consommation entre centres : FONCTIONS PURES (aucun accès base, réseau ni horloge ; la date du jour est
// fournie). Ce fichier calcule TOUS les chiffres et détecte les situations ; il ne rédige rien. Gemini (lib/stock/insights-ai.ts) n'intervient
// qu'ensuite, pour relier ces constats, les hiérarchiser et proposer des hypothèses et des actions : il ne reçoit que ces constats calculés.
//
// Séries : demande de chaque jour (quantité DEMANDÉE par les recettes, manque compris, comme la prévision) sur DEUX fenêtres consécutives de
// `windowDays` jours (la « courante » et la « précédente »), du plus ancien au plus récent, la veille en dernier (aujourd'hui exclu).
//
// Constats (chacun a un seuil nommé ci-dessous) :
//  - CENTER_OUTLIER : un centre consomme nettement plus d'un produit que les autres centres. Comparaison ÉQUITABLE : par rendez-vous ayant
//    consommé du stock (« activité » du centre, tirée du journal) quand tous les centres comparés en ont, sinon par jour. Un grand centre ne
//    ressort donc pas parce qu'il est grand, mais parce qu'il consomme plus PAR rendez-vous.
//  - SPIKE : la dernière semaine dépasse nettement la moyenne hebdomadaire des 3 semaines précédentes.
//  - TREND_UP / TREND_DOWN : la fenêtre courante s'écarte nettement de la précédente.
//  - LOSSES : part importante de sorties manuelles et de corrections négatives (jamais les transferts) par rapport à la consommation.
//  - DORMANT : stock en rayon mais plus aucune consommation alors qu'il y en avait avant (stock immobilisé).
//  - RUPTURE_RISK : repris de la prévision (lib/stock/forecast.ts), jamais recalculé ici.
//  - IMBALANCE : un centre est presque à court d'un produit alors qu'un autre en a beaucoup ou ne l'utilise plus ; quantité à transférer proposée.
// Ce sont des constats statistiques, pas des causes : l'interprétation est du ressort de l'utilisateur (et de l'IA, à titre d'hypothèse).

export const WINDOWS = [14, 28, 42] as const;
export const DEFAULT_WINDOW = 28;
export const RECENT_DAYS = 7;
export const MIN_ACTIVE_DAYS = 4; // jours avec consommation pour qu'un produit d'un centre soit évalué
export const OUTLIER_RATIO = 1.35;
export const OUTLIER_HIGH = 1.6;
export const TREND_CHANGE = 25; // % d'écart avec la fenêtre précédente
export const TREND_HIGH = 60;
export const SPIKE_RATIO = 1.6;
export const SPIKE_HIGH = 2.2;
export const LOSS_SHARE = 12; // % de sorties manuelles dans la consommation + sorties
export const LOSS_HIGH = 25;
export const LOW_COVER_DAYS = 14;
export const HIGH_COVER_DAYS = 60;
export const TARGET_COVER_DAYS = 30;
export const MAX_FINDINGS = 30;

export type FindingType = "RUPTURE_RISK" | "IMBALANCE" | "SPIKE" | "LOSSES" | "CENTER_OUTLIER" | "TREND_UP" | "DORMANT" | "TREND_DOWN";
export type Severity = "HIGH" | "MEDIUM" | "LOW";
const TYPE_ORDER: FindingType[] = ["RUPTURE_RISK", "IMBALANCE", "SPIKE", "LOSSES", "CENTER_OUTLIER", "TREND_UP", "DORMANT", "TREND_DOWN"];
const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export type PairInput = {
  productId: string;
  centerId: string;
  stock: number;
  alertThreshold: number;
  // Demande de chaque jour, du plus ancien au plus récent (la veille en dernier) ; complétée par des zéros si plus courte que 2 fenêtres.
  daily: number[];
  // Sorties manuelles et corrections négatives de la fenêtre courante.
  manualOut: number;
};
export type RiskInput = {
  productId: string;
  centerId: string;
  urgency: "URGENT" | "SOON" | "OK";
  status: "NO_DATA" | "NO_CONSUMPTION" | "OK";
  stock: number;
  daysLeft: number | null;
  leadDays: number | null;
  breakBeforeDelivery: boolean;
  suggestedQuantity: number;
};
export type InsightsInput = {
  todayKey: string;
  windowDays: number;
  centers: { id: string; name: string }[];
  products: { id: string; name: string; unit: StockUnit }[];
  pairs: PairInput[];
  // Rendez-vous distincts ayant consommé du stock, par centre, sur la fenêtre courante et la précédente.
  appointments: Record<string, { current: number; previous: number }>;
  risks: RiskInput[];
  quality: { simulatedMovements: number; totalMovements: number; historyDays: number };
};

export type MetricValue = number | string | boolean | null;
export type Finding = {
  id: string;
  type: FindingType;
  severity: Severity;
  productId: string;
  // Centre concerné ; pour IMBALANCE : le centre en tension (destinataire), `otherCenterId` étant celui qui a du stock en trop (source).
  centerId: string;
  otherCenterId?: string;
  metrics: Record<string, MetricValue>;
};

export type CenterSummary = {
  centerId: string;
  name: string;
  appointments: number;
  previousAppointments: number;
  appointmentsChangePct: number | null;
  // 100 = niveau moyen des centres comparés, pour la consommation PAR rendez-vous ; null s'il n'y a rien à comparer.
  intensityIndex: number | null;
  comparedProducts: number;
};
export type ProductCenterRow = { centerId: string; current: number; previous: number; changePct: number | null; sharePct: number; stock: number; dailyRate: number; coverDays: number | null };
export type ProductRow = { productId: string; name: string; unit: StockUnit; current: number; previous: number; changePct: number | null; centers: ProductCenterRow[] };
export type InsightsReport = {
  todayKey: string;
  windowDays: number;
  centers: CenterSummary[];
  products: ProductRow[];
  findings: Finding[];
  quality: { historyDays: number; simulatedMovements: number; totalMovements: number; simulatedSharePct: number; comparable: boolean };
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => (values.length === 0 ? 0 : sum(values) / values.length);
const pct = (current: number, previous: number): number | null => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

function fitSeries(daily: number[], windowDays: number): number[] {
  const need = windowDays * 2;
  return daily.length >= need ? daily.slice(-need) : [...Array<number>(need - daily.length).fill(0), ...daily];
}

type Pair = { input: PairInput; series: number[]; current: number; previous: number; activeDays: number; previousActiveDays: number; rate: number };

export function buildInsights(input: InsightsInput): InsightsReport {
  const W = input.windowDays;
  const centerName = new Map(input.centers.map((c) => [c.id, c.name]));
  const productInfo = new Map(input.products.map((p) => [p.id, p]));
  const appts = (centerId: string) => input.appointments[centerId] ?? { current: 0, previous: 0 };

  const pairs: Pair[] = input.pairs
    .filter((p) => centerName.has(p.centerId) && productInfo.has(p.productId))
    .map((p) => {
      const series = fitSeries(p.daily, W);
      const currentSeries = series.slice(-W);
      const previousSeries = series.slice(0, W);
      const current = sum(currentSeries);
      return { input: p, series, current, previous: sum(previousSeries), activeDays: currentSeries.filter((v) => v > 0).length, previousActiveDays: previousSeries.filter((v) => v > 0).length, rate: current / W };
    });
  const byProduct = new Map<string, Pair[]>();
  for (const pair of pairs) byProduct.set(pair.input.productId, [...(byProduct.get(pair.input.productId) ?? []), pair]);

  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "id">, suffix = "") => findings.push({ ...f, id: `${f.type}:${f.productId}:${f.centerId}${suffix}` });
  const ratios = new Map<string, number[]>(); // centre → rapports d'intensité par produit

  for (const [productId, list] of byProduct) {
    const assessed = list.filter((p) => p.activeDays >= MIN_ACTIVE_DAYS);

    // ── Comparaison entre centres ──
    if (assessed.length >= 2) {
      const byAppointments = assessed.every((p) => appts(p.input.centerId).current > 0);
      const intensity = (p: Pair) => (byAppointments ? (p.current / appts(p.input.centerId).current) * 100 : p.current / W);
      const all = mean(assessed.map(intensity));
      for (const p of assessed) {
        const own = intensity(p);
        if (all > 0) ratios.set(p.input.centerId, [...(ratios.get(p.input.centerId) ?? []), own / all]);
        const peers = assessed.filter((q) => q !== p).map(intensity);
        const peerMean = mean(peers);
        if (peerMean > 0 && own / peerMean >= OUTLIER_RATIO) {
          add({
            type: "CENTER_OUTLIER",
            severity: own / peerMean >= OUTLIER_HIGH ? "HIGH" : "MEDIUM",
            productId,
            centerId: p.input.centerId,
            metrics: {
              current: p.current,
              aboveOthersPct: Math.round((own / peerMean - 1) * 100),
              normalizedBy: byAppointments ? "APPOINTMENTS" : "DAYS",
              intensity: Math.round(own * 10) / 10,
              peerIntensity: Math.round(peerMean * 10) / 10,
              appointments: appts(p.input.centerId).current,
            },
          });
        }
      }
    }

    for (const p of list) {
      const { centerId } = p.input;
      // ── Pic de la dernière semaine ──
      const last = sum(p.series.slice(-RECENT_DAYS));
      const baselineSeries = p.series.slice(-RECENT_DAYS - 21, -RECENT_DAYS);
      const baseline = sum(baselineSeries) / 3;
      const spike = baseline > 0 && baselineSeries.filter((v) => v > 0).length >= MIN_ACTIVE_DAYS && last / baseline >= SPIKE_RATIO;
      if (spike) {
        add({ type: "SPIKE", severity: last / baseline >= SPIKE_HIGH ? "HIGH" : "MEDIUM", productId, centerId, metrics: { lastWeek: last, usualWeek: Math.round(baseline), aboveUsualPct: Math.round((last / baseline - 1) * 100) } });
      }
      // ── Tendance ──
      const change = pct(p.current, p.previous);
      if (change !== null && p.previousActiveDays >= MIN_ACTIVE_DAYS && p.activeDays >= MIN_ACTIVE_DAYS) {
        if (change >= TREND_CHANGE && !spike) add({ type: "TREND_UP", severity: change >= TREND_HIGH ? "MEDIUM" : "LOW", productId, centerId, metrics: { current: p.current, previous: p.previous, changePct: change } });
        if (change <= -TREND_CHANGE) add({ type: "TREND_DOWN", severity: "LOW", productId, centerId, metrics: { current: p.current, previous: p.previous, changePct: change } });
      }
      // ── Sorties manuelles ──
      const manual = p.input.manualOut;
      if (manual > 0 && p.current > 0) {
        const share = Math.round((manual / (p.current + manual)) * 100);
        if (share >= LOSS_SHARE) add({ type: "LOSSES", severity: share >= LOSS_HIGH ? "HIGH" : "MEDIUM", productId, centerId, metrics: { manualOut: manual, consumption: p.current, sharePct: share } });
      }
      // ── Stock immobilisé ──
      if (p.input.stock > 0 && p.current === 0 && p.previous > 0) add({ type: "DORMANT", severity: "LOW", productId, centerId, metrics: { stock: p.input.stock, previous: p.previous } });
    }

    // ── Déséquilibre entre centres : un centre en tension, un centre qui a du stock en trop ──
    const tight = assessed.filter((p) => p.rate > 0 && p.input.stock / p.rate <= LOW_COVER_DAYS);
    const surplus = list
      .map((p) => {
        const dormant = p.current === 0 && p.input.stock > 0 && p.previous > 0;
        const comfortable = p.rate > 0 && p.input.stock / p.rate >= HIGH_COVER_DAYS;
        if (!dormant && !comfortable) return null;
        return { pair: p, transferable: dormant ? p.input.stock : p.input.stock - Math.ceil(p.rate * TARGET_COVER_DAYS) };
      })
      .filter((s): s is { pair: Pair; transferable: number } => s !== null && s.transferable > 0)
      .sort((a, b) => b.transferable - a.transferable);
    for (const t of tight) {
      const source = surplus.find((s) => s.pair.input.centerId !== t.input.centerId);
      if (!source) continue;
      const need = Math.ceil(t.rate * TARGET_COVER_DAYS - t.input.stock);
      const quantity = Math.min(need, source.transferable);
      if (quantity <= 0) continue;
      const sRate = source.pair.rate;
      add(
        {
          type: "IMBALANCE",
          severity: "MEDIUM",
          productId,
          centerId: t.input.centerId,
          otherCenterId: source.pair.input.centerId,
          metrics: {
            quantity,
            receiverStock: t.input.stock,
            receiverCoverDays: Math.round(t.input.stock / t.rate),
            senderStock: source.pair.input.stock,
            senderCoverDays: sRate > 0 ? Math.round(source.pair.input.stock / sRate) : null,
            targetCoverDays: TARGET_COVER_DAYS,
          },
        },
        `:${source.pair.input.centerId}`,
      );
    }
  }

  // ── Risque de rupture : repris de la prévision ──
  for (const r of input.risks) {
    if (!centerName.has(r.centerId) || !productInfo.has(r.productId) || r.urgency === "OK") continue;
    add({
      type: "RUPTURE_RISK",
      // Sans prévision (historique insuffisant), on ne sait pas dater la rupture : on signale, sans « prioritaire ».
      severity: r.urgency === "URGENT" && r.status === "OK" ? "HIGH" : "MEDIUM",
      productId: r.productId,
      centerId: r.centerId,
      metrics: { stock: r.stock, daysLeft: r.daysLeft, leadDays: r.leadDays, breakBeforeDelivery: r.breakBeforeDelivery, suggestedQuantity: r.suggestedQuantity, forecastAvailable: r.status === "OK" },
    });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      (productInfo.get(a.productId)?.name ?? "").localeCompare(productInfo.get(b.productId)?.name ?? "", "fr") ||
      a.id.localeCompare(b.id),
  );

  const centers: CenterSummary[] = input.centers.map((c) => {
    const a = appts(c.id);
    const own = ratios.get(c.id) ?? [];
    return { centerId: c.id, name: c.name, appointments: a.current, previousAppointments: a.previous, appointmentsChangePct: pct(a.current, a.previous), intensityIndex: own.length > 0 ? Math.round(mean(own) * 100) : null, comparedProducts: own.length };
  });

  const products: ProductRow[] = [...byProduct.entries()]
    .map(([productId, list]): ProductRow => {
      const info = productInfo.get(productId)!;
      const current = sum(list.map((p) => p.current));
      const previous = sum(list.map((p) => p.previous));
      return {
        productId,
        name: info.name,
        unit: info.unit,
        current,
        previous,
        changePct: pct(current, previous),
        centers: list
          .map((p) => ({
            centerId: p.input.centerId,
            current: p.current,
            previous: p.previous,
            changePct: pct(p.current, p.previous),
            sharePct: current > 0 ? Math.round((p.current / current) * 100) : 0,
            stock: p.input.stock,
            dailyRate: Math.round(p.rate * 10) / 10,
            coverDays: p.rate > 0 ? Math.round(p.input.stock / p.rate) : null,
          }))
          .sort((a, b) => b.current - a.current),
      };
    })
    .sort((a, b) => a.unit.localeCompare(b.unit) || b.current - a.current || a.name.localeCompare(b.name, "fr"));

  const q = input.quality;
  return {
    todayKey: input.todayKey,
    windowDays: W,
    centers,
    products,
    findings: findings.slice(0, MAX_FINDINGS),
    quality: { historyDays: q.historyDays, simulatedMovements: q.simulatedMovements, totalMovements: q.totalMovements, simulatedSharePct: q.totalMovements > 0 ? Math.round((q.simulatedMovements / q.totalMovements) * 100) : 0, comparable: input.centers.length >= 2 },
  };
}
