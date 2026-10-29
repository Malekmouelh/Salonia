// Module 5 (F5.6) — Transferts de produits et de matériel entre centres : plafonnement, stock disponible nul, droits OWNER/MANAGER/autres,
// centres identiques, isolation entre organisations, idempotence (même demande = un seul transfert, y compris en concurrence), interruption
// à chaque frontière d'écriture puis reprise (aucun stock créé ni perdu), matériel (identité et historique de maintenance conservés, course
// sur le centre source, un seul transfert en cours), invariants du journal (verifyLedger) et historique paginé.
// Base MongoDB éphémère en mémoire (lib/booking/test-support.ts, inchangé). Les interruptions sont SIMULÉES : on enregistre le transfert et
// on appelle les étapes du journal l'une sans l'autre, puis on reprend. Aucun processus n'est réellement tué.
// Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import type { StockMovementKind } from "@/lib/enums";
import { addDays, dayKey } from "@/lib/booking/time";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Equipment, MaintenanceRecord, StockLevel, StockMovement, StockTransfer } from "@/lib/models/stock";
import { MSG_EQUIPMENT_ARCHIVED, MSG_EQUIPMENT_NOT_FOUND, archiveEquipment, createEquipment, listMaintenanceHistory, recordMaintenance } from "./equipment";
import { commitTransferIn, commitTransferOut, readTail, verifyLedger } from "./ledger";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN, MSG_TRANSFER_SAME_CENTER, StockAccessError, requireTransferCenters, resolveTransferDestination, transferDestinations } from "./scope";
import { MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, activateProductInCenter, archiveProduct, createProduct } from "./service";
import {
  MSG_EQUIPMENT_IN_TRANSFER,
  MSG_EQUIPMENT_UNAVAILABLE,
  MSG_TRANSFER_NOT_FOUND,
  MSG_TRANSFER_NOT_RESUMABLE,
  MSG_TRANSFER_NOTHING,
  MSG_TRANSFER_REQUEST_REUSED,
  listTransfers,
  resumeTransfer,
  transferEquipment,
  transferProduct,
} from "./transfers";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, newId, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

let shampoo: string, mask: string;
beforeEach(async () => {
  w = await makeWorld(db);
  await StockTransfer.syncIndexes(); // makeWorld (fichier de test partagé, non modifié) ne connaît pas encore ce modèle
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  mask = expectOk(await createProduct(w.ownerA(), { name: "Masque", unit: "G" })).product.id;
  // Shampoing : 100 à Tunis (a1). Masque : 50 à Tunis, 10 à Sousse (a2, seuil 5). Rien à Djerba (a3).
  expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a1), alertThreshold: 10, initialQuantity: 100 }));
  expectOk(await activateProductInCenter(w.ownerA(), { productId: mask, centerId: id(w.a1), alertThreshold: 5, initialQuantity: 50 }));
  expectOk(await activateProductInCenter(w.ownerA(), { productId: mask, centerId: id(w.a2), alertThreshold: 5, initialQuantity: 10 }));
});

const rid = () => `req-${new Types.ObjectId()}`;
const owner = () => w.ownerA();
const productInput = (over: Record<string, unknown> = {}) => ({ requestId: rid(), fromCenterId: id(w.a1), toCenterId: id(w.a2), productId: shampoo, quantity: 30, ...over });
const levelOf = async (productId: string, center: { _id: unknown }) => (await StockLevel.findOne({ organizationId: w.orgA._id, productId, centerId: center._id as Types.ObjectId }).lean())!;
const key = (productId: string, center: { _id: unknown }) => ({ organizationId: id(w.orgA), productId, centerId: id(center) });
const movements = (kind: StockMovementKind, transferId?: string) => StockMovement.find({ kind, ...(transferId ? { transferId } : {}) }).lean();
const tail = async (productId: string, center: { _id: unknown }) => (await readTail(key(productId, center))).balanceAfter;
// Stock total d'un produit dans tous les centres de l'organisation A, lu dans le JOURNAL : un transfert ne le change jamais.
const total = async (productId: string) => (await tail(productId, w.a1)) + (await tail(productId, w.a2)) + (await tail(productId, w.a3));
const assertLedgers = async (productId: string) => {
  for (const center of [w.a1, w.a2, w.a3]) {
    const report = await verifyLedger(key(productId, center));
    assert.equal(report.ledgerOk, true, JSON.stringify(report.issues));
    assert.ok(report.projection === "IN_SYNC" || report.projection === "NO_LEVEL", `${id(center)} : ${report.projection}`);
  }
};
const noWrites = async () => {
  assert.equal(await StockTransfer.countDocuments(), 0, "aucun transfert ne devait être enregistré");
  assert.equal(await StockMovement.countDocuments({ kind: { $in: ["TRANSFER_OUT", "TRANSFER_IN"] } }), 0, "aucun mouvement de transfert ne devait être créé");
};
// Transfert resté PENDING, enregistré à la main : point de départ des interruptions simulées.
const pendingTransfer = (over: Record<string, unknown> = {}) =>
  StockTransfer.create({ organizationId: w.orgA._id, requestId: rid(), kind: "PRODUCT", fromCenterId: w.a1._id, toCenterId: w.a2._id, productId: shampoo, requestedQuantity: 30, ...over });

