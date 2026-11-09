import { Types } from "mongoose";
import { StockLevel, StockMovement } from "@/lib/models/stock";
import { MAX_STOCK_QUANTITY } from "./levels";
import { verifyLedger, projectLevel, type LedgerIssue, type LedgerKey } from "./ledger";

// Module 5 (IA) — Historique de consommation SIMULÉ, pour voir et tester la prévision depuis l'application sans attendre des semaines de vrais
// rendez-vous. Outil de développement lancé à la main (scripts/stock-simulate-history.ts), jamais appelé par l'application.
//
// Ce qu'il écrit : uniquement des mouvements du journal (StockMovement) et la projection du niveau (StockLevel) d'UN produit dans UN centre :
// un stock initial antidaté, puis une consommation par jour, de façon que le stock final soit exactement celui demandé. Aucun rendez-vous,
// aucune facture, aucune autre collection : les consommations pointent vers des rendez-vous FICTIFS (identifiants qui n'existent pas).
//
// Garde-fous : le produit doit déjà être activé dans le centre (depuis l'application) avec un journal VIDE, donc jamais de mélange avec de vrais
// mouvements ; tous les mouvements écrits portent la note SIMULATION_NOTE ; l'annulation (undo) ne supprime que des mouvements portant cette
// note et refuse s'il y a le moindre vrai mouvement. Le journal reste cohérent (rangs contigus, soldes exacts : verifyLedger).

export const SIMULATION_NOTE = "Simulation de démonstration";
export const MIN_DAYS = 14;
export const MAX_DAYS = 120;
const DAY_MS = 86_400_000;
// Profil de la semaine (lundi → dimanche) : le samedi consomme le plus, le dimanche le moins.
const WEEK_PROFILE = [0.6, 0.9, 1, 1, 1.1, 1.8, 0.4];

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

export type SimulationPlan = {
  openingAt: Date;
  opening: number;
  stock: number;
  total: number;
  days: { at: Date; quantity: number }[];
};

export type PlanInput = { perDay: number; days: number; stock: number; flat?: boolean; now?: Date };

const isInt = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

// Calcul pur : quantité de chaque jour (déterministe), stock initial et date de chaque mouvement.
export function planHistory(input: PlanInput): SimulationPlan {
  const { perDay, days, stock, flat = false, now = new Date() } = input;
  if (!isInt(perDay, 1, 1_000_000)) throw new SimulationError("La consommation par jour doit être un entier entre 1 et 1 000 000.");
  if (!isInt(days, MIN_DAYS, MAX_DAYS)) throw new SimulationError(`La durée doit être un nombre entier de jours entre ${MIN_DAYS} et ${MAX_DAYS}.`);
  if (!isInt(stock, 0, MAX_STOCK_QUANTITY)) throw new SimulationError("Le stock final doit être un entier positif ou nul.");

  // 10 h UTC : le même jour civil à Tunis (UTC+1) quel que soit le fuseau de la machine.
  const dayAt = (daysAgo: number) => {
    const d = new Date(now.getTime() - daysAgo * DAY_MS);
    d.setUTCHours(10, 0, 0, 0);
    return d;
  };
  const list = Array.from({ length: days }, (_, i) => {
    const daysAgo = days - i;
    const at = dayAt(daysAgo);
    const factor = flat ? 1 : WEEK_PROFILE[(at.getUTCDay() + 6) % 7] * (1 + 0.08 * Math.sin(daysAgo * 1.7));
    return { at, quantity: Math.max(1, Math.round(perDay * factor)) };
  });
  const total = list.reduce((sum, d) => sum + d.quantity, 0);
  if (total + stock > MAX_STOCK_QUANTITY) throw new SimulationError("Quantités trop grandes : réduisez la consommation par jour ou la durée.");
  return { openingAt: dayAt(days + 4), opening: total + stock, stock, total, days: list };
}

export type SimulationResult = { movements: number; total: number; stock: number; issues: LedgerIssue[] };

// Contrôles préalables, aussi utilisés par --dry-run : le produit est activé dans le centre et son journal est vide. Ne modifie rien.
export async function assertSimulationTarget(key: LedgerKey): Promise<void> {
  const level = await StockLevel.findOne(key).select("_id").lean();
  if (!level) throw new SimulationError("Ce produit n'est pas activé dans ce centre : activez-le d'abord depuis l'application (stock initial à 0).");
  if (await StockMovement.exists(key)) {
    throw new SimulationError("Ce produit a déjà des mouvements dans ce centre : la simulation ne travaille que sur un produit neuf (stock initial 0) pour ne jamais mélanger de fausses données à de vraies. Créez un nouveau produit.");
  }
}

// Écrit la simulation (après les contrôles préalables).
export async function applySimulation(key: LedgerKey, plan: SimulationPlan): Promise<SimulationResult> {
  await assertSimulationTarget(key);
  let balance = plan.opening;
  const docs: Record<string, unknown>[] = [{ ...key, kind: "OPENING", seq: 1, delta: balance, balanceAfter: balance, note: SIMULATION_NOTE, createdAt: plan.openingAt }];
  plan.days.forEach((day, i) => {
    balance -= day.quantity;
    docs.push({
      ...key,
      kind: "CONSUMPTION",
      seq: i + 2,
      delta: -day.quantity,
      balanceAfter: balance,
      requested: day.quantity,
      shortfall: 0,
      // Rendez-vous FICTIF : l'identifiant n'existe dans aucune collection de rendez-vous.
      bookingId: new Types.ObjectId(),
      note: SIMULATION_NOTE,
      createdAt: day.at,
    });
  });
  await StockMovement.insertMany(docs, { ordered: true });
  await projectLevel({ ...key, seq: docs.length, balanceAfter: balance });
  const report = await verifyLedger(key);
  return { movements: docs.length, total: plan.total, stock: balance, issues: report.issues };
}

// Retire la simulation d'un produit dans un centre. Refuse s'il n'y a rien à retirer ou si un seul mouvement n'est pas une simulation.
export async function undoSimulation(key: LedgerKey): Promise<{ removed: number }> {
  const all = await StockMovement.countDocuments(key);
  if (all === 0) throw new SimulationError("Aucune simulation à retirer pour ce produit dans ce centre.");
  const simulated = await StockMovement.countDocuments({ ...key, note: SIMULATION_NOTE });
  if (simulated !== all) throw new SimulationError("Ce produit contient de vrais mouvements : rien n'est supprimé. Seul un produit entièrement simulé peut être remis à zéro.");
  const result = await StockMovement.deleteMany({ ...key, note: SIMULATION_NOTE });
  // Journal vide : le niveau revient à son état d'activation (aucun mouvement, quantité 0).
  await StockLevel.updateOne(key, { $set: { quantity: 0, seq: 0 } });
  return { removed: result.deletedCount };
}
