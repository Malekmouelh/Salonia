// Module 5 — Historique des mouvements : ordre, pagination par rang, bornes, droits, isolation entre centres et organisations,
// contenu renvoyé. Base MongoDB éphémère en mémoire (lib/booking/test-support.ts, inchangé). Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { StockMovement } from "@/lib/models/stock";
import { commitReceipt, projectLevel } from "./ledger";
import { listRecentStockMovements, listStockMovements } from "./movements";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN } from "./scope";
import { MSG_PRODUCT_NOT_FOUND, activateProductInCenter, archiveProduct, createProduct, recordStockMovement } from "./service";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, newId, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

let shampoo: string;
beforeEach(async () => {
  w = await makeWorld(db);
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a1), alertThreshold: 10, initialQuantity: 1000 }));
});

const history = (who = w.ownerA(), extra: Record<string, unknown> = {}) => listStockMovements(who, { productId: shampoo, centerId: id(w.a1), ...extra });
// 25 entrées de 1 unité après le stock initial : rangs 1 (OPENING) à 26.
async function fill(count = 25) {
  for (let i = 0; i < count; i++) expectOk(await recordStockMovement(w.ownerA(), { productId: shampoo, centerId: id(w.a1), kind: "IN", quantity: 1, note: `n${i + 2}` }));
}

describe("droits et périmètre", () => {
  it("STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation sont refusés", async () => {
    for (const [label, who] of forbiddenActors(w)) assert.equal(expectFail(await history(who), MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, label);
  });

  it("le propriétaire lit tous les centres, le gérant les siens ; même message pour tout centre inaccessible", async () => {
    expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a2), initialQuantity: 5 }));
    expectOk(await listStockMovements(w.ownerA(), { productId: shampoo, centerId: id(w.a2) }));
    expectOk(await history(w.managerA(w.a1)));
    for (const centerId of [id(w.a2), id(w.b1), newId(), "pas-un-id", "", { $ne: "" }, undefined, null]) {
      expectFail(await listStockMovements(w.managerA(w.a1), { productId: shampoo, centerId }), MSG_STOCK_CENTER_NOT_FOUND);
    }
    expectFail(await listStockMovements(w.ownerA(), { productId: shampoo, centerId: id(w.b1) }), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await listStockMovements(w.managerA(), { productId: shampoo, centerId: id(w.a1) }), MSG_STOCK_CENTER_NOT_FOUND);
  });

  it("un produit d'une autre organisation, inexistant ou mal formé est refusé ; un produit archivé reste lisible", async () => {
    const foreign = expectOk(await createProduct(w.ownerB(), { name: "Produit B", unit: "ML" })).product.id;
    expectOk(await activateProductInCenter(w.ownerB(), { productId: foreign, centerId: id(w.b1), initialQuantity: 5 }));
    expectFail(await listStockMovements(w.ownerA(), { productId: foreign, centerId: id(w.a1) }), MSG_PRODUCT_NOT_FOUND);
    expectFail(await listStockMovements(w.ownerB(), { productId: shampoo, centerId: id(w.b1) }), MSG_PRODUCT_NOT_FOUND);
    expectFail(await listStockMovements(w.ownerA(), { productId: newId(), centerId: id(w.a1) }), MSG_PRODUCT_NOT_FOUND);
    expectFail(await listStockMovements(w.ownerA(), { productId: "x", centerId: id(w.a1) }));
    expectFail(await listStockMovements(w.ownerA(), { productId: { $ne: "" }, centerId: id(w.a1) }));
    expectFail(await listStockMovements(w.ownerA(), null));
    expectOk(await archiveProduct(w.ownerA(), { productId: shampoo }));
    assert.equal(expectOk(await history()).movements.length, 1);
  });

  it("un centre ne voit jamais le journal d'un autre centre ni d'une autre organisation, même avec des identifiants valides", async () => {
    expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a2), initialQuantity: 7 }));
    expectOk(await recordStockMovement(w.ownerA(), { productId: shampoo, centerId: id(w.a2), kind: "OUT", quantity: 2 }));
    const a1 = expectOk(await history(w.managerA(w.a1)));
    const a2 = expectOk(await listStockMovements(w.ownerA(), { productId: shampoo, centerId: id(w.a2) }));
    assert.deepEqual(a1.movements.map((m) => m.balanceAfter), [1000]);
    assert.deepEqual(a2.movements.map((m) => [m.kind, m.balanceAfter]), [["OUT", 5], ["OPENING", 7]]);
  });
});

