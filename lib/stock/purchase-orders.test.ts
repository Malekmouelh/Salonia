// Module 5 (étape 5) — Commandes d'achat : droits, périmètre multi-centres, isolation entre organisations, validation des lignes
// côté serveur, transitions de statut (atomiques), historique préservé, et AUCUN effet sur le stock. Base MongoDB éphémère
// en mémoire. Les actions serveur n'existent pas encore et aucune réception n'est implémentée. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { PurchaseOrder, StockLevel, StockMovement, Supplier } from "@/lib/models/stock";
import * as ordersModule from "./purchase-orders";
import {
  MSG_ORDER_NOT_CANCELLABLE,
  MSG_ORDER_NOT_EDITABLE,
  MSG_ORDER_NOT_FOUND,
  MSG_ORDER_NOT_ORDERABLE,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  placePurchaseOrder,
  updateDraftPurchaseOrder,
} from "./purchase-orders";
import { MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, activateProductInCenter, archiveProduct, createProduct, updateProduct, recordStockMovement } from "./service";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN } from "./scope";
import { MSG_SUPPLIER_ARCHIVED, MSG_SUPPLIER_NOT_FOUND, archiveSupplier, createSupplier, updateSupplier } from "./suppliers";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, newId, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

// Données de base : fournisseur, shampoing (ML) et masque (G) activés à Tunis (a1), colorant (PIECE) activé à Sousse (a2) seulement.
let sup: string, shampoo: string, mask: string, dye: string;
beforeEach(async () => {
  w = await makeWorld(db);
  sup = expectOk(await createSupplier(w.ownerA(), { name: "Distri", leadTimeDays: 5 })).supplier.id;
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  mask = expectOk(await createProduct(w.ownerA(), { name: "Masque", unit: "G" })).product.id;
  dye = expectOk(await createProduct(w.ownerA(), { name: "Colorant", unit: "PIECE" })).product.id;
  for (const productId of [shampoo, mask]) expectOk(await activateProductInCenter(w.ownerA(), { productId, centerId: id(w.a1), alertThreshold: 10, initialQuantity: 100 }));
  expectOk(await activateProductInCenter(w.ownerA(), { productId: dye, centerId: id(w.a2), alertThreshold: 2, initialQuantity: 5 }));
});

const draft = async (who = w.managerA(w.a1), center = w.a1, lines: unknown = [{ productId: shampoo, quantity: 50 }], supplierId = sup) =>
  expectOk(await createPurchaseOrder(who, { centerId: id(center), supplierId, lines })).order;
const stockSnapshot = async () => ({ movements: await StockMovement.countDocuments(), levels: JSON.stringify((await StockLevel.find().sort({ productId: 1, centerId: 1 }).lean()).map((l) => [String(l.productId), String(l.centerId), l.quantity, l.seq])) });

