// Module 5 (F5.6, suite) — Réception à confirmer, écart signalé, retour (annulation), demande de transfert, boîte de réception, seuil copié.
// Base MongoDB éphémère en mémoire (lib/booking/test-support.ts). Les règles de base des transferts sont dans transfers.test.ts.
// Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Equipment, StockLevel, StockMovement, StockTransfer } from "@/lib/models/stock";
import { createEquipment } from "./equipment";
import { readTail, verifyLedger } from "./ledger";
import { MSG_STOCK_CENTER_NOT_FOUND } from "./scope";
import { MSG_PRODUCT_ARCHIVED, activateProductInCenter, archiveProduct, createProduct, recordStockMovement } from "./service";
import {
  MSG_RECEIPT_NOT_APPLICABLE,
  MSG_RECEIPT_NOTE_REQUIRED,
  MSG_RECEIPT_TOO_MUCH,
  MSG_REQUEST_NOT_OPEN,
  MSG_REVERSE_FORBIDDEN,
  MSG_REVERSE_NOTHING,
  MSG_REVERSE_OF_REVERSAL,
  MSG_TRANSFER_NOT_FOUND,
  MSG_TRANSFER_NOT_RESUMABLE,
  MSG_TRANSFER_NOTHING,
  MSG_TRANSFER_REQUEST_REUSED,
  MSG_TRANSFER_REVERSED,
  answerTransferRequest,
  confirmTransferReceipt,
  getTransferInbox,
  listTransfers,
  requestTransfer,
  resumeTransfer,
  reverseTransfer,
  transferEquipment,
  transferProduct,
} from "./transfers";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, type World } from "./test-fixtures";

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
  await Promise.all([StockTransfer.syncIndexes(), Equipment.syncIndexes()]);
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  // Shampoing : 100 à Tunis (a1, seuil 10). Rien à Sousse (a2) ni à Djerba (a3).
  expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a1), alertThreshold: 10, initialQuantity: 100 }));
});

const rid = () => `req-${new Types.ObjectId()}`;
const owner = () => w.ownerA();
const send = (actor = owner(), over: Record<string, unknown> = {}) => transferProduct(actor, { requestId: rid(), fromCenterId: id(w.a1), toCenterId: id(w.a2), productId: shampoo, quantity: 30, ...over });
const key = (center: { _id: unknown }) => ({ organizationId: id(w.orgA), productId: shampoo, centerId: id(center) });
const tail = async (center: { _id: unknown }) => (await readTail(key(center))).balanceAfter;
const assertLedgers = async () => {
  for (const center of [w.a1, w.a2, w.a3]) assert.equal((await verifyLedger(key(center))).ledgerOk, true);
};

describe("envoi : réception à confirmer, motif, seuil copié", () => {
  it("un nouvel envoi attend la confirmation du centre destinataire ; le motif est conservé ; le seuil de la source est copié à destination", async () => {
    const r = expectOk(await send(owner(), { note: "Atelier coloration samedi" }));
    assert.deepEqual([r.transfer.receiptStatus, r.transfer.note, r.transfer.destinationActivated], ["AWAITING", "Atelier coloration samedi", true]);
    const dest = await StockLevel.findOne(key(w.a2)).lean();
    assert.equal(dest?.alertThreshold, 10); // plus 0 : le centre destinataire reçoit des alertes
    assert.equal(await tail(w.a2), 30);
    // Un second envoi vers un centre déjà activé ne l'« active » pas de nouveau et ne touche pas à son seuil.
    const second = expectOk(await send(owner()));
    assert.equal(second.transfer.destinationActivated, false);
    assert.equal((await StockLevel.findOne(key(w.a2)).lean())?.alertThreshold, 10);
    await assertLedgers();
  });

  it("un motif trop long ou un motif vide : refus / absent", async () => {
    expectFail(await send(owner(), { note: "x".repeat(201) }));
    const r = expectOk(await send(owner(), { note: "   " }));
    assert.equal(r.transfer.note, null);
  });
});

