// Module 5 (IA) — Prévision de consommation et commande suggérée. FONCTIONS PURES : aucun accès base, réseau ni horloge (la date du jour est
// fournie), donc testables exactement. L'IA du module est ce calcul (série temporelle simple) ; le texte d'explication (lib/stock/forecast-explain.ts)
// ne fait que reformuler ces chiffres, il n'en invente aucun.
//
// Méthode, pour un produit dans un centre :
//  1. Série : demande par jour sur les 56 jours précédant aujourd'hui (aujourd'hui exclu, la journée n'est pas finie). La demande est la quantité
//     DEMANDÉE par les recettes (et non la quantité sortie) : un manque, stock à zéro, reste de la demande.
//  2. Rythme : lissage exponentiel (alpha 0,5) sur les totaux hebdomadaires, des plus anciens aux plus récents.
//  3. Saisonnalité : coefficient par jour de la semaine (demande moyenne du jour ÷ moyenne générale), seulement avec 4 semaines ou plus, borné à [0,5 ; 2].
//  4. Date de rupture : on simule jour après jour à partir de demain jusqu'à épuisement du stock actuel (horizon 120 jours).
//  5. Marge de sécurité : écart-type hebdomadaire × 1,65 × √(délai en semaines) (environ 95 % de couverture).
//  6. Quantité : rythme × (délai + cycle de 7 jours) + marge − stock − commandes en cours, arrondie au supérieur, jamais négative.
// Quand l'historique est trop court, on ne devine pas : statut NO_DATA.

export const HISTORY_DAYS = 56;
export const MIN_WEEKS = 2;
export const CYCLE_DAYS = 7;
export const HORIZON_DAYS = 120;
const ALPHA = 0.5;
const Z_95 = 1.65;

export type ForecastInput = {
  // Date du jour (jour civil de Tunis), « AAAA-MM-JJ ».
  todayKey: string;
  // Demande de chacun des HISTORY_DAYS jours qui précèdent aujourd'hui, du plus ancien au plus récent (0 les jours sans consommation).
  dailyDemand: number[];
  // Nombre de jours écoulés depuis la première consommation connue de ce produit dans ce centre (0 = aucune).
  historyDays: number;
  stock: number;
  alertThreshold: number;
  // Quantité déjà commandée et pas encore reçue.
  onOrder: number;
  // Délai du fournisseur habituel, ou null s'il n'y en a pas.
  leadDays: number | null;
};

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type ForecastStatus = "NO_DATA" | "NO_CONSUMPTION" | "OK";
// URGENT : rupture avant la livraison possible, ou stock nul / au seuil. SOON : à commander dans le cycle. OK : rien à faire.
export type Urgency = "URGENT" | "SOON" | "OK";

export type Forecast = {
  status: ForecastStatus;
  confidence: Confidence | null;
  weeksOfData: number;
  weeklyRate: number;
  dailyRate: number;
  stock: number;
  onOrder: number;
  leadDays: number | null;
  // Jour de rupture estimé (« AAAA-MM-JJ »), null si aucune rupture dans l'horizon ou pas de prévision.
  ruptureDate: string | null;
  daysLeft: number | null;
  // Dernier jour pour commander et être livré avant la rupture ; null sans fournisseur ni rupture. Peut être antérieur à aujourd'hui.
  orderBy: string | null;
  // La rupture arrive avant qu'une commande passée aujourd'hui puisse être livrée.
  breakBeforeDelivery: boolean;
  safetyStock: number;
  suggestedQuantity: number;
  urgency: Urgency;
};

