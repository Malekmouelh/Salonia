// Module 5 (étape 5) — Règles pures : dates, échéances de maintenance, cycle de vie des commandes, validation des nouveaux
// modèles et des schémas. AUCUNE base de données. L'unicité réelle des index est vérifiée dans les tests de services.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types, type Document } from "mongoose";
import { fromLocal } from "@/lib/booking/time";
import { PURCHASE_ORDER_STATUSES, type PurchaseOrderStatus } from "@/lib/enums";
import { MaintenanceRecord, PurchaseOrder, Supplier } from "@/lib/models/stock";
import { formatDate, isAfterToday, parseDate } from "./dates";
import { maintenanceState } from "./maintenance";
import { CAN_CANCEL_FROM, CAN_ORDER_FROM, ORDER_TRANSITIONS, canTransitionOrder, checkReceiptConsistency, type OrderForReceipt } from "./orders";
import {
  CreateEquipmentSchema,
  CreatePurchaseOrderSchema,
  CreateSupplierSchema,
  MaintenanceInputSchema,
  UpdateEquipmentSchema,
  UpdatePurchaseOrderSchema,
  UpdateSupplierSchema,
} from "./schemas";

const hex = () => String(new Types.ObjectId());
const invalidPaths = async (doc: Document): Promise<string[]> => {
  try {
    await doc.validate();
    return [];
  } catch (error) {
    return Object.keys((error as { errors?: object }).errors ?? {}).sort();
  }
};

describe("dates (jour, heure de Tunis)", () => {
  it("accepte une vraie date et la place à minuit heure de Tunis", () => {
    const d = parseDate("2030-03-15")!;
    assert.equal(d.getTime(), fromLocal(2030, 3, 15).getTime());
    assert.equal(formatDate(d), "2030-03-15");
    assert.equal(formatDate(null), null);
  });

  it("refuse un format faux, un jour inexistant ou une année absurde", () => {
    for (const bad of ["", "2030-3-5", "15/03/2030", "2030-02-30", "2030-13-01", "2030-00-10", "1800-01-01", "2200-01-01", "2030-03-15T00:00:00Z", " 2030-03-15"]) {
      assert.equal(parseDate(bad), null, bad);
    }
    assert.notEqual(parseDate("2028-02-29"), null); // année bissextile
    assert.equal(parseDate("2029-02-29"), null);
  });

  it("isAfterToday compare le jour local : aujourd'hui n'est pas dans le futur", () => {
    const now = fromLocal(2030, 3, 15, 23, 30); // 23h30 à Tunis
    assert.equal(isAfterToday(parseDate("2030-03-15")!, now), false);
    assert.equal(isAfterToday(parseDate("2030-03-14")!, now), false);
    assert.equal(isAfterToday(parseDate("2030-03-16")!, now), true);
  });
});

describe("échéance de maintenance (calcul à la lecture, sans rappel de fond)", () => {
  const now = fromLocal(2030, 3, 15, 10, 0);
  it("sans date : aucune échéance", () => {
    assert.equal(maintenanceState(null, now), "NONE");
    assert.equal(maintenanceState(undefined, now), "NONE");
  });
  it("jour passé : en retard · aujourd'hui : échéance du jour · plus tard : planifiée", () => {
    assert.equal(maintenanceState(parseDate("2030-03-14"), now), "OVERDUE");
    assert.equal(maintenanceState(parseDate("2030-03-15"), now), "DUE_TODAY");
    assert.equal(maintenanceState(parseDate("2030-03-16"), now), "SCHEDULED");
  });
  it("l'heure de la journée ne change pas le verdict du jour", () => {
    assert.equal(maintenanceState(parseDate("2030-03-15"), fromLocal(2030, 3, 15, 0, 1)), "DUE_TODAY");
    assert.equal(maintenanceState(parseDate("2030-03-15"), fromLocal(2030, 3, 15, 23, 59)), "DUE_TODAY");
    assert.equal(maintenanceState(parseDate("2030-03-15"), fromLocal(2030, 3, 16, 0, 1)), "OVERDUE");
  });
});