describe("droits et périmètre d'un transfert (fonctions pures)", () => {
  it("OWNER : source et destination = n'importe quels centres différents de son organisation", () => {
    const o = owner();
    for (const [from, to] of [[w.a1, w.a2], [w.a2, w.a3], [w.a3, w.a1]]) assert.deepEqual(requireTransferCenters(o, id(from), id(to)), { organizationId: id(w.orgA), fromCenterId: id(from), toCenterId: id(to) });
    assert.deepEqual(transferDestinations(o).map((c) => c.id), [id(w.a1), id(w.a2), id(w.a3)]);
  });

  it("MANAGER : source = ses centres seulement, destination = tout centre de l'organisation", () => {
    const m = w.managerA(w.a2);
    assert.equal(requireTransferCenters(m, id(w.a2), id(w.a1)).toCenterId, id(w.a1));
    assert.equal(requireTransferCenters(m, id(w.a2), id(w.a3)).toCenterId, id(w.a3));
    for (const from of [w.a1, w.a3]) assert.throws(() => requireTransferCenters(m, id(from), id(w.a2)), (e) => e instanceof StockAccessError && e.message === MSG_STOCK_CENTER_NOT_FOUND);
    assert.deepEqual(transferDestinations(m).map((c) => c.id), [id(w.a1), id(w.a2), id(w.a3)]);
  });

  it("centres identiques, inconnus, d'une autre organisation ou mal formés : refus ; la source inaccessible ne révèle rien", () => {
    const o = owner();
    assert.throws(() => requireTransferCenters(o, id(w.a1), id(w.a1)), (e) => e instanceof StockAccessError && e.message === MSG_TRANSFER_SAME_CENTER);
    for (const bad of [id(w.b1), newId(), "", null, undefined, 42, { $ne: "" }, [id(w.a1)]]) {
      assert.throws(() => requireTransferCenters(o, bad, id(w.a2)), (e) => e instanceof StockAccessError && e.message === MSG_STOCK_CENTER_NOT_FOUND);
      assert.throws(() => requireTransferCenters(o, id(w.a1), bad), (e) => e instanceof StockAccessError && e.message === MSG_STOCK_CENTER_NOT_FOUND);
    }
    assert.equal(resolveTransferDestination(o, id(w.b1)), null);
  });

  it("STAFF, CLIENT, SUPER_ADMIN et utilisateurs sans organisation : aucun accès", () => {
    for (const [label, actor] of forbiddenActors(w)) {
      assert.throws(() => requireTransferCenters(actor, id(w.a1), id(w.a2)), (e) => e instanceof StockAccessError && e.message === MSG_STOCK_FORBIDDEN, label);
      assert.deepEqual(transferDestinations(actor), [], label);
    }
  });
});

