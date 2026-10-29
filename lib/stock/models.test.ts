// Module 5 (étape 1) — Modèles du stock : validation et définition des index.
// AUCUNE base de données : seuls la validation Mongoose (validateSync) et les définitions d'index sont examinés.
// Ces tests ne prouvent PAS l'unicité réelle côté serveur, l'idempotence ni la concurrence (étapes suivantes, base en mémoire).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types, type Document } from "mongoose";
import { Equipment, ServiceRecipe, StockLevel, StockMovement, StockProduct } from "@/lib/models/stock";

const id = () => new Types.ObjectId();
const org = id();
const center = id();
const product = id();

// validate() (et non validateSync) : seul lui exécute le hook pre("validate") du journal. Aucune base n'est nécessaire.
const invalidPaths = async (doc: Document): Promise<string[]> => {
  try {
    await doc.validate();
    return [];
  } catch (error) {
    return Object.keys((error as { errors?: object }).errors ?? {}).sort();
  }
};

describe("Equipment", () => {
  it("accepte une fiche minimale et applique les valeurs par défaut", async () => {
    const e = new Equipment({ organizationId: org, centerId: center, name: "Séchoir", category: "Séchoir" });
    assert.deepEqual(await invalidPaths(e), []);
    assert.equal(e.status, "IN_SERVICE");
    assert.equal(e.active, true);
    assert.equal(e.nextMaintenanceAt, null);
  });
  it("exige organisation, centre, nom et catégorie ; refuse un état inconnu", async () => {
    assert.deepEqual(await invalidPaths(new Equipment({})), ["category", "centerId", "name", "organizationId"]);
    assert.deepEqual(await invalidPaths(new Equipment({ organizationId: org, centerId: center, name: "x", category: "y", status: "BROKEN" })), ["status"]);
  });
  it("accepte les trois états", async () => {
    for (const status of ["IN_SERVICE", "IN_MAINTENANCE", "OUT_OF_SERVICE"]) {
      assert.deepEqual(await invalidPaths(new Equipment({ organizationId: org, centerId: center, name: "x", category: "y", status })), []);
    }
  });
});

describe("StockProduct", () => {
  it("accepte PIECE, ML et G ; refuse les autres unités", async () => {
    for (const unit of ["PIECE", "ML", "G"]) assert.deepEqual(await invalidPaths(new StockProduct({ organizationId: org, name: "Gel", unit })), []);
    for (const unit of ["L", "KG", ""]) assert.deepEqual(await invalidPaths(new StockProduct({ organizationId: org, name: "Gel", unit })), ["unit"]);
  });
  it("définit un nom unique par organisation, insensible à la casse, parmi les produits actifs", async () => {
    const [fields, options] = StockProduct.schema.indexes().find(([f]) => "name" in f) ?? [];
    assert.deepEqual(fields, { organizationId: 1, name: 1 });
    assert.equal(options?.unique, true);
    assert.deepEqual(options?.partialFilterExpression, { active: true });
    assert.equal(options?.collation?.strength, 2);
  });
});

describe("StockLevel", () => {
  const base = { organizationId: org, productId: product, centerId: center };
  it("démarre à 0 (projection vide)", async () => {
    const l = new StockLevel(base);
    assert.deepEqual(await invalidPaths(l), []);
    assert.deepEqual([l.quantity, l.seq, l.alertThreshold], [0, 0, 0]);
  });
  it("refuse les quantités négatives ou décimales", async () => {
    assert.deepEqual(await invalidPaths(new StockLevel({ ...base, quantity: -1 })), ["quantity"]);
    assert.deepEqual(await invalidPaths(new StockLevel({ ...base, quantity: 1.5 })), ["quantity"]);
    assert.deepEqual(await invalidPaths(new StockLevel({ ...base, alertThreshold: 2.5 })), ["alertThreshold"]);
    assert.deepEqual(await invalidPaths(new StockLevel({ ...base, alertThreshold: -3 })), ["alertThreshold"]);
  });
  it("définit l'unicité (produit, centre)", async () => {
    const found = StockLevel.schema.indexes().find(([f]) => "productId" in f && "centerId" in f);
    assert.deepEqual(found?.[0], { productId: 1, centerId: 1 });
    assert.equal(found?.[1]?.unique, true);
  });
});

describe("ServiceRecipe", () => {
  const base = { organizationId: org, serviceId: id(), productId: product };
  it("exige une quantité entière strictement positive", async () => {
    assert.deepEqual(await invalidPaths(new ServiceRecipe({ ...base, quantityPerService: 30 })), []);
    for (const q of [0, -5, 1.5]) assert.deepEqual(await invalidPaths(new ServiceRecipe({ ...base, quantityPerService: q })), ["quantityPerService"]);
  });
  it("définit l'unicité (service, produit)", async () => {
    const found = ServiceRecipe.schema.indexes().find(([f]) => "serviceId" in f && "productId" in f);
    assert.deepEqual(found?.[0], { serviceId: 1, productId: 1 });
    assert.equal(found?.[1]?.unique, true);
  });
});