describe("cycle de vie d'une commande : transitions", () => {
  const allowed: [PurchaseOrderStatus, PurchaseOrderStatus][] = [
    ["DRAFT", "ORDERED"],
    ["DRAFT", "CANCELLED"],
    ["ORDERED", "CANCELLED"],
    ["ORDERED", "RECEIVED"],
  ];
  it("seules les quatre transitions prévues sont permises, toutes les autres sont refusées", () => {
    for (const from of PURCHASE_ORDER_STATUSES) {
      for (const to of PURCHASE_ORDER_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        assert.equal(canTransitionOrder(from, to), expected, `${from} → ${to}`);
      }
    }
  });
  it("RECEIVED et CANCELLED sont des états finaux ; aucun retour en brouillon", () => {
    assert.deepEqual(ORDER_TRANSITIONS.RECEIVED, []);
    assert.deepEqual(ORDER_TRANSITIONS.CANCELLED, []);
    for (const from of PURCHASE_ORDER_STATUSES) assert.equal(canTransitionOrder(from, "DRAFT"), false, from);
  });
  it("les filtres atomiques des services correspondent à la table (la réception n'est pas proposée)", () => {
    assert.deepEqual([...CAN_ORDER_FROM], ["DRAFT"]);
    assert.deepEqual([...CAN_CANCEL_FROM], ["DRAFT", "ORDERED"]);
    for (const from of CAN_ORDER_FROM) assert.equal(canTransitionOrder(from, "ORDERED"), true);
    for (const from of CAN_CANCEL_FROM) assert.equal(canTransitionOrder(from, "CANCELLED"), true);
  });
});

describe("modèles : validation et index", () => {
  const line = (extra: Record<string, unknown> = {}) => ({ productId: hex(), productName: "Shampoing", unit: "ML", quantity: 10, ...extra });
  const order = (extra: Record<string, unknown> = {}) => new PurchaseOrder({ organizationId: hex(), centerId: hex(), supplierId: hex(), supplierName: "Distri", lines: [line()], ...extra });

  it("commande : brouillon par défaut, une à cinquante lignes, un produit une seule fois", async () => {
    const o = order();
    assert.deepEqual(await invalidPaths(o), []);
    assert.equal(o.status, "DRAFT");
    assert.ok((await invalidPaths(order({ lines: [] }))).includes("lines"));
    assert.ok((await invalidPaths(order({ lines: Array.from({ length: 51 }, () => line()) }))).includes("lines"));
    const dup = hex();
    assert.ok((await invalidPaths(order({ lines: [line({ productId: dup }), line({ productId: dup })] }))).includes("lines"));
    assert.deepEqual(await invalidPaths(order({ lines: Array.from({ length: 50 }, () => line()) })), []);
  });

  it("commande : quantité entière positive, unité connue, statut connu", async () => {
    for (const quantity of [0, -1, 1.5]) assert.ok((await invalidPaths(order({ lines: [line({ quantity })] }))).some((p) => p.includes("quantity")), String(quantity));
    assert.ok((await invalidPaths(order({ lines: [line({ unit: "L" })] }))).some((p) => p.includes("unit")));
    assert.ok((await invalidPaths(order({ status: "SHIPPED" }))).includes("status"));
  });

  it("intervention de maintenance : l'échéance suivante ne précède pas l'intervention ; les champs sont immuables", async () => {
    const base = { organizationId: hex(), centerId: hex(), equipmentId: hex(), performedAt: parseDate("2030-03-10") };
    assert.deepEqual(await invalidPaths(new MaintenanceRecord({ ...base, nextDueAt: parseDate("2030-09-10") })), []);
    assert.deepEqual(await invalidPaths(new MaintenanceRecord({ ...base, nextDueAt: parseDate("2030-03-10") })), []);
    assert.deepEqual(await invalidPaths(new MaintenanceRecord({ ...base, nextDueAt: parseDate("2030-03-09") })), ["nextDueAt"]);
    assert.ok((await invalidPaths(new MaintenanceRecord({ ...base, note: "x".repeat(201) }))).includes("note"));
    const stored = MaintenanceRecord.hydrate({ ...base, note: "Révision" });
    stored.set("note", "Modifiée");
    stored.set("performedAt", parseDate("2031-01-01"));
    assert.equal(stored.note, "Révision");
    assert.equal(formatDate(stored.performedAt), "2030-03-10");
  });

  it("fournisseur : délai de 0 à 365 jours entier, par défaut 0", async () => {
    const base = { organizationId: hex(), name: "Distri" };
    assert.equal(new Supplier(base).leadTimeDays, 0);
    for (const leadTimeDays of [0, 7, 365]) assert.deepEqual(await invalidPaths(new Supplier({ ...base, leadTimeDays })), [], String(leadTimeDays));
    for (const leadTimeDays of [-1, 366, 2.5]) assert.deepEqual(await invalidPaths(new Supplier({ ...base, leadTimeDays })), ["leadTimeDays"], String(leadTimeDays));
  });

  it("index : nom de fournisseur actif unique ; commandes indexées par centre/statut et par fournisseur ; historique par équipement", () => {
    const name = Supplier.schema.indexes().find(([f]) => "name" in f);
    assert.deepEqual(name?.[0], { organizationId: 1, name: 1 });
    assert.equal(name?.[1]?.unique, true);
    assert.deepEqual(name?.[1]?.partialFilterExpression, { active: true });
    assert.equal(name?.[1]?.collation?.strength, 2);
    assert.ok(PurchaseOrder.schema.indexes().some(([f]) => "status" in f && "centerId" in f && "organizationId" in f));
    assert.ok(PurchaseOrder.schema.indexes().some(([f]) => "supplierId" in f));
    assert.deepEqual(MaintenanceRecord.schema.indexes().find(([f]) => "equipmentId" in f)?.[0], { equipmentId: 1, performedAt: -1 });
  });
});