describe("transfert de produit : cas nominaux et plafonnement", () => {
  it("transfère la quantité demandée : journal des deux centres, niveaux, statut, niveau de destination créé à seuil 0", async () => {
    const r = expectOk(await transferProduct(owner(), productInput()));
    assert.equal(r.requested, 30);
    assert.equal(r.transferred, 30);
    assert.equal(r.capped, false);
    assert.equal(r.alreadyDone, false);
    assert.equal(r.advanced, true);
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(r.transfer.kind, "PRODUCT");
    assert.equal(r.transfer.productName, "Shampoing");

    const out = await movements("TRANSFER_OUT", r.transfer.id);
    const inn = await movements("TRANSFER_IN", r.transfer.id);
    assert.equal(out.length, 1);
    assert.equal(inn.length, 1);
    assert.equal(out[0].delta, -30);
    assert.equal(inn[0].delta, 30);
    assert.equal(String(out[0].centerId), id(w.a1));
    assert.equal(String(inn[0].centerId), id(w.a2));
    assert.equal((await levelOf(shampoo, w.a1)).quantity, 70);
    const dest = await levelOf(shampoo, w.a2);
    assert.equal(dest.quantity, 30);
    assert.equal(dest.alertThreshold, 0);
    assert.equal(await total(shampoo), 100);
    await assertLedgers(shampoo);
  });

  it("un niveau déjà activé à destination garde son seuil et reçoit la quantité", async () => {
    const r = expectOk(await transferProduct(owner(), productInput({ productId: mask, quantity: 20 })));
    assert.equal(r.transferred, 20);
    const dest = await levelOf(mask, w.a2);
    assert.equal(dest.quantity, 30);
    assert.equal(dest.alertThreshold, 5);
    assert.equal((await levelOf(mask, w.a1)).quantity, 30);
    assert.equal(await total(mask), 60);
    await assertLedgers(mask);
  });

  it("PLAFONNE au stock disponible : transfère le disponible et indique demandé et transféré ; le stock ne devient jamais négatif", async () => {
    const r = expectOk(await transferProduct(owner(), productInput({ quantity: 500 })));
    assert.equal(r.requested, 500);
    assert.equal(r.transferred, 100);
    assert.equal(r.capped, true);
    assert.equal(r.transfer.requestedQuantity, 500);
    assert.equal(r.transfer.transferredQuantity, 100);
    assert.equal(await tail(shampoo, w.a1), 0);
    assert.equal(await tail(shampoo, w.a2), 100);
    assert.equal((await levelOf(shampoo, w.a1)).quantity, 0);
    assert.equal(await total(shampoo), 100);
    await assertLedgers(shampoo);
  });

  it("stock disponible 0 : message clair, aucun transfert ni mouvement vide", async () => {
    expectOk(await transferProduct(owner(), productInput({ quantity: 100 })));
    const transfers = await StockTransfer.countDocuments();
    const moves = await StockMovement.countDocuments();
    expectFail(await transferProduct(owner(), productInput({ quantity: 10 })), MSG_TRANSFER_NOTHING);
    assert.equal(await StockTransfer.countDocuments(), transfers);
    assert.equal(await StockMovement.countDocuments(), moves);
    assert.equal(await tail(shampoo, w.a1), 0);
  });

  it("quantités entières strictement positives, identifiants valides : sinon refus sans rien écrire", async () => {
    for (const quantity of [0, -5, 1.5, "30", null, undefined, Number.NaN, 2_000_000_000, { $gt: 0 }]) {
      const r = expectFail(await transferProduct(owner(), productInput({ quantity })));
      assert.ok(r.errors?.quantity || r.message, String(quantity));
    }
    for (const requestId of ["", "court", "a".repeat(65), "caractères invalides !!!!", null, undefined, { $ne: "" }]) expectFail(await transferProduct(owner(), productInput({ requestId })));
    for (const productId of ["", "xyz", null, { $ne: "" }, newId().toUpperCase().slice(1)]) expectFail(await transferProduct(owner(), productInput({ productId })));
    await noWrites();
    assert.equal(await tail(shampoo, w.a1), 100);
  });

  it("l'unité du produit n'est jamais modifiée par un transfert (ML, G)", async () => {
    const r = expectOk(await transferProduct(owner(), productInput({ productId: mask, quantity: 7 })));
    assert.equal(r.transfer.unit, "G");
    assert.equal((await levelOf(mask, w.a2)).quantity, 17);
  });
});

describe("transfert de produit : refus et isolation", () => {
  it("centres identiques : refus, rien d'écrit", async () => {
    expectFail(await transferProduct(owner(), productInput({ toCenterId: id(w.a1) })), MSG_TRANSFER_SAME_CENTER);
    await noWrites();
  });

  it("source ou destination hors organisation, inconnue ou mal formée : « Centre introuvable. », rien d'écrit", async () => {
    for (const over of [{ fromCenterId: id(w.b1) }, { toCenterId: id(w.b1) }, { fromCenterId: newId() }, { toCenterId: newId() }, { fromCenterId: undefined }, { toCenterId: { $ne: "" } }, { fromCenterId: [id(w.a1)] }]) {
      expectFail(await transferProduct(owner(), productInput(over)), MSG_STOCK_CENTER_NOT_FOUND);
    }
    await noWrites();
  });

  it("produit archivé, inexistant, d'une autre organisation ou non activé à la source : refus, rien d'écrit", async () => {
    const other = expectOk(await createProduct(w.ownerB(), { name: "Shampoing B", unit: "ML" })).product.id;
    const unlevelled = expectOk(await createProduct(owner(), { name: "Sans niveau", unit: "PIECE" })).product.id;
    const archived = expectOk(await createProduct(owner(), { name: "Archivé", unit: "PIECE" })).product.id;
    expectOk(await activateProductInCenter(owner(), { productId: archived, centerId: id(w.a1), alertThreshold: 0, initialQuantity: 5 }));
    expectOk(await archiveProduct(owner(), { productId: archived }));
    expectFail(await transferProduct(owner(), productInput({ productId: other })), MSG_PRODUCT_NOT_FOUND);
    expectFail(await transferProduct(owner(), productInput({ productId: newId() })), MSG_PRODUCT_NOT_FOUND);
    expectFail(await transferProduct(owner(), productInput({ productId: archived })), MSG_PRODUCT_ARCHIVED);
    expectFail(await transferProduct(owner(), productInput({ productId: unlevelled })), MSG_NOT_ACTIVATED);
    expectFail(await transferProduct(owner(), productInput({ productId: mask, fromCenterId: id(w.a3) })), MSG_NOT_ACTIVATED); // niveau absent à Djerba
    await noWrites();
  });

  it("MANAGER : envoie depuis son centre vers n'importe quel centre, ne prélève JAMAIS dans un centre qui n'est pas le sien", async () => {
    const m = w.managerA(w.a2);
    // Sousse → Tunis (centre d'un autre) : autorisé.
    const sent = expectOk(await transferProduct(m, productInput({ productId: mask, fromCenterId: id(w.a2), toCenterId: id(w.a1), quantity: 4 })));
    assert.equal(sent.transferred, 4);
    // Sousse → Djerba (centre sans niveau, d'un autre) : autorisé, niveau créé.
    expectOk(await transferProduct(m, productInput({ productId: mask, fromCenterId: id(w.a2), toCenterId: id(w.a3), quantity: 2 })));
    assert.equal(await tail(mask, w.a2), 4);
    // Tunis → Sousse : prélèvement dans un centre qui n'est pas celui du gérant, refusé même avec une saisie falsifiée.
    const before = await tail(shampoo, w.a1);
    const transfers = await StockTransfer.countDocuments();
    for (const over of [{}, { organizationId: id(w.orgB) }, { role: "OWNER" }, { createdBy: newId() }, { centerId: id(w.a2) }]) {
      expectFail(await transferProduct(m, productInput(over)), MSG_STOCK_CENTER_NOT_FOUND); // fromCenterId = Tunis
    }
    assert.equal(await tail(shampoo, w.a1), before);
    assert.equal(await StockTransfer.countDocuments(), transfers);
    assert.equal(await StockMovement.countDocuments({ productId: shampoo, kind: "TRANSFER_OUT" }), 0);
  });

  it("STAFF, CLIENT, SUPER_ADMIN et sans organisation : refus, rien d'écrit", async () => {
    for (const [, actor] of forbiddenActors(w)) expectFail(await transferProduct(actor, productInput()), MSG_STOCK_FORBIDDEN);
    await noWrites();
  });

  it("une autre organisation ne peut ni transférer ni lire les transferts de la nôtre", async () => {
    const mine = expectOk(await transferProduct(owner(), productInput()));
    expectFail(await transferProduct(w.ownerB(), productInput({ fromCenterId: id(w.b1), toCenterId: id(w.b1) })));
    expectFail(await transferProduct(w.ownerB(), productInput()), MSG_STOCK_CENTER_NOT_FOUND);
    assert.deepEqual(expectOk(await listTransfers(w.ownerB())).transfers, []);
    expectFail(await resumeTransfer(w.ownerB(), { transferId: mine.transfer.id }), MSG_TRANSFER_NOT_FOUND);
    assert.equal(await StockTransfer.countDocuments(), 1);
  });
});