export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Nombre de jours civils entre deux jours (b - a).
export function daysBetweenKeys(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const stdDev = (values: number[]) => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

// Totaux hebdomadaires, du plus ancien au plus récent : on découpe depuis la fin pour que la semaine la plus récente soit complète.
export function weeklyTotals(dailyDemand: number[], weeks: number): number[] {
  const totals: number[] = [];
  for (let w = 0; w < weeks; w++) {
    const end = dailyDemand.length - w * 7;
    totals.unshift(dailyDemand.slice(Math.max(0, end - 7), end).reduce((a, b) => a + b, 0));
  }
  return totals;
}

function smooth(weekly: number[]): number {
  return weekly.reduce((level, value, i) => (i === 0 ? value : ALPHA * value + (1 - ALPHA) * level), 0);
}

const empty = (input: ForecastInput, status: ForecastStatus, weeksOfData: number): Forecast => ({
  status,
  confidence: null,
  weeksOfData,
  weeklyRate: 0,
  dailyRate: 0,
  stock: input.stock,
  onOrder: input.onOrder,
  leadDays: input.leadDays,
  ruptureDate: null,
  daysLeft: null,
  orderBy: null,
  breakBeforeDelivery: false,
  safetyStock: 0,
  suggestedQuantity: 0,
  urgency: input.stock <= 0 || input.stock <= input.alertThreshold ? "URGENT" : "OK",
});

export function forecastProduct(input: ForecastInput): Forecast {
  const series = input.dailyDemand.slice(-HISTORY_DAYS);
  const weeksOfData = Math.min(Math.floor(input.historyDays / 7), Math.floor(series.length / 7));
  if (input.historyDays === 0 || weeksOfData < MIN_WEEKS) return empty(input, "NO_DATA", weeksOfData);

  const weekly = weeklyTotals(series, weeksOfData);
  const weeklyRate = smooth(weekly);
  if (!(weeklyRate > 0)) return empty(input, "NO_CONSUMPTION", weeksOfData);
  const dailyRate = weeklyRate / 7;

  // Coefficients par jour de la semaine (série alignée sur les dates : le dernier élément est la veille d'aujourd'hui).
  const coefficient = new Array<number>(7).fill(1);
  if (weeksOfData >= 4) {
    const used = series.slice(-weeksOfData * 7);
    const sums = new Array<number>(7).fill(0);
    const counts = new Array<number>(7).fill(0);
    used.forEach((value, i) => {
      const day = weekdayOf(addDaysToKey(input.todayKey, -(used.length - i)));
      sums[day] += value;
      counts[day]++;
    });
    const overall = mean(used);
    if (overall > 0) for (let d = 0; d < 7; d++) coefficient[d] = Math.min(2, Math.max(0.5, sums[d] / counts[d] / overall));
  }

  // Rupture : simulation à partir de demain.
  let remaining = input.stock;
  let daysLeft: number | null = input.stock <= 0 ? 0 : null;
  for (let k = 1; daysLeft === null && k <= HORIZON_DAYS; k++) {
    remaining -= dailyRate * coefficient[weekdayOf(addDaysToKey(input.todayKey, k))];
    if (remaining <= 0) daysLeft = k;
  }
  const ruptureDate = daysLeft === null ? null : addDaysToKey(input.todayKey, daysLeft);

  const lead = input.leadDays;
  const safetyStock = Math.ceil(stdDev(weekly) * Z_95 * Math.sqrt((lead ?? 0) / 7));
  const suggestedQuantity = Math.max(0, Math.ceil(dailyRate * ((lead ?? 0) + CYCLE_DAYS) + safetyStock - input.stock - input.onOrder));

  const breakBeforeDelivery = lead !== null && daysLeft !== null && daysLeft < lead;
  const orderBy = lead !== null && ruptureDate !== null ? addDaysToKey(ruptureDate, -lead) : null;

  let urgency: Urgency = "OK";
  if (input.stock <= 0 || input.stock <= input.alertThreshold || breakBeforeDelivery) urgency = "URGENT";
  else if (suggestedQuantity > 0 && daysLeft !== null && daysLeft <= (lead ?? 0) + CYCLE_DAYS) urgency = "SOON";

  const cv = stdDev(weekly) / mean(weekly);
  const confidence: Confidence = weeksOfData >= 4 && cv < 0.5 ? "HIGH" : weeksOfData >= 3 ? "MEDIUM" : "LOW";

  return { status: "OK", confidence, weeksOfData, weeklyRate, dailyRate, stock: input.stock, onOrder: input.onOrder, leadDays: lead, ruptureDate, daysLeft, orderBy, breakBeforeDelivery, safetyStock, suggestedQuantity, urgency };
}

const URGENCY_RANK: Record<Urgency, number> = { URGENT: 0, SOON: 1, OK: 2 };

// Tri d'affichage : les plus urgents d'abord, puis la rupture la plus proche.
export function compareForecasts(a: Forecast, b: Forecast): number {
  return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
}