describe("schémas : saisies et champs inconnus", () => {
  it("équipement : dates converties à minuit de Tunis, état par défaut, clés inconnues ignorées", () => {
    const r = CreateEquipmentSchema.safeParse({ name: " Séchoir ", category: "Séchoir", acquiredAt: "2029-12-01", nextMaintenanceAt: "2030-06-01", organizationId: hex(), active: false, centerId: hex() });
    assert.equal(r.success, true);
    if (!r.success) return;
    assert.equal(r.data.name, "Séchoir");
    assert.equal(r.data.status, "IN_SERVICE");
    assert.equal(r.data.acquiredAt?.getTime(), fromLocal(2029, 12, 1).getTime());
    assert.ok(!("organizationId" in r.data) && !("active" in r.data) && !("centerId" in r.data));
  });

  it("équipement : refuse état inconnu, date invalide, nom vide ; la mise à jour exige au moins un champ", () => {
    assert.equal(CreateEquipmentSchema.safeParse({ name: "x", category: "y", status: "BROKEN" }).success, false);
    assert.equal(CreateEquipmentSchema.safeParse({ name: "x", category: "y", nextMaintenanceAt: "2030-02-30" }).success, false);
    assert.equal(CreateEquipmentSchema.safeParse({ name: "  ", category: "y" }).success, false);
    assert.equal(UpdateEquipmentSchema.safeParse({ equipmentId: hex() }).success, false);
    assert.equal(UpdateEquipmentSchema.safeParse({ equipmentId: hex(), nextMaintenanceAt: null }).success, true); // null = effacer
  });

  it("maintenance : l'échéance suivante ne précède pas l'intervention", () => {
    const base = { equipmentId: hex(), performedAt: "2030-03-10" };
    assert.equal(MaintenanceInputSchema.safeParse({ ...base, nextDueAt: "2030-09-10" }).success, true);
    assert.equal(MaintenanceInputSchema.safeParse({ ...base, nextDueAt: "2030-03-09" }).success, false);
    assert.equal(MaintenanceInputSchema.safeParse({ ...base, note: "x".repeat(201) }).success, false);
    assert.equal(MaintenanceInputSchema.safeParse({ ...base, performedAt: "pas une date" }).success, false);
  });

  it("fournisseur : téléphone tunisien normalisé, e-mail en minuscules, valeurs vides = pas de coordonnée", () => {
    const r = CreateSupplierSchema.parse({ name: " Distri ", phone: "+216 22 345 678", email: " Contact@Distri.TN ", leadTimeDays: 5 });
    assert.deepEqual([r.name, r.phone, r.email, r.leadTimeDays], ["Distri", "22345678", "contact@distri.tn", 5]);
    const empty = CreateSupplierSchema.parse({ name: "X", phone: "", email: null });
    assert.deepEqual([empty.phone, empty.email, empty.leadTimeDays], [null, null, 0]);
    for (const phone of ["12345678", "2234", "abcdefgh", 22345678, {}]) assert.equal(CreateSupplierSchema.safeParse({ name: "X", phone }).success, false, String(phone));
    for (const email of ["pas-un-mail", "a@", 5, {}]) assert.equal(CreateSupplierSchema.safeParse({ name: "X", email }).success, false, String(email));
    for (const leadTimeDays of [-1, 366, 1.5, "5"]) assert.equal(CreateSupplierSchema.safeParse({ name: "X", leadTimeDays }).success, false, String(leadTimeDays));
    assert.equal(UpdateSupplierSchema.safeParse({ supplierId: hex() }).success, false);
    assert.equal(UpdateSupplierSchema.safeParse({ supplierId: hex(), phone: null }).success, true);
  });

  it("commande : seuls produit et quantité viennent du client ; doublons (même en casse différente), lignes vides ou trop nombreuses refusés", () => {
    const productId = hex();
    const ok = CreatePurchaseOrderSchema.safeParse({ supplierId: hex(), lines: [{ productId, quantity: 5, productName: "Pirate", unit: "G", price: 0 }], status: "RECEIVED" });
    assert.equal(ok.success, true);
    if (ok.success) assert.deepEqual(ok.data.lines, [{ productId, quantity: 5 }]);
    const lines = (n: number) => Array.from({ length: n }, () => ({ productId: hex(), quantity: 1 }));
    assert.equal(CreatePurchaseOrderSchema.safeParse({ supplierId: hex(), lines: [] }).success, false);
    assert.equal(CreatePurchaseOrderSchema.safeParse({ supplierId: hex(), lines: lines(51) }).success, false);
    assert.equal(CreatePurchaseOrderSchema.safeParse({ supplierId: hex(), lines: lines(50) }).success, true);
    assert.equal(CreatePurchaseOrderSchema.safeParse({ supplierId: hex(), lines: [{ productId: productId.toLowerCase(), quantity: 1 }, { productId: productId.toUpperCase(), quantity: 2 }] }).success, false);
    for (const quantity of [0, -3, 2.5, "4", null]) assert.equal(CreatePurchaseOrderSchema.safeParse({ supplierId: hex(), lines: [{ productId, quantity }] }).success, false, String(quantity));
    assert.equal(CreatePurchaseOrderSchema.safeParse({ supplierId: { $ne: "" }, lines: lines(1) }).success, false);
    assert.equal(UpdatePurchaseOrderSchema.safeParse({ orderId: hex() }).success, false);
  });
});