describe("droits", () => {
  it("STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation sont refusés partout, sans écriture", async () => {
    const o = await draft();
    const before = await PurchaseOrder.countDocuments();
    for (const [label, who] of forbiddenActors(w)) {
      for (const [name, result] of [
        ["createPurchaseOrder", await createPurchaseOrder(who, { centerId: id(w.a1), supplierId: sup, lines: [{ productId: shampoo, quantity: 1 }] })],
        ["updateDraftPurchaseOrder", await updateDraftPurchaseOrder(who, { orderId: o.id, supplierId: sup })],
        ["placePurchaseOrder", await placePurchaseOrder(who, { orderId: o.id })],
        ["cancelPurchaseOrder", await cancelPurchaseOrder(who, { orderId: o.id })],
        ["getPurchaseOrder", await getPurchaseOrder(who, { orderId: o.id })],
        ["listPurchaseOrders", await listPurchaseOrders(who)],
      ] as const) assert.equal(expectFail(result, MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, `${label} : ${name}`);
    }
    assert.equal(await PurchaseOrder.countDocuments(), before);
    assert.equal((await PurchaseOrder.findById(o.id).lean())!.status, "DRAFT");
  });
});

describe("création", () => {
  it("un gérant crée un brouillon pour son centre ; nom, unité et fournisseur sont recopiés depuis la base, pas lus dans la saisie", async () => {
    const manager = w.managerA(w.a1);
    const order = expectOk(
      await createPurchaseOrder(manager, {
        centerId: id(w.a1),
        supplierId: sup,
        lines: [{ productId: shampoo, quantity: 50, productName: "Pirate", unit: "G" }, { productId: mask, quantity: 20 }],
        status: "RECEIVED",
        supplierName: "Pirate",
        organizationId: id(w.orgB),
      }),
    ).order;
    assert.deepEqual([order.status, order.centerId, order.supplierName, order.orderedAt, order.cancelledAt], ["DRAFT", id(w.a1), "Distri", null, null]);
    assert.deepEqual(order.lines.map((l) => [l.productName, l.unit, l.quantity]), [["Shampoing", "ML", 50], ["Masque", "G", 20]]);
    const stored = (await PurchaseOrder.findById(order.id).lean())!;
    assert.equal(String(stored.organizationId), id(w.orgA));
    assert.equal(String(stored.createdBy), manager.id);
  });

  it("créer une commande ne modifie jamais le stock", async () => {
    const before = await stockSnapshot();
    await draft();
    await draft(w.ownerA(), w.a2, [{ productId: dye, quantity: 12 }]);
    assert.deepEqual(await stockSnapshot(), before);
  });

  it("10. centre hors périmètre, d'une autre organisation, inexistant ou mal formé : même message, rien d'écrit", async () => {
    const manager = w.managerA(w.a1);
    for (const centerId of [id(w.a2), id(w.b1), newId(), "x", "", { $ne: "" }, undefined]) {
      expectFail(await createPurchaseOrder(manager, { centerId, supplierId: sup, lines: [{ productId: shampoo, quantity: 1 }] }), MSG_STOCK_CENTER_NOT_FOUND);
    }
    assert.equal(await PurchaseOrder.countDocuments(), 0);
  });

  it("fournisseur d'une autre organisation, inexistant ou archivé : refusé", async () => {
    const foreign = expectOk(await createSupplier(w.ownerB(), { name: "Fournisseur B" })).supplier.id;
    const lines = [{ productId: shampoo, quantity: 1 }];
    for (const supplierId of [foreign, newId()]) expectFail(await createPurchaseOrder(w.ownerA(), { centerId: id(w.a1), supplierId, lines }), MSG_SUPPLIER_NOT_FOUND);
    expectOk(await archiveSupplier(w.ownerA(), { supplierId: sup }));
    expectFail(await createPurchaseOrder(w.ownerA(), { centerId: id(w.a1), supplierId: sup, lines }), MSG_SUPPLIER_ARCHIVED);
    assert.equal(await PurchaseOrder.countDocuments(), 0);
  });

  it("produit d'une autre organisation, inexistant, archivé ou non activé dans le centre : refusé, aucune commande créée", async () => {
    const foreign = expectOk(await createProduct(w.ownerB(), { name: "Produit B", unit: "ML" })).product.id;
    const create = (lines: unknown) => createPurchaseOrder(w.ownerA(), { centerId: id(w.a1), supplierId: sup, lines });
    expectFail(await create([{ productId: foreign, quantity: 1 }]), MSG_PRODUCT_NOT_FOUND);
    expectFail(await create([{ productId: newId(), quantity: 1 }]), MSG_PRODUCT_NOT_FOUND);
    expectFail(await create([{ productId: shampoo, quantity: 1 }, { productId: foreign, quantity: 1 }]), MSG_PRODUCT_NOT_FOUND);
    expectFail(await create([{ productId: dye, quantity: 1 }]), MSG_NOT_ACTIVATED); // activé à Sousse seulement
    expectFail(await create([{ productId: shampoo, quantity: 1 }, { productId: dye, quantity: 1 }]), MSG_NOT_ACTIVATED);
    expectOk(await archiveProduct(w.ownerA(), { productId: mask }));
    expectFail(await create([{ productId: mask, quantity: 1 }]), MSG_PRODUCT_ARCHIVED);
    assert.equal(await PurchaseOrder.countDocuments(), 0);
  });

  it("refuse les lignes invalides : vides, doublons, quantité nulle, négative, décimale, trop grande, ou types incorrects", async () => {
    const create = (lines: unknown) => createPurchaseOrder(w.ownerA(), { centerId: id(w.a1), supplierId: sup, lines });
    const bad: unknown[] = [
      [],
      "lignes",
      null,
      [{ productId: shampoo, quantity: 1 }, { productId: shampoo, quantity: 2 }],
      [{ productId: shampoo, quantity: 0 }],
      [{ productId: shampoo, quantity: -4 }],
      [{ productId: shampoo, quantity: 2.5 }],
      [{ productId: shampoo, quantity: "5" }],
      [{ productId: shampoo, quantity: 2_000_000_000 }],
      [{ productId: { $ne: "" }, quantity: 1 }],
      [{ productId: "pas-un-id", quantity: 1 }],
      Array.from({ length: 51 }, () => ({ productId: newId(), quantity: 1 })),
    ];
    for (const lines of bad) expectFail(await create(lines));
    expectFail(await createPurchaseOrder(w.ownerA(), null));
    assert.equal(await PurchaseOrder.countDocuments(), 0);
  });
});

describe("modification d'un brouillon", () => {
  it("remplace les lignes et le fournisseur ; le centre de livraison ne change pas", async () => {
    const other = expectOk(await createSupplier(w.ownerA(), { name: "Autre fournisseur" })).supplier.id;
    const o = await draft();
    const u = expectOk(await updateDraftPurchaseOrder(w.managerA(w.a1), { orderId: o.id, supplierId: other, lines: [{ productId: mask, quantity: 7 }], centerId: id(w.a2), status: "ORDERED" })).order;
    assert.deepEqual([u.supplierName, u.centerId, u.status, u.lines.map((l) => [l.productName, l.unit, l.quantity])], ["Autre fournisseur", id(w.a1), "DRAFT", [["Masque", "G", 7]]]);
  });

  it("`changed` : faux quand le fournisseur et les lignes demandés sont déjà ceux de la commande (aucune écriture), vrai sinon", async () => {
    const o = await draft();
    const stamp = async () => (await PurchaseOrder.findById(o.id).lean())!.updatedAt?.getTime();
    const before = await stamp();
    const same = expectOk(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, supplierId: sup, lines: [{ productId: shampoo, quantity: 50 }] }));
    assert.equal(same.changed, false);
    assert.equal(await stamp(), before);
    assert.equal(expectOk(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [{ productId: shampoo, quantity: 51 }] })).changed, true);
    assert.equal(expectOk(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [{ productId: shampoo, quantity: 51 }, { productId: mask, quantity: 1 }] })).changed, true);
    assert.equal(expectOk(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, supplierId: sup })).changed, false);
  });

  it("10. commande d'un autre centre du gérant, d'une autre organisation ou inexistante : « introuvable »", async () => {
    const inA2 = await draft(w.ownerA(), w.a2, [{ productId: dye, quantity: 3 }]);
    const manager = w.managerA(w.a1);
    for (const orderId of [inA2.id, newId()]) {
      expectFail(await updateDraftPurchaseOrder(manager, { orderId, supplierId: sup }), MSG_ORDER_NOT_FOUND);
      expectFail(await placePurchaseOrder(manager, { orderId }), MSG_ORDER_NOT_FOUND);
      expectFail(await cancelPurchaseOrder(manager, { orderId }), MSG_ORDER_NOT_FOUND);
      expectFail(await getPurchaseOrder(manager, { orderId }), MSG_ORDER_NOT_FOUND);
    }
    assert.equal((await PurchaseOrder.findById(inA2.id).lean())!.status, "DRAFT");
  });

  it("une commande d'une autre organisation est « introuvable » pour un propriétaire étranger", async () => {
    const pb = expectOk(await createProduct(w.ownerB(), { name: "Produit B", unit: "ML" })).product.id;
    expectOk(await activateProductInCenter(w.ownerB(), { productId: pb, centerId: id(w.b1), initialQuantity: 5 }));
    const sb = expectOk(await createSupplier(w.ownerB(), { name: "Fournisseur B" })).supplier.id;
    const inB = await draft(w.ownerB(), w.b1, [{ productId: pb, quantity: 5 }], sb);
    for (const result of [
      await updateDraftPurchaseOrder(w.ownerA(), { orderId: inB.id, supplierId: sup }),
      await placePurchaseOrder(w.ownerA(), { orderId: inB.id }),
      await cancelPurchaseOrder(w.ownerA(), { orderId: inB.id }),
      await getPurchaseOrder(w.ownerA(), { orderId: inB.id }),
    ]) expectFail(result, MSG_ORDER_NOT_FOUND);
    assert.equal((await PurchaseOrder.findById(inB.id).lean())!.status, "DRAFT");
    assert.deepEqual(expectOk(await listPurchaseOrders(w.ownerA())).orders, []);
  });

  it("valide les lignes et le fournisseur comme à la création ; rien à modifier est refusé", async () => {
    const o = await draft();
    expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id }));
    expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [{ productId: dye, quantity: 1 }] }), MSG_NOT_ACTIVATED);
    expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [] }));
    expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, supplierId: newId() }), MSG_SUPPLIER_NOT_FOUND);
    assert.deepEqual((await PurchaseOrder.findById(o.id).lean())!.lines.map((l) => l.quantity), [50]);
  });
});

