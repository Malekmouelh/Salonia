// Module 5 — Synthèse de la vue d'ensemble : toutes les valeurs viennent des lectures des services (fonction pure, sans base).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EquipmentView } from "./equipment";
import { ATTENTION_LIST_LIMIT, MAINTENANCE_LIST_LIMIT, summarizeStock } from "./overview";
import type { PurchaseOrderView } from "./purchase-orders";
import type { StockLevelRow } from "./service";

const level = (name: string, quantity: number, alertThreshold: number, extra: Partial<StockLevelRow> = {}): StockLevelRow => ({
  productId: name,
  productName: name,
  unit: "ML",
  productActive: true,
  centerId: "c1",
  alertThreshold,
  quantity,
  projectedQuantity: quantity,
  lowStock: quantity <= alertThreshold,
  needsRepair: false,
  ...extra,
});
const equipment = (id: string, status: EquipmentView["status"], maintenanceState: EquipmentView["maintenanceState"], active = true): EquipmentView => ({
  id,
  centerId: "c1",
  name: id,
  category: "x",
  status,
  acquiredAt: null,
  nextMaintenanceAt: maintenanceState === "NONE" ? null : "2030-01-01",
  maintenanceState,
  active,
});
const order = (id: string, status: PurchaseOrderView["status"]): PurchaseOrderView => ({
  id,
  centerId: "c1",
  supplierId: "s1",
  supplierName: "S",
  status,
  lines: [],
  orderedAt: null,
  cancelledAt: null,
  receivedAt: null,
  receiving: false,
  createdAt: "2030-01-01T00:00:00.000Z",
});
const base = { activeProductCount: 0, levels: [], equipment: [], schedule: [], orders: [] };

describe("synthèse de la vue d'ensemble", () => {
  it("compte les niveaux à surveiller selon quantité ≤ seuil (au seuil compris), produits archivés exclus", () => {
    const s = summarizeStock({
      ...base,
      activeProductCount: 4,
      levels: [level("sous", 5, 10), level("au-seuil", 10, 10), level("au-dessus", 11, 10), level("archivé", 0, 10, { productActive: false })],
    });
    assert.deepEqual([s.activeProducts, s.levelCount, s.lowStockCount], [4, 3, 2]);
    assert.deepEqual(s.attention.map((l) => l.productName), ["sous", "au-seuil"]);
  });

  it("classe les produits à surveiller du plus critique au moins critique, ordre stable en cas d'égalité, liste bornée", () => {
    const levels = [level("b", 5, 10), level("a", 5, 10), level("rupture", 0, 10), level("seuil nul vide", 0, 0), ...Array.from({ length: 12 }, (_, i) => level(`z${i}`, 9, 10))];
    const s = summarizeStock({ ...base, levels });
    assert.equal(s.attention.length, ATTENTION_LIST_LIMIT);
    assert.deepEqual(s.attention.slice(0, 4).map((l) => l.productName), ["rupture", "seuil nul vide", "a", "b"]);
    assert.equal(s.lowStockCount, levels.length);
  });

  it("compte le matériel actif par état (archivé exclu) et les échéances par état de maintenance", () => {
    const schedule = [equipment("e1", "IN_SERVICE", "OVERDUE"), equipment("e2", "IN_SERVICE", "DUE_TODAY"), equipment("e3", "IN_MAINTENANCE", "SCHEDULED"), ...Array.from({ length: 8 }, (_, i) => equipment(`s${i}`, "IN_SERVICE", "SCHEDULED"))];
    const s = summarizeStock({
      ...base,
      equipment: [equipment("a", "IN_SERVICE", "NONE"), equipment("b", "IN_MAINTENANCE", "NONE"), equipment("c", "OUT_OF_SERVICE", "NONE"), equipment("d", "IN_SERVICE", "NONE", false)],
      schedule,
    });
    assert.deepEqual(s.equipmentByStatus, { IN_SERVICE: 1, IN_MAINTENANCE: 1, OUT_OF_SERVICE: 1 });
    assert.deepEqual([s.maintenance.overdue, s.maintenance.dueToday, s.maintenance.scheduled], [1, 1, 9]);
    assert.equal(s.maintenance.upcoming.length, MAINTENANCE_LIST_LIMIT);
    assert.deepEqual(s.maintenance.upcoming.slice(0, 2).map((e) => e.id), ["e1", "e2"]);
  });

  it("répartit les commandes par statut et signale les projections à réaligner", () => {
    const s = summarizeStock({
      ...base,
      levels: [level("a", 1, 0, { needsRepair: true }), level("b", 1, 0)],
      orders: [order("1", "DRAFT"), order("2", "DRAFT"), order("3", "ORDERED"), order("4", "RECEIVED"), order("5", "CANCELLED")],
    });
    assert.deepEqual(s.ordersByStatus, { DRAFT: 2, ORDERED: 1, RECEIVED: 1, CANCELLED: 1 });
    assert.equal(s.needsRepairCount, 1);
  });

  it("une organisation sans donnée donne des zéros, pas d'erreur", () => {
    const s = summarizeStock(base);
    assert.deepEqual([s.activeProducts, s.levelCount, s.lowStockCount, s.needsRepairCount, s.attention.length, s.maintenance.upcoming.length], [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(Object.values(s.equipmentByStatus), [0, 0, 0]);
    assert.deepEqual(Object.values(s.ordersByStatus), [0, 0, 0, 0]);
  });
});
