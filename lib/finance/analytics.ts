// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/analytics.ts — L'INTELLIGENCE ARTIFICIELLE « STATISTIQUE »
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Implémente deux des fonctionnalités IA du cahier des charges §6 (« règles ou statistiques
//   simples sur l'historique du salon ») :
//     1. DÉTECTION D'ANOMALIES : repérer un jour de CA anormal, une dépense inhabituelle…
//     2. PRÉVISION du chiffre d'affaires du mois.
//   Ce n'est PAS un réseau de neurones : ce sont des méthodes statistiques classiques,
//   explicables et déterministes (mêmes données → mêmes résultats). Avantage pour une
//   soutenance : on peut expliquer chaque formule.
//   Toutes les fonctions sont « pures » (pas d'accès base de données) → testées dans finance.test.ts.
//   Les données leur sont fournies par lib/finance/reports.ts.
//
// IDÉES STATISTIQUES UTILISÉES
//   • Médiane (au lieu de la moyenne) : une valeur extrême fausse la moyenne mais pas la médiane.
//     Exemple : [500, 520, 480, 5000] → moyenne 1625 (trompeuse), médiane 510 (représentative).
//   • MAD (écart absolu médian) : mesure de dispersion « robuste », comme un écart-type insensible
//     aux valeurs extrêmes. On compare un nouveau point à la médiane en unités de MAD (score robuste).
//   • Backtest : pour mesurer la qualité d'une prévision, on « prévoit le passé » et on compare au réel.
// ═══════════════════════════════════════════════════════════════════════════
// IA Module 6 — Statistiques simples sur l'historique du salon (cahier des charges §6) :
// détection d'anomalies (écart robuste à la médiane) et prévision du chiffre d'affaires du mois
// (moyenne par jour de la semaine + tendance). Fonctions pures : testées dans analytics.test.ts.
import { roundTnd } from "./money";

// Un point de la série temporelle : un jour, son jour de semaine (0 = dimanche … 6 = samedi), son CA.
export type DayPoint = { day: string; weekday: number; value: number };

// Une alerte affichée au propriétaire.
export type Anomaly = {
  id: string; // identifiant stable (clé React, évite les doublons)
  severity: "high" | "medium"; // important / à surveiller
  kind: "REVENUE_DROP" | "REVENUE_SPIKE" | "EXPENSE_SPIKE" | "LARGE_EXPENSE" | "REFUNDS" | "DISCOUNTS" | "NEGATIVE_MARGIN" | "CASH_VARIANCE";
  title: string;
  detail: string; // phrase explicative avec les chiffres
  centerId: string | null;
  day?: string;
};

// Médiane : la valeur « du milieu » d'une liste triée.
// Nombre impair d'éléments → l'élément central ; pair → moyenne des deux éléments centraux.
export function median(values: number[]) {
  if (values.length === 0) return 0;
  // `[...values]` copie la liste avant de la trier (sort modifie le tableau d'origine).
  // `(a, b) => a - b` : tri numérique croissant (par défaut JavaScript trie comme du texte !).
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Écart absolu médian, mis à l'échelle d'un écart-type (loi normale).
// MAD = médiane des écarts |valeur − médiane|. Le facteur 1,4826 la rend comparable à un écart-type
// si les données suivent une loi normale (constante mathématique classique).
export function mad(values: number[]) {
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

// Petits formateurs de texte pour les messages d'alerte : « 12 % » et « 1 234 DT ».
const pct = (x: number) => `${Math.round(x * 100)} %`;
const dt = (x: number) => `${roundTnd(x).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} DT`;

// ───────────── Anomalie n°1 : le chiffre d'affaires d'un jour ─────────────
// Chiffre d'affaires journalier anormal : chaque jour récent est comparé aux mêmes jours de la semaine
// précédents (8 semaines). Seuils : score robuste > 3 ET écart relatif > 40 %, pour éviter les fausses alertes.
// POURQUOI comparer « le même jour de la semaine » ? Un samedi est naturellement plus chargé qu'un
// lundi : comparer un samedi à un lundi donnerait de fausses alertes.
export function revenueAnomalies(series: DayPoint[], opts: { recentDays?: number; centerId?: string | null; centerName?: string } = {}) {
  const recentDays = opts.recentDays ?? 14; // on n'examine que les 14 derniers jours
  const out: Anomaly[] = [];
  // Activité habituelle d'un jour ouvert : sert à ignorer les jours marginaux (ex. acomptes en ligne un jour de fermeture).
  const typical = median(series.map((p) => p.value).filter((v) => v > 0));
  // Boucle sur chaque jour récent (indice i dans la série).
  for (let i = Math.max(0, series.length - recentDays); i < series.length; i++) {
    const point = series[i];
    // Historique de référence : jusqu'à 8 mêmes jours de la semaine AVANT ce jour.
    const baseline = series
      .slice(0, i) // tous les jours avant i
      .filter((p) => p.weekday === point.weekday) // même jour de la semaine
      .slice(-8) // les 8 plus récents
      .map((p) => p.value);
    // Pas assez d'historique (< 4 semaines) → on ne conclut pas.
    if (baseline.length < 4) continue;
    const m = median(baseline); // valeur « habituelle »
    if (m <= 0 || m < typical * 0.25) continue; // jour habituellement fermé ou quasi sans activité
    // Dispersion habituelle ; plancher à 10 % de la médiane pour ne jamais diviser par ~0.
    const spread = Math.max(mad(baseline), m * 0.1);
    // z = « nombre d'écarts-types » entre la valeur du jour et la valeur habituelle (score robuste).
    const z = (point.value - m) / spread;
    // rel = écart relatif en % (−0,91 = −91 %).
    const rel = (point.value - m) / m;
    // Il faut que l'écart soit à la fois statistiquement fort (|z| ≥ 3) ET important en valeur (≥ 40 %).
    if (Math.abs(z) < 3 || Math.abs(rel) < 0.4) continue;
    const where = opts.centerName ? ` · ${opts.centerName}` : "";
    out.push({
      id: `rev-${opts.centerId ?? "all"}-${point.day}`,
      // Écart ≥ 70 % → alerte « importante », sinon « à surveiller ».
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

// Une dépense simplifiée pour l'analyse (`month` au format « 2026-10 »).
export type ExpenseRow = { id: string; centerId: string; category: string; label: string; amountTnd: number; month: string };

// ───────────── Anomalie n°2 : les dépenses ─────────────
// Dépenses : catégorie du mois en forte hausse par rapport à la moyenne des 3 mois précédents,
// ou dépense isolée bien supérieure aux dépenses habituelles de sa catégorie.
export function expenseAnomalies(
  rows: ExpenseRow[],
  currentMonth: string,
  previousMonths: string[],
  // `labels` : fonctions fournies par l'appelant pour afficher le nom du centre/de la catégorie
  // (cette fonction reste ainsi indépendante de la base de données et de la langue).
  labels: { center: (id: string) => string; category: (c: string) => string },
) {
  const out: Anomaly[] = [];
  // 1) On regroupe les dépenses par couple « centre | catégorie » (ex. « Sousse|PRODUCTS »).
  const groups = new Map<string, ExpenseRow[]>();
  for (const r of rows) {
    const key = `${r.centerId}|${r.category}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  // 2) Pour chaque groupe, on cherche deux types d'anomalies.
  for (const [key, list] of groups) {
    const [centerId, category] = key.split("|");
    // total(month) = somme des dépenses de ce groupe pour un mois donné.
    const total = (month: string) => list.filter((r) => r.month === month).reduce((n, r) => n + r.amountTnd, 0);
    const current = total(currentMonth);
    // Totaux des mois précédents (on ignore les mois sans dépense).
    const past = previousMonths.map(total).filter((v) => v > 0);
    // (a) Hausse de la catégorie : il faut au moins 2 mois de référence.
    if (past.length >= 2) {
      const avg = past.reduce((a, b) => a + b, 0) / past.length; // moyenne des mois passés
      // Alerte si ce mois dépasse de 50 % la moyenne ET d'au moins 200 DT (évite les alertes sur de petits montants).
      if (current > avg * 1.5 && current - avg > 200) {
        out.push({
          id: `exp-${key}-${currentMonth}`,
          severity: current > avg * 2 ? "high" : "medium", // plus du double → important
          kind: "EXPENSE_SPIKE",
          title: `Dépenses « ${labels.category(category)} » en hausse · ${labels.center(centerId)}`,
          detail: `${dt(current)} ce mois-ci contre ${dt(avg)} en moyenne sur les mois précédents (+${pct(current / avg - 1)}).`,
          centerId,
        });
      }
    }
    // (b) Dépense isolée : une seule dépense du mois bien supérieure (×3 et +300 DT) à la médiane historique.
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

// ───────────── Anomalie n°3 : la caisse (remboursements, remises) ─────────────
// Indicateurs de caisse : remboursements et remises trop fréquents.
// Règles simples à seuil (pas de statistique ici) : signal classique de fraude ou de mauvaise gestion.
export function cashAnomalies(input: { revenue: number; refunds: number; subtotal: number; discounts: number; centerId?: string | null; centerName?: string }) {
  const out: Anomaly[] = [];
  const where = input.centerName ? ` · ${input.centerName}` : "";
  // Remboursements > 5 % du CA (> 10 % = important).
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
  // Remises > 10 % du sous-total facturé.
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

// ───────────── Anomalie n°4 : les écarts de caisse ─────────────
// Une clôture simplifiée pour l'analyse : quel centre, quel jour, quel écart (compté − attendu).
export type ClosingPoint = { id: string; centerId: string; day: string; varianceTnd: number };

// Seuil de tolérance : en dessous de 10 DT d'écart, c'est une erreur de monnaie banale (pièces, arrondis).
const VARIANCE_TOLERANCE = 10;

// Règles : (1) un écart ≥ 10 DT est signalé ; ≥ 50 DT, il est « important ».
//          (2) si un MÊME centre cumule 3 écarts ou plus sur la période, on le dit en une seule alerte
//              « importante » : la répétition est plus parlante que chaque écart pris isolément.
export function closingAnomalies(rows: ClosingPoint[], labels: { center: (id: string) => string }) {
  const out: Anomaly[] = [];
  // On regroupe les écarts significatifs par centre.
  const byCenter = new Map<string, ClosingPoint[]>();
  for (const r of rows) {
    if (Math.abs(r.varianceTnd) < VARIANCE_TOLERANCE) continue;
    byCenter.set(r.centerId, [...(byCenter.get(r.centerId) ?? []), r]);
  }
  for (const [centerId, list] of byCenter) {
    if (list.length >= 3) {
      // Écart cumulé net (les + et les − se compensent) et écart absolu (l'ampleur totale des erreurs).
      const net = list.reduce((n, r) => n + r.varianceTnd, 0);
      const abs = list.reduce((n, r) => n + Math.abs(r.varianceTnd), 0);
      out.push({
        id: `cashvar-repeat-${centerId}`,
        severity: "high",
        kind: "CASH_VARIANCE",
        title: `Écarts de caisse répétés · ${labels.center(centerId)}`,
        detail: `${list.length} clôtures avec un écart d'au moins ${VARIANCE_TOLERANCE} DT sur la période (écart net ${net > 0 ? "+" : ""}${dt(net)}, ampleur cumulée ${dt(abs)}).`,
        centerId,
      });
      continue;
    }
    for (const r of list) {
      out.push({
        id: `cashvar-${r.id}`,
        severity: Math.abs(r.varianceTnd) >= 50 ? "high" : "medium",
        kind: "CASH_VARIANCE",
        title: `Écart de caisse · ${labels.center(centerId)}`,
        detail: `${r.day} : ${r.varianceTnd > 0 ? "excédent" : "manque"} de ${dt(Math.abs(r.varianceTnd))} entre les espèces comptées et les espèces attendues.`,
        centerId,
        day: r.day,
      });
    }
  }
  return out;
}

// ───────────── Prévision du chiffre d'affaires du mois ─────────────
// Résultat de la prévision, prêt à être affiché.
export type Forecast = {
  actualToDate: number; // CA déjà encaissé depuis le 1er du mois
  forecastRemaining: number; // CA prévu pour les jours restants
  forecastTotal: number; // total prévu pour le mois = réalisé + prévu
  low: number; // borne basse de la fourchette (~80 % de confiance)
  high: number; // borne haute
  trend: number; // 1.05 = +5 % sur les 4 dernières semaines
  backtestError: number | null; // erreur moyenne relative sur les 4 dernières semaines (MAPE hebdomadaire)
  days: { day: string; value: number; predicted: boolean }[]; // détail jour par jour (pour le graphique)
};

// Prévision d'une journée : moyenne des 8 derniers mêmes jours de la semaine.
// Renvoie, pour chaque jour de la semaine (0 à 6), la moyenne (`mean`) et les valeurs brutes (`values`).
function weekdayMeans(history: DayPoint[]) {
  const means = new Map<number, { mean: number; values: number[] }>();
  for (let wd = 0; wd < 7; wd++) {
    const values = history.filter((p) => p.weekday === wd).slice(-8).map((p) => p.value);
    means.set(wd, { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, values });
  }
  return means;
}

// Facteur de tendance : compare les 28 derniers jours aux 28 jours précédents.
// Exemple : 1,10 = le salon progresse de ~10 %. Renvoie 1 (= pas de tendance) s'il manque d'historique.
function trendFactor(history: DayPoint[]) {
  if (history.length < 56) return 1; // il faut au moins 2 × 28 jours
  const sum = (list: DayPoint[]) => list.reduce((n, p) => n + p.value, 0);
  const last = sum(history.slice(-28));
  const prev = sum(history.slice(-56, -28));
  if (prev <= 0) return 1;
  // Tendance amortie (racine) et bornée : on ne projette pas une semaine exceptionnelle sur tout le mois.
  // sqrt() atténue le ratio (1,44 → 1,2) ; min/max l'enferment entre 0,85 et 1,15 (±15 %).
  return Math.min(1.15, Math.max(0.85, Math.sqrt(last / prev)));
}

// history : jours passés complets (jusqu'à hier inclus), monthToDate : jours du mois déjà écoulés,
// remaining : jours restants du mois (aujourd'hui compris).
// MÉTHODE : prévision d'un jour = (moyenne des mêmes jours de la semaine) × (facteur de tendance).
export function forecastMonth(history: DayPoint[], monthToDate: DayPoint[], remaining: Omit<DayPoint, "value">[]): Forecast {
  const means = weekdayMeans(history);
  const trend = trendFactor(history);
  // Valeur prévue de chaque jour restant.
  const predicted = remaining.map((d) => ({ ...d, value: roundTnd((means.get(d.weekday)?.mean ?? 0) * trend) }));
  const actualToDate = roundTnd(monthToDate.reduce((n, p) => n + p.value, 0));
  const forecastRemaining = roundTnd(predicted.reduce((n, p) => n + p.value, 0));

  // Incertitude : écart-type des valeurs de chaque jour de la semaine, cumulé sur les jours restants.
  // Statistique : la VARIANCE de la somme de jours indépendants = somme des variances.
  const variance = predicted.reduce((n, d) => {
    const { mean, values } = means.get(d.weekday)!;
    // Variance d'échantillon : Σ(x − moyenne)² ÷ (n − 1).
    const v = values.length > 1 ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1) : 0;
    return n + v;
  }, 0);
  // 1,28 = valeur de la loi normale pour un intervalle à 80 % (10 % de chaque côté).
  const margin = 1.28 * Math.sqrt(variance); // intervalle ~80 %

  return {
    actualToDate,
    forecastRemaining,
    forecastTotal: roundTnd(actualToDate + forecastRemaining),
    // La borne basse ne peut pas être inférieure à ce qui est déjà encaissé (on ne « dé-encaisse » pas).
    low: roundTnd(Math.max(actualToDate, actualToDate + forecastRemaining - margin)),
    high: roundTnd(actualToDate + forecastRemaining + margin),
    trend,
    backtestError: backtest(history),
    // Série jour par jour : jours réels (predicted: false) puis jours prévus (predicted: true).
    days: [
      ...monthToDate.map((p) => ({ day: p.day, value: p.value, predicted: false })),
      ...predicted.map((p) => ({ day: p.day, value: p.value, predicted: true })),
    ],
  };
}

// Qualité du modèle : on prévoit chacune des 4 dernières semaines avec l'historique qui la précède.
// C'est le « backtest » : on se place dans le passé, on prévoit une semaine, puis on compare au réel.
// Résultat = erreur relative moyenne (0,10 = on se trompe en moyenne de 10 %), affichée à l'utilisateur
// pour qu'il sache quelle confiance accorder à la prévision (principe d'honnêteté de l'IA).
export function backtest(history: DayPoint[]) {
  const errors: number[] = [];
  // w = 4, 3, 2, 1 : on teste la semaine d'il y a 4, 3, 2 puis 1 semaine(s).
  for (let w = 4; w >= 1; w--) {
    const cut = history.length - w * 7; // indice du début de la semaine testée
    if (cut < 28) continue; // pas assez d'historique avant cette semaine
    const past = history.slice(0, cut); // ce que le modèle « connaissait » à l'époque
    const week = history.slice(cut, cut + 7); // la semaine à prévoir
    const means = weekdayMeans(past);
    const trend = trendFactor(past);
    const predicted = week.reduce((n, p) => n + (means.get(p.weekday)?.mean ?? 0) * trend, 0);
    const actual = week.reduce((n, p) => n + p.value, 0);
    // Erreur relative = |prévu − réel| ÷ réel.
    if (actual > 0) errors.push(Math.abs(predicted - actual) / actual);
  }
  return errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
}