describe("transitions de statut", () => {
  it("DRAFT → ORDERED : date de commande posée, plus modifiable, ne peut plus être commandée deux fois", async () => {
    const o = await draft();
    const placed = expectOk(await placePurchaseOrder(w.managerA(w.a1), { orderId: o.id })).order;
    assert.equal(placed.status, "ORDERED");
    assert.ok(placed.orderedAt);
    expectFail(await placePurchaseOrder(w.ownerA(), { orderId: o.id }), MSG_ORDER_NOT_ORDERABLE);
    expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [{ productId: mask, quantity: 1 }] }), MSG_ORDER_NOT_EDITABLE);
    assert.deepEqual((await PurchaseOrder.findById(o.id).lean())!.lines.map((l) => l.quantity), [50]);
  });

  it("annulation : depuis un brouillon ou une commande passée ; jamais deux fois ; la commande n'est pas supprimée et ne se rouvre pas", async () => {
    const a = await draft();
    const b = await draft();
    expectOk(await placePurchaseOrder(w.ownerA(), { orderId: b.id }));
    for (const o of [a, b]) {
      const cancelled = expectOk(await cancelPurchaseOrder(w.managerA(w.a1), { orderId: o.id })).order;
      assert.equal(cancelled.status, "CANCELLED");
      assert.ok(cancelled.cancelledAt);
      expectFail(await cancelPurchaseOrder(w.ownerA(), { orderId: o.id }), MSG_ORDER_NOT_CANCELLABLE);
      expectFail(await placePurchaseOrder(w.ownerA(), { orderId: o.id }), MSG_ORDER_NOT_ORDERABLE);
      expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, supplierId: sup }), MSG_ORDER_NOT_EDITABLE);
    }
    assert.equal(await PurchaseOrder.countDocuments({ status: "CANCELLED" }), 2);
  });

  it("une commande reçue (état final, posé directement en base) ne peut ni être passée, ni modifiée, ni annulée", async () => {
    const o = await draft();
    await PurchaseOrder.collection.updateOne({ _id: (await PurchaseOrder.findById(o.id))!._id }, { $set: { status: "RECEIVED" } });
    expectFail(await placePurchaseOrder(w.ownerA(), { orderId: o.id }), MSG_ORDER_NOT_ORDERABLE);
    expectFail(await cancelPurchaseOrder(w.ownerA(), { orderId: o.id }), MSG_ORDER_NOT_CANCELLABLE);
    expectFail(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, supplierId: sup }), MSG_ORDER_NOT_EDITABLE);
    // La réception vit dans lib/stock/receipts.ts : ce module ne propose aucune fonction de réception (ni de crédit de stock).
    const functions = Object.entries(ordersModule).filter(([, v]) => typeof v === "function").map(([k]) => k);
    assert.deepEqual(functions.filter((k) => /receiv|reception/i.test(k)), []);
  });

  it("passer la commande exige un fournisseur encore actif, sinon elle reste en brouillon", async () => {
    const o = await draft();
    expectOk(await archiveSupplier(w.ownerA(), { supplierId: sup }));
    expectFail(await placePurchaseOrder(w.ownerA(), { orderId: o.id }), MSG_SUPPLIER_ARCHIVED);
    assert.equal((await PurchaseOrder.findById(o.id).lean())!.status, "DRAFT");
  });

  it("5 demandes simultanées pour passer la même commande : une seule réussit, la date n'est posée qu'une fois", async () => {
    const o = await draft();
    const results = await Promise.all(Array.from({ length: 5 }, () => placePurchaseOrder(w.ownerA(), { orderId: o.id })));
    assert.equal(results.filter((r) => r.ok).length, 1);
    for (const r of results.filter((r) => !r.ok)) assert.equal((r as { message?: string }).message, MSG_ORDER_NOT_ORDERABLE);
    assert.equal((await PurchaseOrder.findById(o.id).lean())!.status, "ORDERED");
  });

  it("modification et passage simultanés : l'état final est toujours cohérent (lignes modifiées si et seulement si la modification a réussi)", async () => {
    for (let round = 0; round < 6; round++) {
      const o = await draft();
      const [update, place] = await Promise.all([
        updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [{ productId: mask, quantity: 9 }] }),
        placePurchaseOrder(w.ownerA(), { orderId: o.id }),
      ]);
      assert.equal(place.ok, true);
      const stored = (await PurchaseOrder.findById(o.id).lean())!;
      assert.equal(stored.status, "ORDERED");
      assert.deepEqual(stored.lines.map((l) => l.quantity), update.ok ? [9] : [50], `tour ${round}`);
      if (!update.ok) assert.equal((update as { message?: string }).message, MSG_ORDER_NOT_EDITABLE);
    }
  });

  it("le stock n'est jamais modifié, du brouillon à l'annulation", async () => {
    const before = await stockSnapshot();
    const o = await draft(w.ownerA(), w.a1, [{ productId: shampoo, quantity: 500 }, { productId: mask, quantity: 300 }]);
    expectOk(await updateDraftPurchaseOrder(w.ownerA(), { orderId: o.id, lines: [{ productId: shampoo, quantity: 600 }] }));
    expectOk(await placePurchaseOrder(w.ownerA(), { orderId: o.id }));
    expectOk(await cancelPurchaseOrder(w.ownerA(), { orderId: o.id }));
    assert.deepEqual(await stockSnapshot(), before);
  });
});

