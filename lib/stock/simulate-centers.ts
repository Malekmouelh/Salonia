import { Types } from "mongoose";
import type { StockUnit } from "@/lib/enums";
import { StockMovement } from "@/lib/models/stock";
import { projectLevel, type LedgerKey } from "./ledger";
import { SIMULATION_NOTE } from "./simulate-history";

// Module 5 (IA) — Scénario de consommation SIMULÉ sur plusieurs centres, pour démontrer l'analyse entre centres (lib/stock/insights.ts) sans
// attendre des mois de vrais rendez-vous. Outil de démonstration lancé par le script de démo (scripts/stock-forecast-demo.ts), jamais par
// l'application.
//
// Principe : chaque centre reçoit un nombre de rendez-vous par jour (profil de semaine, activité qui peut croître) ; chaque règle d'usage dit quelle
// part des rendez-vous d'un centre consomme un produit et en quelle dose. Un rendez-vous consomme donc PLUSIEURS produits (identifiant partagé), comme
// avec les recettes réelles : l'activité d'un centre se mesure alors comme dans la réalité. Tout est déterministe (même scénario = mêmes mouvements).
//
// Ce que ce fichier écrit : uniquement des mouvements du journal (StockMovement) et le niveau (StockLevel) des couples produit/centre du scénario, avec
// la note SIMULATION_NOTE ; les identifiants de rendez-vous sont FICTIFS. Aucun rendez-vous, aucune facture, aucun autre module.

const DAY_MS = 86_400_000;
const WEEK_PROFILE = [0.6, 0.9, 1, 1, 1.1, 1.8, 0.4]; // lundi → dimanche
const CHUNK = 1000;

// À partir de « fromDaysAgo » jours avant aujourd'hui (et jusqu'à aujourd'hui), la valeur est multipliée par `factor`.
export type Ramp = { fromDaysAgo: number; factor: number };
export type ScenarioProduct = { key: string; name: string; unit: StockUnit; threshold: number };
export type ScenarioCenter = { key: string; bookingsPerDay: number; growth?: Ramp };
export type UseRule = {
  center: string;
  product: string;
  // Part des rendez-vous du centre qui consomment ce produit (0 à 1) et dose par rendez-vous.
  share: number;
  dose: number;
  ramp?: Ramp; // dose multipliée sur la période récente (pic, hausse)
  stopsAfterDaysAgo?: number; // plus aucune consommation depuis ce nombre de jours (stock dormant)
  lossShare?: number; // sorties manuelles = cette part de la consommation des 28 derniers jours
  finalStock: number;
};
export type Scenario = { products: ScenarioProduct[]; centers: ScenarioCenter[]; rules: UseRule[] };

export type PlannedEvent = { at: Date; daysAgo: number; kind: "CONSUMPTION" | "OUT"; quantity: number; booking: number | null };
export type PlannedPair = { center: string; product: string; finalStock: number; opening: number; openingAt: Date; events: PlannedEvent[] };
export type ScenarioPlan = { days: number; totalBookings: number; bookingsByCenter: Record<string, number>; pairs: PlannedPair[] };

