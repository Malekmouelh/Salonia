// Module 5 — Réception des commandes d'achat : crédit unique, répétitions et appels concurrents, interruptions à chaque frontière
// d'écriture, erreurs de ligne et reprise, statuts incorrects, commandes incohérentes, isolation, cohérence registre/projection.
// Base MongoDB éphémère en mémoire (lib/booking/test-support.ts, inchangé). Les interruptions sont SIMULÉES en appelant les
// étapes élémentaires (receiptSteps) l'une sans l'autre : aucun processus n'est réellement tué. Aucune action serveur ni interface.
// Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { PurchaseOrder, StockLevel, StockMovement } from "@/lib/models/stock";
import { receiptAuditDetail } from "./audit";
import { commitReceipt, verifyLedger } from "./ledger";
import {
  MSG_ORDER_NOT_CANCELLABLE,
  MSG_ORDER_NOT_FOUND,
  MSG_ORDER_RECEIVING,
  cancelPurchaseOrder,
  createPurchaseOrder,
  placePurchaseOrder,
  updateDraftPurchaseOrder,
} from "./purchase-orders";
import { MSG_ORDER_INCONSISTENT, MSG_ORDER_NOT_RECEIVABLE, MSG_RECEIPT_INCOMPLETE, MSG_UNIT_CHANGED, receivePurchaseOrder, receiptSteps } from "./receipts";
import { MSG_STOCK_FORBIDDEN, stockScope } from "./scope";
import { MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, activateProductInCenter, archiveProduct, createProduct, updateProduct } from "./service";
import { createSupplier } from "./suppliers";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, newId, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

let sup: string, shampoo: string, mask: string;
beforeEach(async () => {
  w = await makeWorld(db);
  sup = expectOk(await createSupplier(w.ownerA(), { name: "Distri" })).supplier.id;
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  mask = expectOk(await createProduct(w.ownerA(), { name: "Masque", unit: "G" })).product.id;
  expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a1), alertThreshold: 10, initialQuantity: 100 }));
  expectOk(await activateProductInCenter(w.ownerA(), { productId: mask, centerId: id(w.a1), alertThreshold: 5, initialQuantity: 50 }));
});

const manager = () => w.managerA(w.a1);
const LINES = () => [{ productId: shampoo, quantity: 50 }, { productId: mask, quantity: 20 }];
const placed = async (lines: unknown = LINES()) => {
  const o = expectOk(await createPurchaseOrder(manager(), { centerId: id(w.a1), supplierId: sup, lines })).order;
  expectOk(await placePurchaseOrder(manager(), { orderId: o.id }));
  return o;
};
const draft = async () => expectOk(await createPurchaseOrder(manager(), { centerId: id(w.a1), supplierId: sup, lines: LINES() })).order;
const level = async (productId: string) => (await StockLevel.findOne({ organizationId: w.orgA._id, productId, centerId: w.a1._id }).lean())!;
const receiptsOf = (orderId: string) => StockMovement.find({ purchaseOrderId: orderId, kind: "RECEIPT" }).sort({ productId: 1 }).lean();
const orderDoc = async (orderId: string) => (await PurchaseOrder.findById(orderId).lean())!;
const scope = () => stockScope(manager());
const key = (productId: string) => ({ organizationId: id(w.orgA), productId, centerId: id(w.a1) });
const receive = (who = manager(), orderId = "") => receivePurchaseOrder(who, { orderId });

// État attendu après une réception complète : 100+50 et 50+20, un mouvement RECEIPT par ligne, registre et projection cohérents.
async function assertFullyReceived(orderId: string) {
  assert.deepEqual([(await level(shampoo)).quantity, (await level(mask)).quantity], [150, 70]);
  assert.deepEqual([(await level(shampoo)).seq, (await level(mask)).seq], [2, 2]);
  const receipts = await receiptsOf(orderId);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((r) => r.delta).sort((a, b) => a - b), [20, 50]);
  for (const productId of [shampoo, mask]) {
    const report = await verifyLedger(key(productId));
    assert.equal(report.ledgerOk, true, JSON.stringify(report.issues));
    assert.equal(report.projection, "IN_SYNC", productId);
  }
  assert.equal((await orderDoc(orderId)).status, "RECEIVED");
}