describe("historique préservé", () => {
  it("renommer ou archiver le fournisseur et le produit ne change pas les commandes existantes", async () => {
    const o = await draft();
    expectOk(await placePurchaseOrder(w.ownerA(), { orderId: o.id }));
    expectOk(await updateSupplier(w.ownerA(), { supplierId: sup, name: "Nouveau nom" }));
    expectOk(await archiveSupplier(w.ownerA(), { supplierId: sup }));
    expectOk(await updateProduct(w.ownerA(), { productId: shampoo, name: "Shampoing premium" }));
    expectOk(await archiveProduct(w.ownerA(), { productId: shampoo }));
    const seen = expectOk(await getPurchaseOrder(w.ownerA(), { orderId: o.id })).order;
    assert.deepEqual([seen.supplierId, seen.supplierName, seen.lines[0].productId, seen.lines[0].productName, seen.lines[0].unit, seen.status], [sup, "Distri", shampoo, "Shampoing", "ML", "ORDERED"]);
    assert.equal(await Supplier.countDocuments({ _id: sup }), 1);
    expectOk(await cancelPurchaseOrder(w.ownerA(), { orderId: o.id })); // une commande passée reste annulable même si le fournisseur est archivé
  });

  it("l'unité d'un produit ne peut plus changer une fois du stock enregistré : les lignes de commande restent cohérentes", async () => {
    expectOk(await recordStockMovement(w.ownerA(), { productId: shampoo, centerId: id(w.a1), kind: "IN", quantity: 5 }));
    expectFail(await updateProduct(w.ownerA(), { productId: shampoo, unit: "G" }));
  });
});