describe("transfert de produit : idempotence et concurrence", () => {
  it("la même demande envoyée deux fois ne crée qu'un transfert, une sortie et une entrée", async () => {
    const input = productInput();
    const first = expectOk(await transferProduct(owner(), input));
    const second = expectOk(await transferProduct(owner(), input));
    assert.equal(first.transfer.id, second.transfer.id);
    assert.equal(first.advanced, true);
    assert.equal(second.alreadyDone, true);
    assert.equal(second.advanced, false);
    assert.equal(second.transferred, 30);
    assert.equal(await StockTransfer.countDocuments(), 1);
    assert.equal((await movements("TRANSFER_OUT")).length, 1);
    assert.equal((await movements("TRANSFER_IN")).length, 1);
    assert.equal(await tail(shampoo, w.a1), 70);
    assert.equal(await tail(shampoo, w.a2), 30);
    await assertLedgers(shampoo);
  });

  it("la même demande pour autre chose (quantité, produit, centres) est refusée, sans effet", async () => {
    const input = productInput();
    expectOk(await transferProduct(owner(), input));
    for (const over of [{ quantity: 31 }, { productId: mask }, { toCenterId: id(w.a3) }]) {
      expectFail(await transferProduct(owner(), { ...input, ...over }), MSG_TRANSFER_REQUEST_REUSED);
    }
    assert.equal(await StockTransfer.countDocuments(), 1);
    assert.equal(await total(shampoo), 100);
  });

  it("10 envois simultanés de la même demande : un seul transfert, une sortie, une entrée, stock conservé", async () => {
    const input = productInput();
    const results = await Promise.all(Array.from({ length: 10 }, () => transferProduct(owner(), input)));
    for (const r of results) assert.equal(expectOk(r).transferred, 30);
    assert.equal(await StockTransfer.countDocuments(), 1);
    assert.equal((await movements("TRANSFER_OUT")).length, 1);
    assert.equal((await movements("TRANSFER_IN")).length, 1);
    assert.equal(await tail(shampoo, w.a1), 70);
    assert.equal(await tail(shampoo, w.a2), 30);
    assert.equal(results.filter((r) => r.ok && r.advanced).length >= 1, true);
    await assertLedgers(shampoo);
  });

  it("12 transferts différents de 10 sur un stock de 100 : exactement 10 réussissent, jamais négatif, total conservé", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => transferProduct(owner(), productInput({ quantity: 10 }))));
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    assert.equal(ok.length, 10);
    for (const f of failed) assert.equal((f as { message?: string }).message, MSG_TRANSFER_NOTHING);
    assert.equal(await tail(shampoo, w.a1), 0);
    assert.equal(await tail(shampoo, w.a2), 100);
    assert.equal(await StockTransfer.countDocuments({ status: "COMPLETED" }), 10);
    assert.equal(await StockTransfer.countDocuments({ status: "PENDING" }), 0);
    assert.equal((await movements("TRANSFER_OUT")).length, 10);
    assert.equal((await movements("TRANSFER_IN")).length, 10);
    await assertLedgers(shampoo);
  });

  it("des transferts concurrents plafonnés se partagent le disponible : somme transférée = stock initial", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => transferProduct(owner(), productInput({ quantity: 60 }))));
    const transferred = results.flatMap((r) => (r.ok ? [r.transferred ?? 0] : []));
    assert.equal(transferred.reduce((a, b) => a + b, 0), 100);
    assert.equal(await tail(shampoo, w.a1), 0);
    assert.equal(await total(shampoo), 100);
    await assertLedgers(shampoo);
  });
});

