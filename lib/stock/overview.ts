import type { EquipmentStatus, PurchaseOrderStatus } from "@/lib/enums";
import { EQUIPMENT_STATUSES, PURCHASE_ORDER_STATUSES } from "@/lib/enums";
import type { EquipmentView } from "./equipment";
import type { PurchaseOrderView } from "./purchase-orders";
import type { StockLevelRow } from "./service";

// Module 5 — Synthèse de la vue d'ensemble du stock. Fonction PURE : tous les chiffres viennent des lectures des services (niveaux,
// matériel, échéancier, commandes), jamais de valeurs écrites en dur. L'alerte de stock bas est celle des niveaux (quantité ≤ seuil).

export const ATTENTION_LIST_LIMIT = 8;
export const MAINTENANCE_LIST_LIMIT = 6;

export type StockSummary = {
  activeProducts: number;
  levelCount: number;
  lowStockCount: number;
  needsRepairCount: number;
  // Produits à surveiller, du plus critique (rapport quantité/seuil le plus bas) au moins critique.
  attention: StockLevelRow[];
  equipmentByStatus: Record<EquipmentStatus, number>;
  maintenance: { overdue: number; dueToday: number; scheduled: number; upcoming: EquipmentView[] };
  ordersByStatus: Record<PurchaseOrderStatus, number>;
};

// Plus le rapport est bas, plus le produit est critique ; un seuil de 0 compte comme critique dès que la quantité est 0.
const criticality = (l: StockLevelRow) => (l.alertThreshold > 0 ? l.quantity / l.alertThreshold : l.quantity);

export function summarizeStock(input: {
  activeProductCount: number;
  levels: StockLevelRow[];
  equipment: EquipmentView[];
  schedule: EquipmentView[];
  orders: PurchaseOrderView[];
}): StockSummary {
  const active = input.levels.filter((l) => l.productActive);
  const low = active.filter((l) => l.lowStock).sort((a, b) => criticality(a) - criticality(b) || a.productName.localeCompare(b.productName, "fr"));
  const equipmentByStatus = Object.fromEntries(EQUIPMENT_STATUSES.map((s) => [s, 0])) as Record<EquipmentStatus, number>;
  for (const e of input.equipment) if (e.active) equipmentByStatus[e.status]++;
  const ordersByStatus = Object.fromEntries(PURCHASE_ORDER_STATUSES.map((s) => [s, 0])) as Record<PurchaseOrderStatus, number>;
  for (const o of input.orders) ordersByStatus[o.status]++;
  const count = (state: string) => input.schedule.filter((e) => e.maintenanceState === state).length;
  return {
    activeProducts: input.activeProductCount,
    levelCount: active.length,
    lowStockCount: low.length,
    needsRepairCount: input.levels.filter((l) => l.needsRepair).length,
    attention: low.slice(0, ATTENTION_LIST_LIMIT),
    equipmentByStatus,
    maintenance: { overdue: count("OVERDUE"), dueToday: count("DUE_TODAY"), scheduled: count("SCHEDULED"), upcoming: input.schedule.slice(0, MAINTENANCE_LIST_LIMIT) },
    ordersByStatus,
  };
}