describe("confirmation de réception", () => {
  it("le gérant du centre destinataire confirme ; un second appel est sans effet ; la boîte de réception se vide", async () => {
    const sent = expectOk(await send());
    const receiver = w.managerA(w.a2);
    assert.equal(expectOk(await getTransferInbox(receiver)).toReceive.length, 1);
    const first = expectOk(await confirmTransferReceipt(receiver, { transferId: sent.transfer.id }));
    assert.deepEqual([first.advanced, first.transfer.receiptStatus, first.transfer.receivedQuantity], [true, "CONFIRMED", 30]);
    const again = expectOk(await confirmTransferReceipt(receiver, { transferId: sent.transfer.id }));
    assert.deepEqual([again.advanced, again.alreadyDone], [false, true]);
    assert.equal(expectOk(await getTransferInbox(receiver)).toReceive.length, 0);
    assert.equal(await tail(w.a2), 30); // la confirmation ne change jamais le stock
    await assertLedgers();
  });

  it("un écart exige un motif, ne peut pas dépasser la quantité transférée, ne corrige pas le stock", async () => {
    const sent = expectOk(await send());
    const receiver = w.managerA(w.a2);
    expectFail(await confirmTransferReceipt(receiver, { transferId: sent.transfer.id, receivedQuantity: 25 }), MSG_RECEIPT_NOTE_REQUIRED);
    expectFail(await confirmTransferReceipt(receiver, { transferId: sent.transfer.id, receivedQuantity: 31, note: "Trop" }), MSG_RECEIPT_TOO_MUCH);
    const r = expectOk(await confirmTransferReceipt(receiver, { transferId: sent.transfer.id, receivedQuantity: 25, note: "Un carton abîmé" }));
    assert.deepEqual([r.transfer.receiptStatus, r.transfer.receivedQuantity, r.transfer.receiptNote], ["DISCREPANCY", 25, "Un carton abîmé"]);
    assert.equal(await tail(w.a2), 30); // le journal est inchangé : l'écart est signalé, pas corrigé
    await assertLedgers();
  });

  it("matériel : conforme par défaut ; non conforme exige un motif", async () => {
    const item = expectOk(await createEquipment(owner(), { centerId: id(w.a1), name: "Séchoir", category: "Séchoir" })).equipment.id;
    const sent = expectOk(await transferEquipment(owner(), { requestId: rid(), equipmentId: item, toCenterId: id(w.a2) }));
    assert.equal(sent.transfer.receiptStatus, "AWAITING");
    expectFail(await confirmTransferReceipt(w.managerA(w.a2), { transferId: sent.transfer.id, conforme: false }), MSG_RECEIPT_NOTE_REQUIRED);
    const r = expectOk(await confirmTransferReceipt(w.managerA(w.a2), { transferId: sent.transfer.id, conforme: false, note: "Câble cassé" }));
    assert.deepEqual([r.transfer.receiptStatus, r.transfer.receivedQuantity], ["DISCREPANCY", null]);
  });

  it("droits : le centre d'origine, un autre centre, une autre organisation et les autres rôles ne confirment pas ; ancien transfert sans réception", async () => {
    const sent = expectOk(await send());
    for (const actor of [w.managerA(w.a1), w.managerA(w.a3), w.ownerB(), w.managerB(w.b1)]) expectFail(await confirmTransferReceipt(actor, { transferId: sent.transfer.id }), MSG_TRANSFER_NOT_FOUND);
    for (const [, actor] of forbiddenActors(w)) assert.equal((await confirmTransferReceipt(actor, { transferId: sent.transfer.id })).ok, false);
    expectOk(await confirmTransferReceipt(owner(), { transferId: sent.transfer.id })); // le propriétaire peut confirmer pour n'importe quel centre
    // Transfert antérieur à cette étape : aucune réception à confirmer.
    await StockTransfer.collection.updateOne({ _id: new Types.ObjectId(sent.transfer.id) }, { $unset: { receiptStatus: "" } });
    expectFail(await confirmTransferReceipt(owner(), { transferId: sent.transfer.id }), MSG_RECEIPT_NOT_APPLICABLE);
    expectFail(await confirmTransferReceipt(owner(), { transferId: "pas-un-id" }));
  });
});