describe("transfert de produit : interruption puis reprise", () => {
  it("interruption entre la sortie et l'entrée : reprise explicite, aucun stock créé ni perdu, aucun double mouvement", async () => {
    const t = await pendingTransfer();
    await commitTransferOut({ ...key(shampoo, w.a1), transferId: String(t._id), requested: 30 }); // sortie validée, ni projection ni entrée
    assert.equal(await tail(shampoo, w.a1), 70);
    assert.equal(await tail(shampoo, w.a2), 0);
    assert.equal(await total(shampoo), 70); // état intermédiaire : 30 « en vol », visible parce que le transfert est PENDING
    assert.equal((await levelOf(shampoo, w.a1)).quantity, 100); // projection en retard

    const r = expectOk(await resumeTransfer(owner(), { transferId: String(t._id) }));
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(r.transferred, 30);
    assert.equal(r.advanced, true);
    assert.equal(await tail(shampoo, w.a1), 70);
    assert.equal(await tail(shampoo, w.a2), 30);
    assert.equal(await total(shampoo), 100);
    assert.equal((await movements("TRANSFER_OUT")).length, 1);
    assert.equal((await movements("TRANSFER_IN")).length, 1);
    assert.equal((await levelOf(shampoo, w.a1)).quantity, 70); // projection réalignée
    await assertLedgers(shampoo);

    const again = expectOk(await resumeTransfer(owner(), { transferId: String(t._id) }));
    assert.equal(again.alreadyDone, true);
    assert.equal(again.advanced, false);
    assert.equal((await movements("TRANSFER_IN")).length, 1);
  });

  it("interruption avant toute écriture de stock : la même demande reprend et termine le transfert", async () => {
    const input = productInput();
    await pendingTransfer({ requestId: input.requestId, productId: shampoo, requestedQuantity: 30 });
    const r = expectOk(await transferProduct(owner(), input));
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(await StockTransfer.countDocuments(), 1);
    assert.equal(await tail(shampoo, w.a1), 70);
    assert.equal(await tail(shampoo, w.a2), 30);
    await assertLedgers(shampoo);
  });

  it("interruption après l'entrée mais avant le statut terminé : la reprise termine sans nouveau mouvement", async () => {
    const t = await pendingTransfer();
    const out = await commitTransferOut({ ...key(shampoo, w.a1), transferId: String(t._id), requested: 30 });
    await StockLevel.create({ ...key(shampoo, w.a2), alertThreshold: 0 });
    await commitTransferIn({ ...key(shampoo, w.a2), transferId: String(t._id), quantity: -out.movement!.delta });
    const r = expectOk(await resumeTransfer(owner(), { transferId: String(t._id) }));
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(r.advanced, true);
    assert.equal((await movements("TRANSFER_OUT")).length, 1);
    assert.equal((await movements("TRANSFER_IN")).length, 1);
    assert.equal(await total(shampoo), 100);
    await assertLedgers(shampoo);
  });

  it("une reprise après plafonnement garde la quantité réellement sortie", async () => {
    const t = await pendingTransfer({ requestedQuantity: 500 });
    await commitTransferOut({ ...key(shampoo, w.a1), transferId: String(t._id), requested: 500 });
    const r = expectOk(await resumeTransfer(owner(), { transferId: String(t._id) }));
    assert.equal(r.transferred, 100);
    assert.equal(r.capped, true);
    assert.equal(await tail(shampoo, w.a2), 100);
    assert.equal(await total(shampoo), 100);
  });

  it("un produit archivé depuis ne bloque pas la reprise : le stock déjà sorti doit arriver", async () => {
    const t = await pendingTransfer();
    await commitTransferOut({ ...key(shampoo, w.a1), transferId: String(t._id), requested: 30 });
    expectOk(await archiveProduct(owner(), { productId: shampoo }));
    const r = expectOk(await resumeTransfer(owner(), { transferId: String(t._id) }));
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(await total(shampoo), 100);
  });

  it("transfert en attente dont la source est vide : abandonné sans effet, non repris ensuite", async () => {
    expectOk(await transferProduct(owner(), productInput({ quantity: 100, toCenterId: id(w.a3) })));
    const t = await pendingTransfer();
    expectFail(await resumeTransfer(owner(), { transferId: String(t._id) }), MSG_TRANSFER_NOTHING);
    const doc = (await StockTransfer.findById(t._id).lean())!;
    assert.equal(doc.status, "CANCELLED");
    assert.equal(doc.transferredQuantity, 0);
    assert.equal((await movements("TRANSFER_OUT", String(t._id))).length, 0);
    expectFail(await resumeTransfer(owner(), { transferId: String(t._id) }), MSG_TRANSFER_NOT_RESUMABLE);
    assert.equal(await total(shampoo), 100);
  });

  it("droits de reprise : un gérant ne reprend que les transferts partis de ses centres ; les autres rôles sont refusés", async () => {
    const t = await pendingTransfer(); // source Tunis
    expectFail(await resumeTransfer(w.managerA(w.a2), { transferId: String(t._id) }), MSG_TRANSFER_NOT_FOUND);
    for (const [, actor] of forbiddenActors(w)) expectFail(await resumeTransfer(actor, { transferId: String(t._id) }), MSG_STOCK_FORBIDDEN);
    expectFail(await resumeTransfer(owner(), { transferId: "pas-un-id" }));
    assert.equal((await StockTransfer.findById(t._id).lean())!.status, "PENDING");
    expectOk(await resumeTransfer(w.managerA(w.a1), { transferId: String(t._id) }));
    assert.equal((await StockTransfer.findById(t._id).lean())!.status, "COMPLETED");
  });
});