describe("ordre et pagination", () => {
  it("renvoie du plus récent au plus ancien, 20 par défaut, avec un curseur vers la page suivante", async () => {
    await fill(25); // 26 mouvements
    const first = expectOk(await history());
    assert.deepEqual(first.movements.map((m) => m.seq), Array.from({ length: 20 }, (_, i) => 26 - i));
    assert.equal(first.nextBefore, 7);
    const second = expectOk(await history(w.ownerA(), { before: first.nextBefore }));
    assert.deepEqual(second.movements.map((m) => m.seq), [6, 5, 4, 3, 2, 1]);
    assert.equal(second.nextBefore, null);
  });

  it("parcourir toutes les pages donne l'historique complet, sans doublon ni trou", async () => {
    await fill(25);
    const seen: number[] = [];
    let before: number | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = expectOk(await history(w.ownerA(), { limit: 7, ...(before ? { before } : {}) }));
      seen.push(...page.movements.map((m) => m.seq));
      if (page.nextBefore === null) break;
      before = page.nextBefore;
    }
    assert.deepEqual(seen, Array.from({ length: 26 }, (_, i) => 26 - i));
  });

  it("bornes exactes : une page qui contient tout n'a pas de suite, une page plus courte d'un élément en a une", async () => {
    await fill(25);
    assert.equal(expectOk(await history(w.ownerA(), { limit: 26 })).nextBefore, null);
    const short = expectOk(await history(w.ownerA(), { limit: 25 }));
    assert.deepEqual([short.movements.length, short.nextBefore], [25, 2]);
    assert.deepEqual(expectOk(await history(w.ownerA(), { limit: 1 })).movements.map((m) => m.seq), [26]);
    const beyond = expectOk(await history(w.ownerA(), { before: 1 }));
    assert.deepEqual([beyond.movements, beyond.nextBefore], [[], null]);
  });

  it("le curseur reste stable quand de nouveaux mouvements arrivent entre deux pages", async () => {
    await fill(25);
    const first = expectOk(await history(w.ownerA(), { limit: 10 }));
    await fill(3); // rangs 27 à 29, plus récents que la première page
    const second = expectOk(await history(w.ownerA(), { limit: 10, before: first.nextBefore! }));
    assert.deepEqual(second.movements.map((m) => m.seq), Array.from({ length: 10 }, (_, i) => 16 - i));
    assert.equal(expectOk(await history(w.ownerA(), { limit: 1 })).movements[0].seq, 29);
  });

  it("la taille de page est bornée à 100 et le curseur doit être un rang entier positif", async () => {
    assert.equal(expectOk(await history(w.ownerA(), { limit: 100 })).movements.length, 1);
    for (const limit of [0, -1, 101, 1.5, "10", null, {}]) expectFail(await history(w.ownerA(), { limit }));
    for (const before of [0, -3, 1.5, "7", null, {}, Number.NaN]) expectFail(await history(w.ownerA(), { before }));
  });
});