describe("cohérence d'une commande et de ses réceptions (pur)", () => {
  const order = (extra: Partial<OrderForReceipt> = {}): OrderForReceipt => ({
    status: "ORDERED",
    centerId: "c1",
    receiptStartedAt: null,
    lines: [{ productId: "p1", quantity: 50 }, { productId: "p2", quantity: 20 }],
    ...extra,
  });
  const receipt = (productId: string, delta: number, centerId = "c1") => ({ productId, centerId, delta });

  it("cohérente : aucune réception, réceptions partielles ou complètes aux bonnes quantités", () => {
    assert.equal(checkReceiptConsistency(order(), []), null);
    assert.equal(checkReceiptConsistency(order({ receiptStartedAt: new Date() }), [receipt("p1", 50)]), null);
    assert.equal(checkReceiptConsistency(order(), [receipt("p1", 50), receipt("p2", 20)]), null);
    assert.equal(checkReceiptConsistency(order({ status: "RECEIVED" }), [receipt("p1", 50), receipt("p2", 20)]), null);
  });

  it("incohérente : brouillon ou annulée avec réception ou début de réception", () => {
    for (const status of ["DRAFT", "CANCELLED"] as const) {
      assert.equal(checkReceiptConsistency(order({ status }), [receipt("p1", 50)]), "RECEIPT_ON_UNPLACED_ORDER", status);
      assert.equal(checkReceiptConsistency(order({ status, receiptStartedAt: new Date() }), []), "RECEIPT_ON_UNPLACED_ORDER", status);
      assert.equal(checkReceiptConsistency(order({ status }), []), null, status);
    }
  });

  it("incohérente : quantité différente, mauvais centre, produit hors commande, réception en double, lignes en double, reçue sans toutes ses réceptions", () => {
    assert.equal(checkReceiptConsistency(order(), [receipt("p1", 49)]), "RECEIPT_WRONG_QUANTITY");
    assert.equal(checkReceiptConsistency(order(), [receipt("p1", 50, "c2")]), "RECEIPT_WRONG_CENTER");
    assert.equal(checkReceiptConsistency(order(), [receipt("p9", 5)]), "RECEIPT_WITHOUT_LINE");
    assert.equal(checkReceiptConsistency(order(), [receipt("p1", 50), receipt("p1", 50)]), "DUPLICATE_RECEIPT");
    assert.equal(checkReceiptConsistency(order({ lines: [{ productId: "p1", quantity: 1 }, { productId: "p1", quantity: 2 }] }), []), "DUPLICATE_LINES");
    assert.equal(checkReceiptConsistency(order({ status: "RECEIVED" }), [receipt("p1", 50)]), "RECEIVED_WITH_MISSING_RECEIPTS");
    assert.equal(checkReceiptConsistency(order({ status: "RECEIVED" }), []), "RECEIVED_WITH_MISSING_RECEIPTS");
  });
});