describe("mouvements de transfert : modèle, index et journal", () => {
  const base = () => ({ organizationId: w.orgA._id, productId: shampoo, centerId: w.a1._id, seq: 50, delta: 1, balanceAfter: 1 });

  it("le modèle refuse un transfert sortant positif, un entrant négatif, un transfert sans identifiant et un identifiant sur un autre type", async () => {
    const transferId = new Types.ObjectId();
    await assert.rejects(StockMovement.create({ ...base(), kind: "TRANSFER_OUT", delta: 5, transferId }));
    await assert.rejects(StockMovement.create({ ...base(), kind: "TRANSFER_IN", delta: -5, transferId }));
    await assert.rejects(StockMovement.create({ ...base(), kind: "TRANSFER_IN", delta: 5 }));
    await assert.rejects(StockMovement.create({ ...base(), kind: "IN", delta: 5, transferId }));
    assert.equal(await StockMovement.countDocuments({ seq: 50 }), 0);
  });

  it("l'index unique interdit deux sorties (ou deux entrées) pour un même transfert et un même produit", async () => {
    const transferId = new Types.ObjectId();
    await StockMovement.create({ ...base(), kind: "TRANSFER_IN", transferId });
    await assert.rejects(StockMovement.create({ ...base(), seq: 51, kind: "TRANSFER_IN", transferId }), (e: { code?: number }) => e.code === 11000);
    await StockMovement.create({ ...base(), seq: 52, kind: "TRANSFER_OUT", delta: -1, balanceAfter: 0, transferId }); // l'autre sens est permis
  });

  it("les mouvements existants (sans identifiant de transfert) restent valides : l'index est partiel", async () => {
    assert.equal(await StockMovement.countDocuments({ transferId: { $exists: false } }) >= 3, true);
    await StockMovement.create({ ...base(), seq: 60, kind: "IN" });
    await StockMovement.create({ ...base(), seq: 61, kind: "IN" });
  });

  it("verifyLedger signale un mouvement de transfert incohérent ou doublé", async () => {
    const transferId = new Types.ObjectId();
    // Insertion directe (contourne le modèle) : un transfert sortant positif sans identifiant, et un doublon forcé.
    const tailNow = await readTail(key(shampoo, w.a3));
    await StockMovement.collection.insertMany([
      { organizationId: w.orgA._id, productId: new Types.ObjectId(shampoo), centerId: w.a3._id, kind: "TRANSFER_OUT", seq: tailNow.seq + 1, delta: 5, balanceAfter: 5 },
      { organizationId: w.orgA._id, productId: new Types.ObjectId(shampoo), centerId: w.a3._id, kind: "TRANSFER_IN", seq: tailNow.seq + 2, delta: 5, balanceAfter: 10, transferId },
    ]);
    const report = await verifyLedger(key(shampoo, w.a3));
    assert.equal(report.ledgerOk, false);
    assert.ok(report.issues.some((i) => i.code === "TRANSFER_INVALID"));
  });
});