describe("consultation", () => {
  it("le propriétaire voit tous ses centres, le gérant les siens ; filtre par centre et par statut ; plus récentes d'abord", async () => {
    const first = await draft(w.ownerA(), w.a1);
    const second = await draft(w.ownerA(), w.a2, [{ productId: dye, quantity: 4 }]);
    const third = await draft(w.managerA(w.a1), w.a1, [{ productId: mask, quantity: 2 }]);
    expectOk(await placePurchaseOrder(w.ownerA(), { orderId: third.id }));
    const ids = async (who: ReturnType<World["ownerA"]>, center?: unknown, filter?: unknown) => expectOk(await listPurchaseOrders(who, center, filter)).orders.map((o) => o.id);
    assert.deepEqual(await ids(w.ownerA()), [third.id, second.id, first.id]);
    assert.deepEqual(await ids(w.managerA(w.a1)), [third.id, first.id]);
    assert.deepEqual(await ids(w.managerA()), []);
    assert.deepEqual(await ids(w.ownerA(), id(w.a2)), [second.id]);
    assert.deepEqual(await ids(w.ownerA(), undefined, { status: "ORDERED" }), [third.id]);
    assert.deepEqual(await ids(w.ownerA(), undefined, { status: "RECEIVED" }), []);
    expectFail(await listPurchaseOrders(w.ownerA(), undefined, { status: "SHIPPED" }));
    for (const requested of [id(w.a2), id(w.b1), newId(), "", { $ne: "" }]) expectFail(await listPurchaseOrders(w.managerA(w.a1), requested), MSG_STOCK_CENTER_NOT_FOUND);
  });

  it("n'affiche jamais d'identifiant d'organisation", async () => {
    await draft();
    assert.ok(!JSON.stringify(expectOk(await listPurchaseOrders(w.ownerA()))).includes(id(w.orgA)));
  });
});