describe("réception normale", () => {
  it("crédite chaque ligne par un mouvement RECEIPT du registre, projette, puis passe la commande à RECEIVED", async () => {
    const o = await placed();
    const actor = manager(); // même acteur pour comparer l'auteur tracé
    const r = expectOk(await receive(actor, o.id));
    assert.deepEqual([r.alreadyReceived, r.recorded, r.order.status, r.order.receiving], [false, 2, "RECEIVED", false]);
    assert.ok(r.order.receivedAt);
    await assertFullyReceived(o.id);
    const receipts = await receiptsOf(o.id);
    assert.ok(receipts.every((m) => m.kind === "RECEIPT" && String(m.purchaseOrderId) === o.id && String(m.createdBy) === actor.id));
    assert.ok(receipts.every((m) => String(m.organizationId) === id(w.orgA) && String(m.centerId) === id(w.a1)));
  });

  it("le propriétaire peut aussi recevoir ; l'organisation et le centre viennent de la commande, pas de la saisie", async () => {
    const o = await placed();
    expectOk(await receivePurchaseOrder(w.ownerA(), { orderId: o.id, organizationId: id(w.orgB), centerId: id(w.a2), productId: newId(), delta: 999 }));
    await assertFullyReceived(o.id);
  });

  it("le registre reste la source de vérité : la quantité du niveau n'est jamais écrite directement par la réception (contrôle du code source)", () => {
    const source = readFileSync(join(process.cwd(), "lib/stock/receipts.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /StockLevel\.(updateOne|updateMany|findOneAndUpdate|create|insertMany|deleteOne|deleteMany|replaceOne|bulkWrite)/);
    assert.doesNotMatch(source, /StockMovement\.(updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany|replaceOne|bulkWrite)/);
    assert.match(source, /commitReceipt\(/);
    assert.match(source, /projectLevel\(/);
  });
});

describe("répétitions et appels concurrents : aucun double crédit", () => {
  it("rappeler la réception après succès ne change rien (5 fois)", async () => {
    const o = await placed();
    expectOk(await receive(manager(), o.id));
    for (let i = 0; i < 5; i++) {
      const again = expectOk(await receive(manager(), o.id));
      assert.deepEqual([again.alreadyReceived, again.recorded], [true, 0]);
    }
    await assertFullyReceived(o.id);
  });

  it("6 appels simultanés : chaque produit est crédité une seule fois, toutes les réponses sont des succès", async () => {
    for (let round = 0; round < 3; round++) {
      await beforeEachReset();
      const o = await placed();
      const results = await Promise.all(Array.from({ length: 6 }, () => receive(manager(), o.id)));
      const oks = results.map((r) => expectOk(r));
      assert.equal(oks.reduce((sum, r) => sum + r.recorded, 0), 2, `tour ${round} : mouvements créés`);
      assert.ok(oks.every((r) => r.order.status === "RECEIVED"));
      await assertFullyReceived(o.id);
    }
  });

  it("deux commandes différentes pour les mêmes produits, reçues en même temps : chacune créditée une fois, rangs contigus", async () => {
    const a = await placed();
    const b = await placed([{ productId: shampoo, quantity: 7 }, { productId: mask, quantity: 3 }]);
    await Promise.all([receive(manager(), a.id), receive(manager(), b.id), receive(manager(), a.id), receive(manager(), b.id)]);
    assert.deepEqual([(await level(shampoo)).quantity, (await level(mask)).quantity], [157, 73]);
    for (const productId of [shampoo, mask]) assert.equal((await verifyLedger(key(productId))).ledgerOk, true);
    assert.equal((await StockMovement.find({ ...key(shampoo), kind: "RECEIPT" }).lean()).length, 2);
  });

  it("réception et annulation simultanées : soit annulée sans aucun crédit, soit reçue complètement ; jamais un mélange", async () => {
    for (let round = 0; round < 8; round++) {
      await beforeEachReset();
      const o = await placed();
      await Promise.all([receive(manager(), o.id), cancelPurchaseOrder(manager(), { orderId: o.id })]);
      const stored = await orderDoc(o.id);
      const receipts = await receiptsOf(o.id);
      if (stored.status === "CANCELLED") assert.equal(receipts.length, 0, `tour ${round} : commande annulée avec des réceptions`);
      else {
        assert.equal(stored.status, "RECEIVED", `tour ${round}`);
        assert.equal(receipts.length, 2);
      }
      assert.equal((await verifyLedger(key(shampoo))).ledgerOk, true);
    }
  });
});

describe("statut incorrect et commande incohérente : jamais reçue", () => {
  it("brouillon, annulée : refusées, rien n'est crédité ni commencé", async () => {
    const d = await draft();
    expectFail(await receive(manager(), d.id), MSG_ORDER_NOT_RECEIVABLE);
    const c = await placed();
    expectOk(await cancelPurchaseOrder(manager(), { orderId: c.id }));
    expectFail(await receive(manager(), c.id), MSG_ORDER_NOT_RECEIVABLE);
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
    assert.deepEqual([(await level(shampoo)).quantity, (await level(mask)).quantity], [100, 50]);
    assert.equal((await orderDoc(d.id)).receiptStartedAt, null);
  });

  it("une commande reçue ne peut plus être annulée, passée ni modifiée", async () => {
    const o = await placed();
    expectOk(await receive(manager(), o.id));
    expectFail(await cancelPurchaseOrder(manager(), { orderId: o.id }), MSG_ORDER_NOT_CANCELLABLE);
    expectFail(await placePurchaseOrder(manager(), { orderId: o.id }));
    expectFail(await updateDraftPurchaseOrder(manager(), { orderId: o.id, supplierId: sup }));
    assert.equal((await orderDoc(o.id)).status, "RECEIVED");
  });

  it("incohérences détectées avant toute écriture : réception sur brouillon, quantité différente, mauvais centre, produit hors commande, commande « reçue » sans réception, lignes en double", async () => {
    const stock = async () => [await StockMovement.countDocuments({ kind: "RECEIPT" }), (await level(shampoo)).quantity, (await level(mask)).quantity];
    const raw = (orderId: string, update: Record<string, unknown>) => PurchaseOrder.collection.updateOne({ _id: new Types.ObjectId(orderId) }, update);
    const receipt = (orderId: string, extra: Record<string, unknown> = {}, seq = 2) =>
      StockMovement.create({ ...key(shampoo), kind: "RECEIPT", seq, delta: 50, balanceAfter: 100 + 50, purchaseOrderId: orderId, ...extra });

    // 1. brouillon qui porte déjà une réception
    const d = await draft();
    await receipt(d.id);
    expectFail(await receive(manager(), d.id), MSG_ORDER_INCONSISTENT);

    // 2. quantité reçue différente de la quantité commandée
    const q = await placed();
    await receipt(q.id, { delta: 49, balanceAfter: 100 + 49, seq: 3 });
    expectFail(await receive(manager(), q.id), MSG_ORDER_INCONSISTENT);

    // 3. réception enregistrée dans un autre centre
    const c = await placed();
    await receipt(c.id, { centerId: w.a2._id, seq: 1, balanceAfter: 50 });
    expectFail(await receive(manager(), c.id), MSG_ORDER_INCONSISTENT);

    // 4. commande marquée « reçue » sans ses réceptions
    const r = await placed();
    await raw(r.id, { $set: { status: "RECEIVED" } });
    expectFail(await receive(manager(), r.id), MSG_ORDER_INCONSISTENT);

    // 5. lignes en double (état impossible par les services, forcé en base)
    const l = await placed();
    await raw(l.id, { $set: { lines: [{ productId: new Types.ObjectId(shampoo), productName: "x", unit: "ML", quantity: 1 }, { productId: new Types.ObjectId(shampoo), productName: "x", unit: "ML", quantity: 2 }] } });
    expectFail(await receive(manager(), l.id), MSG_ORDER_INCONSISTENT);

    // 6. réception d'un produit qui n'est pas une ligne de la commande
    const p = await placed([{ productId: mask, quantity: 20 }]);
    await receipt(p.id, {}, 4);
    expectFail(await receive(manager(), p.id), MSG_ORDER_INCONSISTENT);

    // aucun crédit supplémentaire : seuls les 4 mouvements forgés existent, aucun niveau n'a bougé
    assert.deepEqual(await stock(), [4, 100, 50]);
    for (const o of [q, c, r, l, p]) assert.equal((await orderDoc(o.id)).receivedAt ?? null, null);
  });
});

describe("isolation par organisation et centre ; droits", () => {
  it("commande d'un autre centre du gérant, d'une autre organisation, inexistante ou mal formée : « introuvable », rien de crédité", async () => {
    const o = await placed();
    const pb = expectOk(await createProduct(w.ownerB(), { name: "Produit B", unit: "ML" })).product.id;
    expectOk(await activateProductInCenter(w.ownerB(), { productId: pb, centerId: id(w.b1), initialQuantity: 5 }));
    const sb = expectOk(await createSupplier(w.ownerB(), { name: "Fournisseur B" })).supplier.id;
    const ob = expectOk(await createPurchaseOrder(w.ownerB(), { centerId: id(w.b1), supplierId: sb, lines: [{ productId: pb, quantity: 5 }] })).order;
    expectOk(await placePurchaseOrder(w.ownerB(), { orderId: ob.id }));

    for (const [who, orderId] of [
      [w.managerA(w.a2), o.id], // gérant d'un autre centre
      [w.ownerB(), o.id], // autre organisation
      [w.ownerA(), ob.id], // commande d'une autre organisation
      [manager(), newId()],
    ] as const) expectFail(await receivePurchaseOrder(who, { orderId }), MSG_ORDER_NOT_FOUND);
    expectFail(await receivePurchaseOrder(manager(), { orderId: "pas-un-id" }));
    expectFail(await receivePurchaseOrder(manager(), { orderId: { $ne: "" } }));
    expectFail(await receivePurchaseOrder(manager(), null));
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
    assert.deepEqual([(await orderDoc(o.id)).status, (await orderDoc(ob.id)).status], ["ORDERED", "ORDERED"]);
    assert.equal((await orderDoc(o.id)).receiptStartedAt, null);
  });

  it("STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation sont refusés", async () => {
    const o = await placed();
    for (const [label, who] of forbiddenActors(w)) assert.equal(expectFail(await receive(who, o.id), MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, label);
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
  });
});

describe("revalidation côté serveur avant écriture", () => {
  it("produit archivé depuis la commande : refusé AVANT toute écriture, la commande reste annulable", async () => {
    const o = await placed();
    expectOk(await archiveProduct(w.ownerA(), { productId: mask }));
    const f = expectFail(await receive(manager(), o.id), MSG_RECEIPT_INCOMPLETE);
    assert.deepEqual(f.errors, { [mask]: [MSG_PRODUCT_ARCHIVED] });
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
    assert.equal((await orderDoc(o.id)).receiptStartedAt, null);
    expectOk(await cancelPurchaseOrder(manager(), { orderId: o.id }));
  });

  it("niveau supprimé ou unité modifiée depuis la commande : refusé avant écriture", async () => {
    const free = expectOk(await createProduct(w.ownerA(), { name: "Gel", unit: "ML" })).product.id;
    expectOk(await activateProductInCenter(w.ownerA(), { productId: free, centerId: id(w.a1), initialQuantity: 0 })); // aucun mouvement : l'unité reste modifiable
    const o = await placed([{ productId: free, quantity: 5 }, { productId: shampoo, quantity: 10 }]);
    expectOk(await updateProduct(w.ownerA(), { productId: free, unit: "G" }));
    assert.deepEqual(expectFail(await receive(manager(), o.id), MSG_RECEIPT_INCOMPLETE).errors, { [free]: [MSG_UNIT_CHANGED] });
    await StockLevel.collection.deleteOne({ productId: new Types.ObjectId(shampoo), centerId: w.a1._id });
    assert.deepEqual(expectFail(await receive(manager(), o.id)).errors, { [free]: [MSG_UNIT_CHANGED], [shampoo]: [MSG_NOT_ACTIVATED] });
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
  });
});

describe("reprise après interruption, à chaque frontière d'écriture", () => {
  it("1. après le début de réception : rien crédité, annulation refusée, le nouvel appel termine", async () => {
    const o = await placed();
    assert.equal(await receiptSteps.claim(scope(), o.id), true);
    assert.equal(await receiptSteps.claim(scope(), o.id), true); // rejouer le début est sans effet
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
    assert.equal((await orderDoc(o.id)).status, "ORDERED");
    assert.equal(expectFail(await cancelPurchaseOrder(manager(), { orderId: o.id }), MSG_ORDER_RECEIVING).message, MSG_ORDER_RECEIVING);
    expectOk(await receive(manager(), o.id));
    await assertFullyReceived(o.id);
  });

  it("2. après l'insertion du mouvement d'une ligne, avant sa projection : le niveau est en retard, le nouvel appel projette sans recréditer", async () => {
    const o = await placed();
    assert.equal(await receiptSteps.claim(scope(), o.id), true);
    const { created } = await commitReceipt({ ...key(shampoo), purchaseOrderId: o.id, quantity: 50 }); // « panne » avant projectLevel
    assert.equal(created, true);
    assert.equal((await level(shampoo)).quantity, 100); // projection en retard
    assert.equal((await verifyLedger(key(shampoo))).projection, "LAGGING");
    const r = expectOk(await receive(manager(), o.id));
    assert.equal(r.recorded, 1); // seule la ligne du masque est créée par ce nouvel appel
    await assertFullyReceived(o.id);
  });

  it("3. après la première ligne complète, avant la seconde : le nouvel appel ne traite que la ligne manquante", async () => {
    const o = await placed();
    const order = (await orderDoc(o.id)) as never;
    await receiptSteps.claim(scope(), o.id);
    assert.equal(await receiptSteps.applyLine(order, { productId: shampoo, quantity: 50, unit: "ML" }, manager().id), true);
    assert.equal((await level(shampoo)).quantity, 150);
    const r = expectOk(await receive(manager(), o.id));
    assert.equal(r.recorded, 1);
    await assertFullyReceived(o.id);
  });

  it("4. toutes les lignes enregistrées et projetées, statut non posé : le nouvel appel pose RECEIVED sans rien créditer", async () => {
    const o = await placed();
    const order = (await orderDoc(o.id)) as never;
    await receiptSteps.claim(scope(), o.id);
    await receiptSteps.applyLine(order, { productId: shampoo, quantity: 50, unit: "ML" }, manager().id);
    await receiptSteps.applyLine(order, { productId: mask, quantity: 20, unit: "G" }, manager().id);
    assert.equal((await orderDoc(o.id)).status, "ORDERED");
    const r = expectOk(await receive(manager(), o.id));
    assert.deepEqual([r.recorded, r.alreadyReceived], [0, false]);
    await assertFullyReceived(o.id);
  });

  it("5. tous les mouvements enregistrés mais aucune projection, statut non posé : la confirmation projette, puis RECEIVED", async () => {
    const o = await placed();
    await receiptSteps.claim(scope(), o.id);
    await commitReceipt({ ...key(shampoo), purchaseOrderId: o.id, quantity: 50 });
    await commitReceipt({ ...key(mask), purchaseOrderId: o.id, quantity: 20 });
    assert.deepEqual([(await level(shampoo)).quantity, (await level(mask)).quantity], [100, 50]);
    const r = expectOk(await receive(manager(), o.id));
    assert.equal(r.recorded, 0);
    await assertFullyReceived(o.id);
  });

  it("6. sans début de réception posé mais avec des mouvements déjà enregistrés : le nouvel appel reprend et termine", async () => {
    const o = await placed();
    await commitReceipt({ ...key(shampoo), purchaseOrderId: o.id, quantity: 50 }); // mouvement sans claim ni projection
    expectOk(await receive(manager(), o.id));
    await assertFullyReceived(o.id);
  });

  it("7. erreur sur une ligne en cours de route : la commande n'est pas reçue, les mouvements enregistrés sont conservés, la reprise termine sans doublon", async () => {
    const o = await placed();
    const order = (await orderDoc(o.id)) as never;
    await receiptSteps.claim(scope(), o.id);
    await receiptSteps.applyLine(order, { productId: shampoo, quantity: 50, unit: "ML" }, manager().id); // ligne 1 faite
    await StockLevel.collection.deleteOne({ productId: new Types.ObjectId(mask), centerId: w.a1._id }); // la ligne 2 ne peut plus être traitée

    const failed = expectFail(await receive(manager(), o.id), MSG_RECEIPT_INCOMPLETE);
    assert.deepEqual(failed.errors, { [mask]: [MSG_NOT_ACTIVATED] });
    const stored = await orderDoc(o.id);
    assert.deepEqual([stored.status, !!stored.receiptStartedAt, stored.receivedAt ?? null], ["ORDERED", true, null]);
    assert.equal((await receiptsOf(o.id)).length, 1); // le mouvement déjà enregistré est préservé
    assert.equal((await level(shampoo)).quantity, 150);
    expectFail(await cancelPurchaseOrder(manager(), { orderId: o.id }), MSG_ORDER_RECEIVING);

    // correction de la cause (niveau recréé, sans nouveau stock initial) puis reprise
    expectOk(await activateProductInCenter(manager(), { productId: mask, centerId: id(w.a1), alertThreshold: 5, initialQuantity: 0 }));
    const resumed = expectOk(await receive(manager(), o.id));
    assert.equal(resumed.recorded, 1); // seulement la ligne manquante
    await assertFullyReceived(o.id);
  });

  it("8. mouvement présent mais niveau introuvable à la confirmation : pas de RECEIVED ; après recréation du niveau, la reprise termine", async () => {
    const o = await placed();
    await receiptSteps.claim(scope(), o.id);
    await commitReceipt({ ...key(shampoo), purchaseOrderId: o.id, quantity: 50 });
    await commitReceipt({ ...key(mask), purchaseOrderId: o.id, quantity: 20 });
    await StockLevel.collection.deleteOne({ productId: new Types.ObjectId(mask), centerId: w.a1._id });
    expectFail(await receive(manager(), o.id), MSG_RECEIPT_INCOMPLETE);
    assert.equal((await orderDoc(o.id)).status, "ORDERED");
    expectOk(await activateProductInCenter(manager(), { productId: mask, centerId: id(w.a1), initialQuantity: 0 }));
    expectOk(await receive(manager(), o.id));
    await assertFullyReceived(o.id);
  });
});

describe("index uniques réels sur MongoDB et validation du modèle", () => {
  it("une seule réception par (commande, produit) ; une autre commande ou un autre produit reste permis", async () => {
    const o = await placed();
    const base = { ...key(shampoo), kind: "RECEIPT" as const, delta: 5, purchaseOrderId: o.id };
    await StockMovement.create({ ...base, seq: 2, balanceAfter: 105 });
    await assert.rejects(StockMovement.create({ ...base, seq: 3, balanceAfter: 110 }), (e: unknown) => (e as { code?: number }).code === 11000 && "purchaseOrderId" in ((e as { keyPattern?: object }).keyPattern ?? {}));
    await StockMovement.create({ ...base, productId: mask, seq: 2, balanceAfter: 55 }); // autre produit
    await StockMovement.create({ ...base, purchaseOrderId: newId(), seq: 3, balanceAfter: 110 }); // autre commande
  });

  it("un mouvement RECEIPT exige une commande liée et un delta positif ; un autre type n'accepte pas de commande liée", async () => {
    const base = { ...key(shampoo), seq: 9, balanceAfter: 100 };
    await assert.rejects(StockMovement.create({ ...base, kind: "RECEIPT", delta: 5 }));
    await assert.rejects(StockMovement.create({ ...base, kind: "RECEIPT", delta: -5, purchaseOrderId: newId() }));
    await assert.rejects(StockMovement.create({ ...base, kind: "RECEIPT", delta: 0, purchaseOrderId: newId() }));
    await assert.rejects(StockMovement.create({ ...base, kind: "IN", delta: 5, purchaseOrderId: newId() }));
    assert.equal(await StockMovement.countDocuments({ kind: "RECEIPT" }), 0);
  });

  it("verifyLedger signale une réception sans commande liée forgée en base", async () => {
    await StockMovement.collection.insertOne({ organizationId: w.orgA._id, productId: new Types.ObjectId(shampoo), centerId: w.a1._id, kind: "RECEIPT", seq: 2, delta: 5, balanceAfter: 105, createdAt: new Date() });
    const report = await verifyLedger(key(shampoo));
    assert.equal(report.ledgerOk, false);
    assert.ok(report.issues.some((i) => i.code === "RECEIPT_INVALID"));
  });
});

// La décision d'audit de l'action (receiptAuditDetail) appliquée aux résultats RÉELS du service : un événement par avancement
// de la commande, aucun pour un nouvel envoi, aucun quand la réception échoue (le résultat n'a alors pas de commande).
describe("audit de la réception sur des résultats réels du service", () => {
  it("réception normale : un détail ; nouvel envoi : aucun ; refus (brouillon, annulée, incohérente, hors périmètre) : pas de succès donc pas d'audit", async () => {
    const o = await placed();
    const first = expectOk(await receive(manager(), o.id));
    assert.equal(receiptAuditDetail(first), `order:${o.id} center:${id(w.a1)} lines:2 recorded:2`);
    assert.equal(receiptAuditDetail(expectOk(await receive(manager(), o.id))), null);

    const d = await draft();
    const c = await placed();
    expectOk(await cancelPurchaseOrder(manager(), { orderId: c.id }));
    for (const [who, orderId] of [[manager(), d.id], [manager(), c.id], [w.managerA(w.a2), o.id], [w.ownerB(), o.id]] as const) {
      assert.equal((await receivePurchaseOrder(who, { orderId })).ok, false);
    }
  });

  it("échec en cours de route puis reprise : l'échec n'est pas journalisé comme succès ; la reprise l'est une fois, avec le nombre de mouvements créés à ce moment", async () => {
    const o = await placed();
    const order = (await orderDoc(o.id)) as never;
    await receiptSteps.claim(scope(), o.id);
    await receiptSteps.applyLine(order, { productId: shampoo, quantity: 50, unit: "ML" }, manager().id);
    await StockLevel.collection.deleteOne({ productId: new Types.ObjectId(mask), centerId: w.a1._id });
    assert.equal((await receive(manager(), o.id)).ok, false);
    expectOk(await activateProductInCenter(manager(), { productId: mask, centerId: id(w.a1), initialQuantity: 0 }));
    const resumed = expectOk(await receive(manager(), o.id));
    assert.equal(receiptAuditDetail(resumed), `order:${o.id} center:${id(w.a1)} lines:2 recorded:1`);
    assert.equal(receiptAuditDetail(expectOk(await receive(manager(), o.id))), null);
    await assertFullyReceived(o.id);
  });

  it("reprise qui ne crée aucun mouvement mais termine la commande : journalisée, sans double crédit", async () => {
    const o = await placed();
    const order = (await orderDoc(o.id)) as never;
    await receiptSteps.claim(scope(), o.id);
    await receiptSteps.applyLine(order, { productId: shampoo, quantity: 50, unit: "ML" }, manager().id);
    await receiptSteps.applyLine(order, { productId: mask, quantity: 20, unit: "G" }, manager().id);
    const resumed = expectOk(await receive(manager(), o.id));
    assert.equal(receiptAuditDetail(resumed), `order:${o.id} center:${id(w.a1)} lines:2 recorded:0`);
    await assertFullyReceived(o.id);
  });
});

// Réinitialise la base entre les tours d'un même test.
async function beforeEachReset() {
  w = await makeWorld(db);
  sup = expectOk(await createSupplier(w.ownerA(), { name: "Distri" })).supplier.id;
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  mask = expectOk(await createProduct(w.ownerA(), { name: "Masque", unit: "G" })).product.id;
  expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a1), alertThreshold: 10, initialQuantity: 100 }));
  expectOk(await activateProductInCenter(w.ownerA(), { productId: mask, centerId: id(w.a1), alertThreshold: 5, initialQuantity: 50 }));
}