describe("retour (annulation d'un transfert terminé)", () => {
  it("le propriétaire annule : le stock revient, le journal reste exact, un seul retour, jamais deux fois", async () => {
    const sent = expectOk(await send());
    const back = expectOk(await reverseTransfer(owner(), { transferId: sent.transfer.id, note: "Mauvais centre" }));
    assert.deepEqual([back.transferred, back.capped, back.transfer.reversesTransferId, back.transfer.note, back.transfer.receiptStatus], [30, false, sent.transfer.id, "Mauvais centre", null]);
    assert.deepEqual([back.transfer.fromCenterId, back.transfer.toCenterId], [id(w.a2), id(w.a1)]);
    assert.deepEqual([await tail(w.a1), await tail(w.a2)], [100, 0]);
    const original = (await listTransfers(owner(), { limit: 10 })) as { ok: true; transfers: { id: string; reversedByTransferId: string | null }[] };
    assert.equal(original.transfers.find((t) => t.id === sent.transfer.id)?.reversedByTransferId, back.transfer.id);
    // Rejouer l'annulation est sans effet ; un autre acteur ne peut pas annuler une seconde fois.
    const replay = expectOk(await reverseTransfer(owner(), { transferId: sent.transfer.id }));
    assert.deepEqual([replay.advanced, replay.alreadyDone], [false, true]);
    const other = expectOk(await reverseTransfer(w.managerA(w.a2), { transferId: sent.transfer.id })); // acteur autorisé : même réponse « déjà fait »
    assert.deepEqual([other.advanced, other.alreadyDone], [false, true]);
    expectFail(await reverseTransfer(owner(), { transferId: back.transfer.id }), MSG_REVERSE_OF_REVERSAL);
    assert.equal(await StockMovement.countDocuments({ kind: "TRANSFER_OUT" }), 2);
    assert.equal(await StockMovement.countDocuments({ kind: "TRANSFER_IN" }), 2);
    await assertLedgers();
  });

  it("un transfert annulé sort de la boîte de réception et ne peut plus être confirmé", async () => {
    const sent = expectOk(await send());
    expectOk(await reverseTransfer(owner(), { transferId: sent.transfer.id }));
    assert.equal(expectOk(await getTransferInbox(w.managerA(w.a2))).toReceive.length, 0);
    expectFail(await confirmTransferReceipt(w.managerA(w.a2), { transferId: sent.transfer.id }), MSG_TRANSFER_REVERSED);
  });

  it("ce qui a déjà été consommé à destination ne revient pas : retour plafonné au stock disponible", async () => {
    const sent = expectOk(await send());
    expectOk(await recordStockMovement(owner(), { productId: shampoo, centerId: id(w.a2), kind: "OUT", quantity: 20 }));
    const back = expectOk(await reverseTransfer(owner(), { transferId: sent.transfer.id }));
    assert.deepEqual([back.transferred, back.capped], [10, true]);
    assert.deepEqual([await tail(w.a1), await tail(w.a2)], [80, 0]);
    await assertLedgers();
  });

  it("rien à retourner (destination à zéro) : refus, le transfert d'origine reste annulable plus tard", async () => {
    const sent = expectOk(await send());
    expectOk(await recordStockMovement(owner(), { productId: shampoo, centerId: id(w.a2), kind: "OUT", quantity: 30 }));
    expectFail(await reverseTransfer(owner(), { transferId: sent.transfer.id }), MSG_REVERSE_NOTHING);
    assert.equal(await StockTransfer.countDocuments({ reversesTransferId: { $exists: true } }), 0); // aucun retour fantôme
    assert.equal((await StockTransfer.findById(sent.transfer.id).lean())?.reversedByTransferId, undefined);
    expectOk(await recordStockMovement(owner(), { productId: shampoo, centerId: id(w.a2), kind: "IN", quantity: 12 }));
    assert.equal(expectOk(await reverseTransfer(owner(), { transferId: sent.transfer.id })).transferred, 12);
  });

  it("droits : auteur (gérant) tant que la réception n'est pas confirmée, gérant destinataire toujours, étranger jamais", async () => {
    const author = w.managerA(w.a1);
    const sent = expectOk(await send(author));
    // Un autre gérant sans lien avec les deux centres : introuvable.
    expectFail(await reverseTransfer(w.managerA(w.a3), { transferId: sent.transfer.id }), MSG_TRANSFER_NOT_FOUND);
    expectFail(await reverseTransfer(w.ownerB(), { transferId: sent.transfer.id }), MSG_TRANSFER_NOT_FOUND);
    // Autre gérant du centre d'origine (pas l'auteur) : refusé ; l'auteur : accepté avant confirmation.
    expectFail(await reverseTransfer(w.managerA(w.a1), { transferId: sent.transfer.id }), MSG_REVERSE_FORBIDDEN);
    const second = expectOk(await send(author));
    expectOk(await confirmTransferReceipt(w.managerA(w.a2), { transferId: second.transfer.id }));
    expectFail(await reverseTransfer(author, { transferId: second.transfer.id }), MSG_REVERSE_FORBIDDEN); // réception confirmée : plus à l'auteur
    // Le gérant destinataire renvoie, même après confirmation.
    expectOk(await reverseTransfer(w.managerA(w.a2), { transferId: second.transfer.id }));
    for (const [, actor] of forbiddenActors(w)) assert.equal((await reverseTransfer(actor, { transferId: sent.transfer.id })).ok, false);
  });

  it("transfert non terminé : refus ; matériel : l'équipement retourne au centre d'origine", async () => {
    const item = expectOk(await createEquipment(owner(), { centerId: id(w.a1), name: "Séchoir", category: "Séchoir" })).equipment.id;
    const sent = expectOk(await transferEquipment(owner(), { requestId: rid(), equipmentId: item, toCenterId: id(w.a2) }));
    expectOk(await reverseTransfer(owner(), { transferId: sent.transfer.id }));
    assert.equal(String((await Equipment.findById(item).lean())?.centerId), id(w.a1));
    const pending = await StockTransfer.create({ organizationId: w.orgA._id, requestId: rid(), kind: "PRODUCT", fromCenterId: w.a1._id, toCenterId: w.a2._id, productId: shampoo, requestedQuantity: 5 });
    expectFail(await reverseTransfer(owner(), { transferId: String(pending._id) }));
  });
});