describe("transfert de matériel", () => {
  let item: string;
  beforeEach(async () => {
    item = expectOk(await createEquipment(owner(), { centerId: id(w.a1), name: "Casque chauffant", category: "Casque" })).equipment.id;
    const days = (n: number) => dayKey(addDays(new Date(), n));
    expectOk(await recordMaintenance(owner(), { equipmentId: item, performedAt: days(-30), note: "Révision", nextDueAt: days(30) }));
    expectOk(await recordMaintenance(owner(), { equipmentId: item, performedAt: days(-5), note: "Nettoyage" }));
  });
  const equipmentInput = (over: Record<string, unknown> = {}) => ({ requestId: rid(), equipmentId: item, toCenterId: id(w.a2), ...over });
  const centerOf = async (equipmentId = item) => String((await Equipment.findById(equipmentId).lean())!.centerId);

  it("change le centre en gardant l'identité et l'historique de maintenance ; une trace est enregistrée", async () => {
    const r = expectOk(await transferEquipment(owner(), equipmentInput()));
    assert.equal(r.transfer.kind, "EQUIPMENT");
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(r.transfer.equipmentName, "Casque chauffant");
    assert.equal(r.transfer.fromCenterId, id(w.a1));
    assert.equal(r.transfer.toCenterId, id(w.a2));
    assert.equal(r.transferred, null);
    assert.equal(await centerOf(), id(w.a2));
    assert.equal(await Equipment.countDocuments(), 1); // même document : pas de copie
    const history = expectOk(await listMaintenanceHistory(owner(), { equipmentId: item })).history;
    assert.equal(history.length, 2);
    assert.equal(await MaintenanceRecord.countDocuments({ equipmentId: item }), 2);
    // Une nouvelle intervention porte le nouveau centre ; l'historique ancien garde le sien (immuable).
    expectOk(await recordMaintenance(owner(), { equipmentId: item, performedAt: dayKey(new Date()), note: "Après transfert" }));
    const centers = (await MaintenanceRecord.find({ equipmentId: item }).sort({ performedAt: 1 }).lean()).map((m) => String(m.centerId));
    assert.deepEqual(centers, [id(w.a1), id(w.a1), id(w.a2)]);
    const stored = (await StockTransfer.findById(r.transfer.id).lean())!;
    assert.equal(stored.completedAt instanceof Date, true);
  });

  it("MANAGER : transfère le matériel de son centre vers n'importe quel centre ; jamais celui d'un autre centre", async () => {
    expectOk(await transferEquipment(w.managerA(w.a1), equipmentInput({ toCenterId: id(w.a3) })));
    assert.equal(await centerOf(), id(w.a3));
    // Il n'a plus la main sur cet équipement (maintenant à Djerba) : même message qu'un équipement inconnu.
    expectFail(await transferEquipment(w.managerA(w.a1), equipmentInput({ toCenterId: id(w.a2) })), MSG_EQUIPMENT_NOT_FOUND);
    expectFail(await transferEquipment(w.managerA(w.a2), equipmentInput({ toCenterId: id(w.a1) })), MSG_EQUIPMENT_NOT_FOUND);
    assert.equal(await centerOf(), id(w.a3));
    assert.equal(await StockTransfer.countDocuments(), 1);
  });

  it("refus : centres identiques, destination hors organisation ou mal formée, équipement archivé ou inconnu, autre organisation, autres rôles", async () => {
    expectFail(await transferEquipment(owner(), equipmentInput({ toCenterId: id(w.a1) })), MSG_TRANSFER_SAME_CENTER);
    for (const toCenterId of [id(w.b1), newId(), "", undefined, { $ne: "" }]) expectFail(await transferEquipment(owner(), equipmentInput({ toCenterId })), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await transferEquipment(owner(), equipmentInput({ equipmentId: newId() })), MSG_EQUIPMENT_NOT_FOUND);
    expectFail(await transferEquipment(w.ownerB(), equipmentInput()), MSG_EQUIPMENT_NOT_FOUND);
    for (const [, actor] of forbiddenActors(w)) expectFail(await transferEquipment(actor, equipmentInput()), MSG_STOCK_FORBIDDEN);
    for (const equipmentId of ["", "xyz", null, { $ne: "" }]) expectFail(await transferEquipment(owner(), equipmentInput({ equipmentId })));
    expectOk(await archiveEquipment(owner(), { equipmentId: item }));
    expectFail(await transferEquipment(owner(), equipmentInput()), MSG_EQUIPMENT_ARCHIVED);
    assert.equal(await centerOf(), id(w.a1));
    assert.equal(await StockTransfer.countDocuments(), 0);
  });

  it("idempotence : la même demande ne crée qu'un transfert, même rejouée par un gérant qui n'a plus la main sur l'équipement", async () => {
    const input = equipmentInput();
    const m = w.managerA(w.a1);
    const first = expectOk(await transferEquipment(m, input));
    const second = expectOk(await transferEquipment(m, input));
    assert.equal(second.transfer.id, first.transfer.id);
    assert.equal(second.alreadyDone, true);
    assert.equal(second.advanced, false);
    assert.equal(await StockTransfer.countDocuments(), 1);
    expectFail(await transferEquipment(m, { ...input, toCenterId: id(w.a3) }), MSG_TRANSFER_REQUEST_REUSED);
    assert.equal(await centerOf(), id(w.a2));
  });

  it("10 envois simultanés de la même demande : un seul transfert, l'équipement dans le bon centre", async () => {
    const input = equipmentInput();
    const results = await Promise.all(Array.from({ length: 10 }, () => transferEquipment(owner(), input)));
    for (const r of results) expectOk(r);
    assert.equal(await StockTransfer.countDocuments(), 1);
    assert.equal(await centerOf(), id(w.a2));
  });

  it("un équipement déjà en transfert ne peut pas être transféré une seconde fois ; la reprise termine le premier", async () => {
    const pending = await StockTransfer.create({ organizationId: w.orgA._id, requestId: rid(), kind: "EQUIPMENT", fromCenterId: w.a1._id, toCenterId: w.a2._id, equipmentId: item });
    expectFail(await transferEquipment(owner(), equipmentInput({ toCenterId: id(w.a3) })), MSG_EQUIPMENT_IN_TRANSFER);
    assert.equal(await centerOf(), id(w.a1));
    expectOk(await resumeTransfer(owner(), { transferId: String(pending._id) }));
    assert.equal(await centerOf(), id(w.a2));
    assert.equal((await StockTransfer.findById(pending._id).lean())!.status, "COMPLETED");
  });

  it("COURSE sur le centre source : si l'équipement a changé de centre entre-temps, le transfert est annulé et rien n'est écrasé", async () => {
    const pending = await StockTransfer.create({ organizationId: w.orgA._id, requestId: rid(), kind: "EQUIPMENT", fromCenterId: w.a1._id, toCenterId: w.a2._id, equipmentId: item });
    await Equipment.updateOne({ _id: item }, { $set: { centerId: w.a3._id } }); // un autre déplacement est passé avant
    expectFail(await resumeTransfer(owner(), { transferId: String(pending._id) }), MSG_EQUIPMENT_UNAVAILABLE);
    assert.equal(await centerOf(), id(w.a3)); // la mise à jour conditionnelle n'a rien écrasé
    assert.equal((await StockTransfer.findById(pending._id).lean())!.status, "CANCELLED");
    expectFail(await resumeTransfer(owner(), { transferId: String(pending._id) }), MSG_TRANSFER_NOT_RESUMABLE);
  });

  it("interruption après le changement de centre mais avant le statut terminé : la reprise termine", async () => {
    const pending = await StockTransfer.create({ organizationId: w.orgA._id, requestId: rid(), kind: "EQUIPMENT", fromCenterId: w.a1._id, toCenterId: w.a2._id, equipmentId: item });
    await Equipment.updateOne({ _id: item }, { $set: { centerId: w.a2._id } });
    const r = expectOk(await resumeTransfer(owner(), { transferId: String(pending._id) }));
    assert.equal(r.transfer.status, "COMPLETED");
    assert.equal(await centerOf(), id(w.a2));
  });
});