describe("contenu renvoyé", () => {
  it("type, variation signée, solde après, date, note et unité du produit ; aucune donnée d'organisation ni d'utilisateur", async () => {
    expectOk(await recordStockMovement(w.managerA(w.a1), { productId: shampoo, centerId: id(w.a1), kind: "OUT", quantity: 30, note: "Atelier" }));
    expectOk(await recordStockMovement(w.managerA(w.a1), { productId: shampoo, centerId: id(w.a1), kind: "ADJUSTMENT", quantity: -20, note: "Casse" }));
    const h = expectOk(await history(w.managerA(w.a1)));
    assert.deepEqual([h.productName, h.unit, h.centerId], ["Shampoing", "ML", id(w.a1)]);
    assert.deepEqual(h.movements.map((m) => [m.kind, m.delta, m.balanceAfter, m.note]), [["ADJUSTMENT", -20, 950, "Casse"], ["OUT", -30, 970, "Atelier"], ["OPENING", 1000, 1000, "Stock initial"]]);
    assert.ok(h.movements.every((m) => !Number.isNaN(Date.parse(m.createdAt)) && m.createdAt.endsWith("Z")));
    const json = JSON.stringify(h);
    assert.ok(!json.includes(id(w.orgA)) && !/createdBy|organizationId/.test(json));
  });

  it("références de commande (réception) et de rendez-vous (consommation) quand elles existent, null sinon", async () => {
    const orderId = newId();
    const bookingId = newId();
    const key = { organizationId: id(w.orgA), productId: shampoo, centerId: id(w.a1) };
    const { movement } = await commitReceipt({ ...key, purchaseOrderId: orderId, quantity: 50 });
    await projectLevel({ ...key, seq: movement.seq, balanceAfter: movement.balanceAfter });
    await StockMovement.create({ ...key, kind: "CONSUMPTION", seq: 3, delta: -40, balanceAfter: 1010, requested: 60, shortfall: 20, bookingId: new Types.ObjectId(bookingId) });
    const h = expectOk(await history());
    const [consumption, receipt, opening] = h.movements;
    assert.deepEqual([consumption.kind, consumption.bookingId, consumption.requested, consumption.shortfall, consumption.purchaseOrderId], ["CONSUMPTION", bookingId, 60, 20, null]);
    assert.deepEqual([receipt.kind, receipt.purchaseOrderId, receipt.bookingId, receipt.requested, receipt.shortfall], ["RECEIPT", orderId, null, null, null]);
    assert.deepEqual([opening.purchaseOrderId, opening.bookingId, opening.note], [null, null, "Stock initial"]);
  });

  it("un historique vide est un succès vide", async () => {
    const empty = expectOk(await createProduct(w.ownerA(), { name: "Gants", unit: "PIECE" })).product.id;
    const h = expectOk(await listStockMovements(w.ownerA(), { productId: empty, centerId: id(w.a1) }));
    assert.deepEqual([h.movements, h.nextBefore, h.unit], [[], null, "PIECE"]);
  });
});

describe("mouvements récents (tous produits, centres autorisés)", () => {
  const second = async () => {
    const gel = expectOk(await createProduct(w.ownerA(), { name: "Gel", unit: "G" })).product.id;
    expectOk(await activateProductInCenter(w.ownerA(), { productId: gel, centerId: id(w.a2), initialQuantity: 9 }));
    return gel;
  };

  it("du plus récent au plus ancien, borné, avec nom et unité du produit", async () => {
    await fill(12);
    const r = expectOk(await listRecentStockMovements(w.ownerA(), undefined, { limit: 5 }));
    assert.equal(r.movements.length, 5);
    assert.deepEqual(r.movements.map((m) => m.seq), [13, 12, 11, 10, 9]);
    assert.deepEqual([r.movements[0].productName, r.movements[0].unit, r.movements[0].centerId], ["Shampoing", "ML", id(w.a1)]);
    assert.equal(expectOk(await listRecentStockMovements(w.ownerA())).movements.length, 10); // 10 par défaut
    for (const limit of [0, 51, 1.5, "5", null]) expectFail(await listRecentStockMovements(w.ownerA(), undefined, { limit }));
  });

  it("le gérant ne voit que ses centres ; un centre demandé hors périmètre est refusé ; autre organisation invisible", async () => {
    const gel = await second();
    const owner = expectOk(await listRecentStockMovements(w.ownerA()));
    assert.ok(owner.movements.some((m) => m.productId === gel) && owner.movements.some((m) => m.productId === shampoo));
    const manager = expectOk(await listRecentStockMovements(w.managerA(w.a2)));
    assert.deepEqual([...new Set(manager.movements.map((m) => m.centerId))], [id(w.a2)]);
    expectFail(await listRecentStockMovements(w.managerA(w.a2), id(w.a1)), MSG_STOCK_CENTER_NOT_FOUND);
    for (const requested of [id(w.b1), newId(), "", { $ne: "" }]) expectFail(await listRecentStockMovements(w.ownerA(), requested), MSG_STOCK_CENTER_NOT_FOUND);
    assert.deepEqual(expectOk(await listRecentStockMovements(w.ownerB())).movements, []);
    assert.deepEqual(expectOk(await listRecentStockMovements(w.managerA())).movements, []);
  });

  it("refuse STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation ; aucune donnée sensible", async () => {
    for (const [label, who] of forbiddenActors(w)) assert.equal(expectFail(await listRecentStockMovements(who), MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, label);
    const json = JSON.stringify(expectOk(await listRecentStockMovements(w.ownerA())));
    assert.ok(!json.includes(id(w.orgA)) && !/createdBy|organizationId/.test(json));
  });
});