// Générateur pseudo-aléatoire déterministe (mulberry32) initialisé par une chaîne.
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) {
    h = Math.imul(h ^ c.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planScenario(scenario: Scenario, days: number, now: Date = new Date()): ScenarioPlan {
  // 10 h UTC : le même jour civil à Tunis (UTC+1) quel que soit le fuseau de la machine.
  const dayAt = (daysAgo: number) => {
    const d = new Date(now.getTime() - daysAgo * DAY_MS);
    d.setUTCHours(10, 0, 0, 0);
    return d;
  };
  const pairs = new Map<string, PlannedPair>();
  for (const rule of scenario.rules) {
    pairs.set(`${rule.center}:${rule.product}`, { center: rule.center, product: rule.product, finalStock: rule.finalStock, opening: 0, openingAt: dayAt(days + 4), events: [] });
  }
  let bookingSeq = 0;
  const bookingsByCenter: Record<string, number> = {};
  for (const center of scenario.centers) {
    const rand = rng(center.key);
    const rules = scenario.rules.filter((r) => r.center === center.key);
    bookingsByCenter[center.key] = 0;
    for (let daysAgo = days; daysAgo >= 1; daysAgo--) {
      const at = dayAt(daysAgo);
      const activity = center.growth && daysAgo <= center.growth.fromDaysAgo ? center.growth.factor : 1;
      const count = Math.max(0, Math.round(center.bookingsPerDay * WEEK_PROFILE[(at.getUTCDay() + 6) % 7] * activity * (1 + 0.1 * Math.sin(daysAgo * 1.3))));
      for (let b = 0; b < count; b++) {
        const booking = bookingSeq++;
        bookingsByCenter[center.key]++;
        for (const rule of rules) {
          const stopped = rule.stopsAfterDaysAgo !== undefined && daysAgo <= rule.stopsAfterDaysAgo;
          const draw = rand();
          if (stopped || draw >= rule.share) continue;
          const factor = rule.ramp && daysAgo <= rule.ramp.fromDaysAgo ? rule.ramp.factor : 1;
          const quantity = Math.max(1, Math.round(rule.dose * factor * (0.9 + 0.2 * rand())));
          pairs.get(`${rule.center}:${rule.product}`)!.events.push({ at: new Date(at.getTime() + b * 60_000), daysAgo, kind: "CONSUMPTION", quantity, booking });
        }
      }
    }
  }
  // Sorties manuelles : tous les 3 jours sur les 28 derniers, une part de la consommation de ces 3 jours.
  for (const rule of scenario.rules) {
    if (!rule.lossShare) continue;
    const pair = pairs.get(`${rule.center}:${rule.product}`)!;
    for (let d = 1; d <= 28; d += 3) {
      const consumed = pair.events.filter((e) => e.kind === "CONSUMPTION" && e.daysAgo >= d && e.daysAgo < d + 3).reduce((s, e) => s + e.quantity, 0);
      const quantity = Math.round(consumed * rule.lossShare);
      if (quantity > 0) pair.events.push({ at: new Date(dayAt(d).getTime() + 5 * 3_600_000), daysAgo: d, kind: "OUT", quantity, booking: null });
    }
  }
  for (const pair of pairs.values()) {
    pair.events.sort((a, b) => a.at.getTime() - b.at.getTime());
    pair.opening = pair.events.reduce((s, e) => s + e.quantity, 0) + pair.finalStock;
  }
  return { days, totalBookings: bookingSeq, bookingsByCenter, pairs: [...pairs.values()] };
}

// Écrit le journal de chaque couple produit/centre (stock initial antidaté, puis les événements dans l'ordre du temps ; stock final exact) et
// projette le niveau. Le produit doit déjà être activé dans le centre avec un journal VIDE (stock initial 0).
export async function writeScenario(plan: ScenarioPlan, keyOf: (center: string, product: string) => LedgerKey): Promise<{ movements: number; pairs: number }> {
  const bookingIds = new Map<number, Types.ObjectId>();
  const bookingId = (n: number) => bookingIds.get(n) ?? bookingIds.set(n, new Types.ObjectId()).get(n)!; // identifiant FICTIF
  let movements = 0;
  for (const pair of plan.pairs) {
    const key = keyOf(pair.center, pair.product);
    let balance = pair.opening;
    const docs: Record<string, unknown>[] = [{ ...key, kind: "OPENING", seq: 1, delta: balance, balanceAfter: balance, note: SIMULATION_NOTE, createdAt: pair.openingAt }];
    for (const e of pair.events) {
      balance -= e.quantity;
      docs.push({
        ...key,
        kind: e.kind,
        seq: docs.length + 1,
        delta: -e.quantity,
        balanceAfter: balance,
        note: SIMULATION_NOTE,
        createdAt: e.at,
        ...(e.kind === "CONSUMPTION" ? { requested: e.quantity, shortfall: 0, bookingId: bookingId(e.booking!) } : {}),
      });
    }
    for (let i = 0; i < docs.length; i += CHUNK) await StockMovement.insertMany(docs.slice(i, i + CHUNK), { ordered: true });
    await projectLevel({ ...key, seq: docs.length, balanceAfter: balance });
    movements += docs.length;
  }
  return { movements, pairs: plan.pairs.length };
}

// Scénario de démonstration : trois centres au comportement différent, six produits qui illustrent chacun une situation réelle.
//  - Tunis : gros centre stable (10 rendez-vous par jour). Sousse : moyen, activité en hausse. Djerba : petit centre.
//  - Coloration 7.0 : Sousse en consomme bien plus PAR rendez-vous (dosage), alors que Tunis est le plus gros centre → comparaison équitable.
//  - Oxydant 30 vol : pic de consommation de la dernière semaine à Sousse.
//  - Shampoing doux : Tunis presque à court, Djerba n'en consomme plus depuis un mois et en garde beaucoup → transfert suggéré, stock immobilisé.
//  - Gants latex : Sousse sort à la main l'équivalent de 40 % de ce que ses rendez-vous consomment (près de 3 sorties sur 10) → sorties à vérifier.
//  - Spray fixateur : hausse nette à Tunis. Lotion tonique : produit rarement utilisé.
export const DEMO_SCENARIO: Scenario = {
  products: [
    { key: "color", name: "Coloration 7.0", unit: "G", threshold: 500 },
    { key: "developer", name: "Oxydant 30 vol", unit: "ML", threshold: 500 },
    { key: "shampoo", name: "Shampoing doux", unit: "ML", threshold: 300 },
    { key: "gloves", name: "Gants latex", unit: "PIECE", threshold: 50 },
    { key: "spray", name: "Spray fixateur", unit: "ML", threshold: 200 },
    { key: "tonic", name: "Lotion tonique", unit: "ML", threshold: 100 },
  ],
  centers: [
    { key: "tunis", bookingsPerDay: 10 },
    { key: "sousse", bookingsPerDay: 6, growth: { fromDaysAgo: 28, factor: 1.5 } },
    { key: "djerba", bookingsPerDay: 3 },
  ],
  rules: [
    { center: "tunis", product: "color", share: 0.45, dose: 40, finalStock: 6000 },
    { center: "sousse", product: "color", share: 0.45, dose: 70, finalStock: 5000 },
    { center: "djerba", product: "color", share: 0.45, dose: 40, finalStock: 3000 },
    { center: "tunis", product: "developer", share: 0.45, dose: 60, finalStock: 8000 },
    { center: "sousse", product: "developer", share: 0.45, dose: 60, ramp: { fromDaysAgo: 7, factor: 3 }, finalStock: 5000 },
    { center: "djerba", product: "developer", share: 0.45, dose: 60, finalStock: 3000 },
    { center: "tunis", product: "shampoo", share: 0.8, dose: 30, finalStock: 1500 },
    { center: "sousse", product: "shampoo", share: 0.8, dose: 30, finalStock: 4000 },
    { center: "djerba", product: "shampoo", share: 0.8, dose: 30, stopsAfterDaysAgo: 30, finalStock: 2500 },
    { center: "tunis", product: "gloves", share: 0.9, dose: 2, finalStock: 800 },
    { center: "sousse", product: "gloves", share: 0.9, dose: 2, lossShare: 0.4, finalStock: 600 },
    { center: "djerba", product: "gloves", share: 0.9, dose: 2, finalStock: 300 },
    { center: "tunis", product: "spray", share: 0.35, dose: 25, ramp: { fromDaysAgo: 28, factor: 1.7 }, finalStock: 3000 },
    { center: "sousse", product: "spray", share: 0.35, dose: 25, finalStock: 2500 },
    { center: "djerba", product: "spray", share: 0.35, dose: 25, finalStock: 1500 },
    { center: "tunis", product: "tonic", share: 0.06, dose: 20, finalStock: 1500 },
    { center: "sousse", product: "tonic", share: 0.05, dose: 20, finalStock: 1500 },
    { center: "djerba", product: "tonic", share: 0.04, dose: 20, finalStock: 1500 },
  ],
};