describe("historique des transferts", () => {
  it("pagination par curseur, filtre par type, périmètre par centre, isolation entre organisations", async () => {
    const item = expectOk(await createEquipment(owner(), { centerId: id(w.a1), name: "Séchoir", category: "Séchoir" })).equipment.id;
    const ids: string[] = [];
    ids.push(expectOk(await transferProduct(owner(), productInput({ quantity: 10 }))).transfer.id); // Tunis → Sousse
    ids.push(expectOk(await transferProduct(owner(), productInput({ quantity: 10, toCenterId: id(w.a3) }))).transfer.id); // Tunis → Djerba
    ids.push(expectOk(await transferEquipment(owner(), { requestId: rid(), equipmentId: item, toCenterId: id(w.a2) })).transfer.id); // Tunis → Sousse
    ids.push(expectOk(await transferProduct(owner(), productInput({ productId: mask, fromCenterId: id(w.a2), toCenterId: id(w.a3), quantity: 3 }))).transfer.id); // Sousse → Djerba

    const all = expectOk(await listTransfers(owner(), { limit: 50 }));
    assert.deepEqual(all.transfers.map((t) => t.id), [...ids].reverse());
    assert.equal(all.nextBefore, null);

    const page1 = expectOk(await listTransfers(owner(), { limit: 3 }));
    assert.equal(page1.transfers.length, 3);
    assert.equal(page1.nextBefore, page1.transfers[2].id);
    const page2 = expectOk(await listTransfers(owner(), { limit: 3, before: page1.nextBefore }));
    assert.deepEqual([...page1.transfers, ...page2.transfers].map((t) => t.id), [...ids].reverse());
    assert.equal(page2.nextBefore, null);

    assert.deepEqual(expectOk(await listTransfers(owner(), { kind: "EQUIPMENT" })).transfers.map((t) => t.id), [ids[2]]);
    assert.equal(expectOk(await listTransfers(owner(), { centerId: id(w.a3) })).transfers.length, 2);
    // Gérant de Sousse : voit ce qui part de Sousse ou y arrive, pas Tunis → Djerba.
    const m = expectOk(await listTransfers(w.managerA(w.a2)));
    assert.deepEqual(m.transfers.map((t) => t.id).sort(), [ids[0], ids[2], ids[3]].sort());
    expectFail(await listTransfers(w.managerA(w.a2), { centerId: id(w.a1) }), MSG_STOCK_CENTER_NOT_FOUND);
    for (const [, actor] of forbiddenActors(w)) expectFail(await listTransfers(actor), MSG_STOCK_FORBIDDEN);
    assert.deepEqual(expectOk(await listTransfers(w.ownerB())).transfers, []);
    for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { before: "x" }, { kind: "AUTRE" }]) expectFail(await listTransfers(owner(), bad));
  });
});