describe("StockMovement", () => {
  const base = { organizationId: org, centerId: center, productId: product };
  const move = (extra: Record<string, unknown>) => new StockMovement({ ...base, seq: 2, balanceAfter: 10, ...extra });

  it("accepte un stock initial de rang 1, une entrée, une sortie et une correction avec note", async () => {
    assert.deepEqual(await invalidPaths(move({ kind: "OPENING", seq: 1, delta: 10 })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "IN", delta: 5 })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "OUT", delta: -5 })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "ADJUSTMENT", delta: -2, note: "Inventaire" })), []);
  });
  it("refuse un stock initial hors rang 1, un signe incohérent et une correction sans note", async () => {
    assert.deepEqual(await invalidPaths(move({ kind: "OPENING", seq: 2, delta: 10 })), ["seq"]);
    assert.deepEqual(await invalidPaths(move({ kind: "IN", delta: -5 })), ["delta"]);
    assert.deepEqual(await invalidPaths(move({ kind: "OUT", delta: 5 })), ["delta"]);
    assert.deepEqual(await invalidPaths(move({ kind: "ADJUSTMENT", delta: 3 })), ["note"]);
    assert.deepEqual(await invalidPaths(move({ kind: "ADJUSTMENT", delta: 0, note: "x" })), ["delta"]);
  });
  it("refuse rang < 1, solde négatif, delta décimal et note trop longue", async () => {
    assert.ok((await invalidPaths(move({ kind: "IN", delta: 5, seq: 0 }))).includes("seq"));
    assert.ok((await invalidPaths(move({ kind: "IN", delta: 5, balanceAfter: -1 }))).includes("balanceAfter"));
    assert.ok((await invalidPaths(move({ kind: "IN", delta: 1.5 }))).includes("delta"));
    assert.ok((await invalidPaths(move({ kind: "ADJUSTMENT", delta: 1, note: "x".repeat(121) }))).includes("note"));
  });
  it("consommation : exige RDV, demandé et manquant cohérents (demandé = consommé + manquant)", async () => {
    const booking = id();
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: -30, requested: 30, shortfall: 0, bookingId: booking })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: -10, requested: 30, shortfall: 20, bookingId: booking })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: 0, requested: 30, shortfall: 30, bookingId: booking })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: -10, requested: 30, shortfall: 10, bookingId: booking })), ["shortfall"]);
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: -30, requested: 30, shortfall: 0 })), ["bookingId"]);
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: -30, bookingId: booking })), ["requested"]);
    assert.deepEqual(await invalidPaths(move({ kind: "CONSUMPTION", delta: 5, requested: 5, shortfall: 0, bookingId: booking })), ["delta", "shortfall"]);
  });
  it("refuse « demandé » et « manquant » hors consommation", async () => {
    assert.ok((await invalidPaths(move({ kind: "IN", delta: 5, requested: 5, shortfall: 0 }))).includes("requested"));
  });
  it("est ajouté-seulement : un mouvement enregistré ne se modifie pas (champs immuables)", async () => {
    const stored = StockMovement.hydrate({ ...base, kind: "IN", seq: 1, delta: 5, balanceAfter: 5 });
    stored.set("delta", 99);
    stored.set("balanceAfter", 99);
    assert.equal(stored.delta, 5);
    assert.equal(stored.balanceAfter, 5);
  });
  it("réception : delta positif et commande liée obligatoires ; une commande liée est interdite pour tout autre type", async () => {
    const order = id();
    assert.deepEqual(await invalidPaths(move({ kind: "RECEIPT", delta: 50, purchaseOrderId: order })), []);
    assert.deepEqual(await invalidPaths(move({ kind: "RECEIPT", delta: 50 })), ["purchaseOrderId"]);
    assert.deepEqual(await invalidPaths(move({ kind: "RECEIPT", delta: -5, purchaseOrderId: order })), ["delta"]);
    assert.deepEqual(await invalidPaths(move({ kind: "RECEIPT", delta: 0, purchaseOrderId: order })), ["delta"]);
    assert.deepEqual(await invalidPaths(move({ kind: "IN", delta: 5, purchaseOrderId: order })), ["purchaseOrderId"]);
    assert.ok((await invalidPaths(move({ kind: "RECEIPT", delta: 5, purchaseOrderId: order, requested: 5, shortfall: 0 }))).includes("requested"));
  });
  it("réception : la commande liée est immuable et l'index unique partiel {commande, produit} existe", async () => {
    const stored = StockMovement.hydrate({ ...base, kind: "RECEIPT", seq: 2, delta: 5, balanceAfter: 5, purchaseOrderId: id() });
    const original = String(stored.purchaseOrderId);
    stored.set("purchaseOrderId", id());
    assert.equal(String(stored.purchaseOrderId), original);
    const found = StockMovement.schema.indexes().find(([f]) => "purchaseOrderId" in f);
    assert.deepEqual(found?.[0], { purchaseOrderId: 1, productId: 1 });
    assert.equal(found?.[1]?.unique, true);
    assert.deepEqual(found?.[1]?.partialFilterExpression, { kind: "RECEIPT" });
  });
  it("définit le rang unique, l'idempotence partielle des consommations et les index de lecture", async () => {
    const indexes = StockMovement.schema.indexes();
    const rank = indexes.find(([f]) => "seq" in f);
    assert.deepEqual(rank?.[0], { productId: 1, centerId: 1, seq: 1 });
    assert.equal(rank?.[1]?.unique, true);
    const consumption = indexes.find(([f]) => "bookingId" in f);
    assert.deepEqual(consumption?.[0], { bookingId: 1, productId: 1 });
    assert.equal(consumption?.[1]?.unique, true);
    assert.deepEqual(consumption?.[1]?.partialFilterExpression, { kind: "CONSUMPTION" });
    assert.ok(indexes.some(([f]) => "createdAt" in f && "organizationId" in f && "productId" in f));
    assert.ok(indexes.some(([f]) => "kind" in f && "createdAt" in f && "productId" in f));
  });
});