describe("demande de transfert", () => {
  const ask = (actor = w.managerA(w.a2), over: Record<string, unknown> = {}) => requestTransfer(actor, { requestId: rid(), fromCenterId: id(w.a1), toCenterId: id(w.a2), productId: shampoo, quantity: 40, note: "Samedi chargé", ...over });

  it("le gérant du centre qui a besoin de stock demande ; rien ne bouge ; la demande arrive chez le centre source seulement", async () => {
    const r = expectOk(await ask());
    assert.deepEqual([r.transfer.status, r.transfer.receiptStatus, r.transfer.note, r.advanced], ["REQUESTED", null, "Samedi chargé", true]);
    assert.deepEqual([await tail(w.a1), await tail(w.a2)], [100, 0]);
    assert.equal(expectOk(await getTransferInbox(w.managerA(w.a1))).requests.length, 1);
    assert.equal(expectOk(await getTransferInbox(w.managerA(w.a2))).requests.length, 0); // le demandeur ne répond pas à sa propre demande
    assert.equal(expectOk(await getTransferInbox(w.managerA(w.a3))).requests.length, 0);
  });

  it("un gérant ne demande que pour SON centre ; centres identiques, produit archivé, requestId réutilisé : refus ; même demande rejouée : sans doublon", async () => {
    expectFail(await ask(w.managerA(w.a2), { toCenterId: id(w.a3) }), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await ask(w.managerA(w.a2), { fromCenterId: id(w.a2) }));
    expectFail(await ask(w.managerA(w.a2), { fromCenterId: id(w.b1) }), MSG_STOCK_CENTER_NOT_FOUND);
    const requestId = rid();
    const first = expectOk(await ask(w.managerA(w.a2), { requestId }));
    const again = expectOk(await ask(w.managerA(w.a2), { requestId }));
    assert.deepEqual([again.alreadyDone, again.advanced, again.transfer.id], [true, false, first.transfer.id]);
    expectFail(await ask(w.managerA(w.a2), { requestId, quantity: 41 }), MSG_TRANSFER_REQUEST_REUSED);
    assert.equal(await StockTransfer.countDocuments({ status: "REQUESTED" }), 1);
    const archived = expectOk(await createProduct(owner(), { name: "Ancien", unit: "G" })).product.id;
    expectOk(await archiveProduct(owner(), { productId: archived }));
    expectFail(await ask(w.managerA(w.a2), { productId: archived }), MSG_PRODUCT_ARCHIVED);
    for (const [, actor] of forbiddenActors(w)) assert.equal((await ask(actor)).ok, false);
  });

  it("le centre source accepte : le transfert part (plafonné), réception à confirmer, seuil copié ; rejouer est sans effet", async () => {
    const asked = expectOk(await ask());
    expectFail(await answerTransferRequest(w.managerA(w.a2), { transferId: asked.transfer.id, decision: "ACCEPT" }), MSG_TRANSFER_NOT_FOUND); // le demandeur ne s'accepte pas lui-même
    expectFail(await answerTransferRequest(w.managerA(w.a3), { transferId: asked.transfer.id, decision: "ACCEPT" }), MSG_TRANSFER_NOT_FOUND);
    const accepted = expectOk(await answerTransferRequest(w.managerA(w.a1), { transferId: asked.transfer.id, decision: "ACCEPT", note: "OK pour 40" }));
    assert.deepEqual([accepted.transfer.status, accepted.transferred, accepted.transfer.receiptStatus, accepted.transfer.decisionNote], ["COMPLETED", 40, "AWAITING", "OK pour 40"]);
    assert.deepEqual([await tail(w.a1), await tail(w.a2)], [60, 40]);
    assert.equal((await StockLevel.findOne(key(w.a2)).lean())?.alertThreshold, 10);
    const replay = expectOk(await answerTransferRequest(w.managerA(w.a1), { transferId: asked.transfer.id, decision: "ACCEPT" }));
    assert.deepEqual([replay.advanced, replay.alreadyDone], [false, true]);
    assert.equal(expectOk(await getTransferInbox(w.managerA(w.a2))).toReceive.length, 1);
    expectFail(await answerTransferRequest(w.managerA(w.a1), { transferId: asked.transfer.id, decision: "REFUSE" }), MSG_REQUEST_NOT_OPEN);
    await assertLedgers();
  });

  it("accepter plafonne au stock disponible ; sans stock, refus et la demande reste ouverte", async () => {
    const big = expectOk(await ask(w.managerA(w.a2), { quantity: 500 }));
    const accepted = expectOk(await answerTransferRequest(owner(), { transferId: big.transfer.id, decision: "ACCEPT" }));
    assert.deepEqual([accepted.transferred, accepted.capped], [100, true]);
    const empty = expectOk(await ask(w.managerA(w.a3), { fromCenterId: id(w.a1), toCenterId: id(w.a3), quantity: 5 }));
    expectFail(await answerTransferRequest(owner(), { transferId: empty.transfer.id, decision: "ACCEPT" }), MSG_TRANSFER_NOTHING);
    assert.equal((await StockTransfer.findById(empty.transfer.id).lean())?.status, "REQUESTED");
    await assertLedgers();
  });

  it("refuser clôt la demande sans toucher au stock ; le demandeur peut la retirer ; une demande n'est pas « reprenable »", async () => {
    const a = expectOk(await ask());
    const refused = expectOk(await answerTransferRequest(w.managerA(w.a1), { transferId: a.transfer.id, decision: "REFUSE", note: "Stock réservé" }));
    assert.deepEqual([refused.transfer.status, refused.transfer.decisionNote, refused.transferred], ["REFUSED", "Stock réservé", null]);
    expectFail(await resumeTransfer(owner(), { transferId: a.transfer.id }), MSG_TRANSFER_NOT_RESUMABLE);
    const b = expectOk(await ask());
    expectFail(await answerTransferRequest(w.managerA(w.a1), { transferId: b.transfer.id, decision: "WITHDRAW" }), MSG_TRANSFER_NOT_FOUND); // la source ne « retire » pas
    expectOk(await answerTransferRequest(w.managerA(w.a2), { transferId: b.transfer.id, decision: "WITHDRAW" }));
    expectFail(await answerTransferRequest(w.managerA(w.a1), { transferId: b.transfer.id, decision: "ACCEPT" }), MSG_REQUEST_NOT_OPEN);
    assert.deepEqual([await tail(w.a1), await tail(w.a2)], [100, 0]);
  });

  it("un envoi ne peut pas « terminer » une demande par le même requestId", async () => {
    const requestId = rid();
    const asked = expectOk(await requestTransfer(w.managerA(w.a2), { requestId, fromCenterId: id(w.a1), toCenterId: id(w.a2), productId: shampoo, quantity: 40 }));
    const replay = await transferProduct(owner(), { requestId, fromCenterId: id(w.a1), toCenterId: id(w.a2), productId: shampoo, quantity: 40 });
    assert.equal(replay.ok, false);
    assert.deepEqual([await tail(w.a1), await tail(w.a2)], [100, 0]);
    assert.equal((await StockTransfer.findById(asked.transfer.id).lean())?.status, "REQUESTED");
  });
});

describe("historique", () => {
  it("filtre par statut ; les demandes et retours apparaissent pour les centres concernés seulement", async () => {
    expectOk(await send());
    expectOk(await requestTransfer(w.managerA(w.a2), { requestId: rid(), fromCenterId: id(w.a1), toCenterId: id(w.a2), productId: shampoo, quantity: 5 }));
    const requested = expectOk(await listTransfers(owner(), { status: "REQUESTED" }));
    assert.equal(requested.transfers.length, 1);
    assert.equal(expectOk(await listTransfers(owner(), { status: "COMPLETED" })).transfers.length, 1);
    assert.equal(expectOk(await listTransfers(w.managerA(w.a3), {})).transfers.length, 0);
    expectFail(await listTransfers(owner(), { status: "INCONNU" }));
  });
});
