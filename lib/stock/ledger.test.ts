// Module 5 (étape 3) — Journal des mouvements et projection : épreuve du mécanisme D6 (sans transaction).
// Base MongoDB éphémère en mémoire (lib/booking/test-support.ts, inchangé). Les index sont reconstruits après chaque
// remise à zéro (la base est supprimée entre les tests). Lancer : npm test
//
// Ce que ces tests PROUVENT : le comportement observé ici, sur un serveur MongoDB autonome, avec des écrivains concurrents
// dans un seul processus. Ce qu'ils ne prouvent PAS : une panne réelle du processus ou du réseau en plein milieu d'une
// opération (simulée en appelant les étapes séparément), ni le comportement sur un jeu de réplicas ou Atlas.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { createCenter, createOrg, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Equipment, ServiceRecipe, StockLevel, StockMovement, StockProduct } from "@/lib/models/stock";
import { MSG_INSUFFICIENT_STOCK, MSG_ORDER_INCONSISTENT, StockError, isDuplicateKey } from "./errors";
import { commitMovement, commitReceipt, openLevel, projectLevel, readTail, repairLevel, verifyLedger, type LedgerKey } from "./ledger";

let db: TestDb;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

let key: LedgerKey;
let otherCenterId: string;

beforeEach(async () => {
  await resetTestDb(db);
  await Promise.all([Equipment, StockProduct, StockLevel, ServiceRecipe, StockMovement].map((m) => m.syncIndexes()));
  const org = await createOrg("Salon Stock");
  const center = await createCenter(org._id, "Tunis");
  const other = await createCenter(org._id, "Sousse");
  const product = await StockProduct.create({ organizationId: org._id, name: "Shampoing", unit: "ML" });
  await StockLevel.create({ organizationId: org._id, productId: product._id, centerId: center._id, alertThreshold: 100 });
  key = { organizationId: String(org._id), productId: String(product._id), centerId: String(center._id) };
  otherCenterId = String(other._id);
});

const movements = () => StockMovement.find(key).sort({ seq: 1 }).lean();
const level = async () => (await StockLevel.findOne(key).lean())!;
const commit = (delta: number, kind: "IN" | "OUT" | "ADJUSTMENT" = delta > 0 ? "IN" : "OUT", note?: string) =>
  commitMovement({ ...key, kind, delta, note: kind === "ADJUSTMENT" ? (note ?? "Inventaire") : note });
const commitAndProject = async (delta: number) => {
  const m = await commit(delta);
  await projectLevel({ ...key, seq: m.seq, balanceAfter: m.balanceAfter });
  return m;
};
// Insertion « brute » : contourne volontairement Mongoose pour fabriquer un journal corrompu.
const rawMovement = (fields: Record<string, unknown>) =>
  StockMovement.collection.insertOne({
    organizationId: new Types.ObjectId(key.organizationId),
    productId: new Types.ObjectId(key.productId),
    centerId: new Types.ObjectId(key.centerId),
    createdAt: new Date(),
    ...fields,
  });

describe("1. Allocation des rangs sous concurrence", () => {
  it("12 entrées simultanées reçoivent 12 rangs distincts, contigus, et un solde final exact", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => commit(1)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 12, JSON.stringify(results.filter((r) => r.status === "rejected")));
    const rows = await movements();
    assert.deepEqual(rows.map((m) => m.seq), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.deepEqual(rows.map((m) => m.balanceAfter), Array.from({ length: 12 }, (_, i) => i + 1));
    const report = await verifyLedger(key);
    assert.equal(report.ledgerOk, true, JSON.stringify(report.issues));
    assert.deepEqual(report.tail, { seq: 12, balanceAfter: 12 });
  });

  it("les collisions de rang se produisent réellement (preuve que le test n'est pas vacueux) et sont résorbées par les relances", async () => {
    const proto = StockMovement.prototype as unknown as { save: (...args: unknown[]) => Promise<unknown> };
    const original = proto.save;
    let saves = 0;
    proto.save = function (this: unknown, ...args: unknown[]) {
      saves++;
      return original.apply(this, args);
    };
    try {
      await Promise.all(Array.from({ length: 12 }, () => commit(1)));
    } finally {
      proto.save = original;
    }
    assert.ok(saves > 12, `aucune collision observée (${saves} insertions pour 12 mouvements)`);
    assert.deepEqual((await movements()).map((m) => m.seq), Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("20 sorties simultanées sur un stock de 10 : exactement 10 acceptées, 10 refusées, jamais négatif", async () => {
    await openLevel({ ...key, quantity: 10 });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => commit(-1)));
    const accepted = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.equal(accepted.length, 10);
    assert.equal(refused.length, 10);
    for (const r of refused) {
      assert.ok(r.reason instanceof StockError, String(r.reason));
      assert.equal(r.reason.message, MSG_INSUFFICIENT_STOCK);
    }
    const rows = await movements();
    assert.equal(rows.length, 11); // stock initial + 10 sorties
    assert.ok(rows.every((m) => m.balanceAfter >= 0));
    assert.equal(rows.at(-1)!.balanceAfter, 0);
    assert.equal((await verifyLedger(key)).ledgerOk, true);
  });

  it("des écrivains simultanés sur deux centres distincts ont chacun leur propre suite de rangs", async () => {
    const otherKey = { ...key, centerId: otherCenterId };
    await StockLevel.create({ ...otherKey, alertThreshold: 0 });
    await Promise.all([
      ...Array.from({ length: 5 }, () => commit(1)),
      ...Array.from({ length: 5 }, () => commitMovement({ ...otherKey, kind: "IN", delta: 2 })),
    ]);
    assert.deepEqual((await movements()).map((m) => m.seq), [1, 2, 3, 4, 5]);
    const other = await StockMovement.find(otherKey).sort({ seq: 1 }).lean();
    assert.deepEqual(other.map((m) => m.seq), [1, 2, 3, 4, 5]);
    assert.equal(other.at(-1)!.balanceAfter, 10);
  });
});

describe("9. Soldes successifs et sorties impossibles", () => {
  it("enchaîne entrée, sortie et correction avec des soldes exacts, et refuse la sortie impossible sans rien écrire", async () => {
    await openLevel({ ...key, quantity: 50 });
    await commit(30);
    await commit(-20);
    await commit(-10, "ADJUSTMENT", "Casse");
    assert.deepEqual((await movements()).map((m) => [m.kind, m.delta, m.balanceAfter]), [
      ["OPENING", 50, 50],
      ["IN", 30, 80],
      ["OUT", -20, 60],
      ["ADJUSTMENT", -10, 50],
    ]);
    await assert.rejects(commit(-51), (e: unknown) => e instanceof StockError && e.message === MSG_INSUFFICIENT_STOCK);
    await assert.rejects(commit(-1000, "ADJUSTMENT", "Erreur"), StockError);
    assert.equal((await movements()).length, 4);
    await commit(-50);
    assert.equal((await readTail(key)).balanceAfter, 0);
  });

  it("refuse via le modèle un mouvement incohérent (signe, correction sans note) sans rien enregistrer", async () => {
    await assert.rejects(commitMovement({ ...key, kind: "IN", delta: -5 }));
    await assert.rejects(commitMovement({ ...key, kind: "ADJUSTMENT", delta: 5 }));
    assert.equal((await movements()).length, 0);
  });
});

describe("2 et 8. Idempotence et stock initial", () => {
  it("rejouer le stock initial ne crédite jamais une seconde fois", async () => {
    assert.deepEqual(await openLevel({ ...key, quantity: 40 }), { created: true });
    assert.deepEqual(await openLevel({ ...key, quantity: 40 }), { created: false });
    assert.deepEqual(await openLevel({ ...key, quantity: 999 }), { created: false });
    const rows = await movements();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].kind, rows[0].seq, rows[0].delta], ["OPENING", 1, 40]);
    assert.deepEqual([(await level()).quantity, (await level()).seq], [40, 1]);
  });

  it("6 activations simultanées : un seul mouvement de stock initial", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => openLevel({ ...key, quantity: 25 })));
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal((await movements()).length, 1);
    assert.equal((await level()).quantity, 25);
  });

  it("si une entrée a déjà pris le rang 1, le stock initial n'est pas ajouté", async () => {
    await commitAndProject(7);
    assert.deepEqual(await openLevel({ ...key, quantity: 100 }), { created: false });
    assert.equal((await movements()).length, 1);
    assert.equal((await level()).quantity, 7);
  });

  it("projeter plusieurs fois le même mouvement ne change rien", async () => {
    const m = await commit(9);
    assert.equal(await projectLevel({ ...key, seq: m.seq, balanceAfter: m.balanceAfter }), true);
    assert.equal(await projectLevel({ ...key, seq: m.seq, balanceAfter: m.balanceAfter }), false);
    assert.deepEqual([(await level()).quantity, (await level()).seq], [9, 1]);
  });

  it("répéter la réparation est sans effet", async () => {
    await commit(4);
    assert.equal((await repairLevel(key)).status, "REPAIRED");
    assert.equal((await repairLevel(key)).status, "IN_SYNC");
    assert.equal((await movements()).length, 1);
  });
});

describe("3 et 5. Cohérence journal/projection et reprise après interruption", () => {
  it("après chaque écriture projetée, le journal et le niveau concordent", async () => {
    for (const delta of [10, 5, -3, 20, -12]) await commitAndProject(delta);
    const report = await verifyLedger(key);
    assert.equal(report.ledgerOk, true);
    assert.equal(report.projection, "IN_SYNC");
    assert.deepEqual(report.level, { seq: 5, quantity: 20 });
  });

  it("interruption entre l'insertion et la projection : retard détecté, puis réparé sans nouveau mouvement", async () => {
    await commitAndProject(10);
    await commit(5); // « panne » : le mouvement est validé, la projection n'a pas eu lieu
    const before = await verifyLedger(key);
    assert.equal(before.ledgerOk, true);
    assert.equal(before.projection, "LAGGING");
    assert.deepEqual(before.level, { seq: 1, quantity: 10 });
    assert.deepEqual(before.tail, { seq: 2, balanceAfter: 15 });

    const rowsBefore = JSON.stringify(await movements());
    const repair = await repairLevel(key);
    assert.equal(repair.status, "REPAIRED");
    assert.equal((await verifyLedger(key)).projection, "IN_SYNC");
    assert.deepEqual([(await level()).seq, (await level()).quantity], [2, 15]);
    assert.equal(JSON.stringify(await movements()), rowsBefore); // le journal n'a pas bougé
  });

  it("une écriture suivante part de la fin du JOURNAL (pas de la projection en retard) et répare le niveau", async () => {
    await commit(10); // jamais projeté
    await commit(5); // jamais projeté
    const m = await commit(-3); // calculé sur 15, pas sur la projection (0)
    assert.equal(m.balanceAfter, 12);
    await projectLevel({ ...key, seq: m.seq, balanceAfter: m.balanceAfter });
    assert.deepEqual([(await level()).seq, (await level()).quantity], [3, 12]);
    assert.equal((await verifyLedger(key)).projection, "IN_SYNC");
  });

  it("activation interrompue après le mouvement de stock initial : la relance projette sans créditer deux fois", async () => {
    await rawMovement({ kind: "OPENING", seq: 1, delta: 30, balanceAfter: 30, note: "Stock initial" });
    assert.equal((await level()).quantity, 0); // projection manquante
    assert.deepEqual(await openLevel({ ...key, quantity: 30 }), { created: false });
    assert.deepEqual([(await level()).seq, (await level()).quantity], [1, 30]);
    assert.equal((await movements()).length, 1);
  });

  it("niveau absent : la réparation le signale sans en créer", async () => {
    await StockLevel.deleteMany(key);
    await commit(3);
    assert.equal((await repairLevel(key)).status, "NO_LEVEL");
    assert.equal(await StockLevel.countDocuments(key), 0);
  });
});

describe("4. Monotonie de la projection", () => {
  it("une projection ou une réparation retardée n'écrase pas une projection plus récente", async () => {
    const m1 = await commit(1);
    const m2 = await commit(1);
    const m3 = await commit(1);
    const staleReport = await verifyLedger(key); // rapport pris avant les projections
    assert.equal(await projectLevel({ ...key, seq: m3.seq, balanceAfter: m3.balanceAfter }), true);
    assert.equal(await projectLevel({ ...key, seq: m1.seq, balanceAfter: m1.balanceAfter }), false);
    assert.equal(await projectLevel({ ...key, seq: m2.seq, balanceAfter: m2.balanceAfter }), false);
    assert.equal(await projectLevel({ ...key, ...staleReport.tail }), false);
    assert.deepEqual([(await level()).seq, (await level()).quantity], [3, 3]);
  });
});

describe("7. Convergence de réparations concurrentes", () => {
  it("10 réparations simultanées convergent vers le même état, sans nouveau mouvement", async () => {
    for (let i = 0; i < 5; i++) await commit(2); // aucune projection
    const results = await Promise.all(Array.from({ length: 10 }, () => repairLevel(key)));
    for (const r of results) assert.ok(["REPAIRED", "UNCHANGED", "IN_SYNC"].includes(r.status), r.status);
    assert.ok(results.some((r) => r.status === "REPAIRED"));
    assert.deepEqual([(await level()).seq, (await level()).quantity], [5, 10]);
    assert.equal((await movements()).length, 5);
    assert.equal((await repairLevel(key)).status, "IN_SYNC");
  });

  it("réparations concurrentes pendant de nouvelles écritures : l'état final reste celui du journal", async () => {
    for (let i = 0; i < 3; i++) await commit(1);
    await Promise.all([
      ...Array.from({ length: 6 }, () => repairLevel(key)),
      ...Array.from({ length: 6 }, () => commitAndProject(1)),
    ]);
    await repairLevel(key);
    const report = await verifyLedger(key);
    assert.equal(report.ledgerOk, true, JSON.stringify(report.issues));
    assert.equal(report.projection, "IN_SYNC");
    assert.deepEqual(report.tail, { seq: 9, balanceAfter: 9 });
  });
});

describe("6. Journal incohérent ou corrompu : détection sans réparation du journal", () => {
  const untouched = async (fn: () => Promise<unknown>) => {
    const before = JSON.stringify(await movements());
    const levelBefore = JSON.stringify(await level());
    await fn();
    assert.equal(JSON.stringify(await movements()), before);
    return levelBefore;
  };

  it("détecte un trou de rang et refuse de réparer la projection", async () => {
    await commitAndProject(5);
    await rawMovement({ kind: "IN", seq: 4, delta: 1, balanceAfter: 6 });
    const report = await verifyLedger(key);
    assert.equal(report.ledgerOk, false);
    assert.ok(report.issues.some((i) => i.code === "GAP" && i.seq === 4));
    const levelBefore = await untouched(async () => assert.equal((await repairLevel(key)).status, "LEDGER_INCONSISTENT"));
    assert.equal(JSON.stringify(await level()), levelBefore); // projection non écrasée par un journal douteux
  });

  it("détecte un solde incohérent et un solde négatif", async () => {
    await commitAndProject(5);
    await rawMovement({ kind: "IN", seq: 2, delta: 1, balanceAfter: 99 });
    assert.ok((await verifyLedger(key)).issues.some((i) => i.code === "BALANCE" && i.seq === 2));
    await rawMovement({ kind: "OUT", seq: 3, delta: -200, balanceAfter: -101 });
    const codes = (await verifyLedger(key)).issues.map((i) => i.code);
    assert.ok(codes.includes("NEGATIVE_BALANCE"));
    await untouched(async () => assert.equal((await repairLevel(key)).status, "LEDGER_INCONSISTENT"));
  });

  it("détecte un stock initial hors du rang 1 et une consommation dont le manquant est faux", async () => {
    await commitAndProject(5);
    await rawMovement({ kind: "OPENING", seq: 2, delta: 3, balanceAfter: 8 });
    await rawMovement({ kind: "CONSUMPTION", seq: 3, delta: -2, balanceAfter: 6, requested: 10, shortfall: 1, bookingId: new Types.ObjectId() });
    const codes = (await verifyLedger(key)).issues.map((i) => i.code);
    assert.ok(codes.includes("OPENING_POSITION"));
    assert.ok(codes.includes("CONSUMPTION_MISMATCH"));
  });

  it("projection en avance ou divergente avec un journal sain : réparée par comparaison à l'état observé", async () => {
    await commitAndProject(5);
    await commitAndProject(5);
    await StockLevel.collection.updateOne({ productId: new Types.ObjectId(key.productId), centerId: new Types.ObjectId(key.centerId) }, { $set: { seq: 9, quantity: 99 } });
    assert.equal((await verifyLedger(key)).projection, "AHEAD");
    assert.equal((await repairLevel(key)).status, "REPAIRED");
    assert.deepEqual([(await level()).seq, (await level()).quantity], [2, 10]);

    await StockLevel.collection.updateOne({ productId: new Types.ObjectId(key.productId), centerId: new Types.ObjectId(key.centerId) }, { $set: { quantity: 7 } });
    assert.equal((await verifyLedger(key)).projection, "MISMATCH");
    assert.equal((await repairLevel(key)).status, "REPAIRED");
    assert.equal((await level()).quantity, 10);
  });

  it("un journal vide avec un niveau à zéro est sain", async () => {
    const report = await verifyLedger(key);
    assert.equal(report.ledgerOk, true);
    assert.equal(report.projection, "IN_SYNC");
    assert.equal((await repairLevel(key)).status, "IN_SYNC");
  });
});

describe("10. Isolation entre organisations et centres dans le journal", () => {
  it("un autre centre ou une autre organisation ne voit pas ce journal", async () => {
    await commitAndProject(8);
    assert.deepEqual(await readTail({ ...key, centerId: otherCenterId }), { seq: 0, balanceAfter: 0 });
    assert.deepEqual(await readTail({ ...key, organizationId: String(new Types.ObjectId()) }), { seq: 0, balanceAfter: 0 });
    const foreign = await verifyLedger({ ...key, organizationId: String(new Types.ObjectId()) });
    assert.equal(foreign.count, 0);
    assert.equal(foreign.projection, "NO_LEVEL");
    assert.equal((await repairLevel({ ...key, organizationId: String(new Types.ObjectId()) })).status, "NO_LEVEL");
    assert.equal((await level()).quantity, 8);
  });

  it("projeter avec une autre organisation ne touche pas le niveau", async () => {
    const m = await commit(5);
    assert.equal(await projectLevel({ ...key, organizationId: String(new Types.ObjectId()), seq: m.seq, balanceAfter: m.balanceAfter }), false);
    assert.equal((await level()).quantity, 0);
  });
});

describe("Index uniques : comportement réel dans MongoDB", () => {
  it("deux mouvements de même rang pour un même (produit, centre) sont refusés par la base", async () => {
    await commit(1);
    await assert.rejects(
      new StockMovement({ ...key, kind: "IN", seq: 1, delta: 1, balanceAfter: 2 }).save(),
      (e: unknown) => isDuplicateKey(e, "seq"),
    );
  });

  it("le même rang est permis dans un autre centre", async () => {
    await commit(1);
    await StockMovement.create({ ...key, centerId: otherCenterId, kind: "IN", seq: 1, delta: 1, balanceAfter: 1 });
  });

  it("une seule consommation par (rendez-vous, produit) ; entrées et corrections d'un même RDV restent libres", async () => {
    const bookingId = new Types.ObjectId();
    const consumption = (seq: number) => ({ ...key, kind: "CONSUMPTION" as const, seq, delta: 0, balanceAfter: 0, requested: 5, shortfall: 5, bookingId });
    await StockMovement.create(consumption(1));
    await assert.rejects(StockMovement.create(consumption(2)), (e: unknown) => isDuplicateKey(e) && !isDuplicateKey(e, "seq"));
    await StockMovement.create({ ...key, kind: "ADJUSTMENT", seq: 2, delta: 3, balanceAfter: 3, note: "Correction liée", bookingId });
    // même rendez-vous, autre produit : autorisé
    const other = await StockProduct.create({ organizationId: key.organizationId, name: "Masque", unit: "G" });
    await StockMovement.create({ ...consumption(1), productId: other._id });
  });

  it("un niveau est unique par (produit, centre)", async () => {
    await assert.rejects(StockLevel.create({ ...key, alertThreshold: 1 }), (e: unknown) => isDuplicateKey(e));
  });

  it("le nom d'un produit actif est unique par organisation sans tenir compte de la casse ; un produit archivé libère le nom", async () => {
    await assert.rejects(StockProduct.create({ organizationId: key.organizationId, name: "SHAMPOING", unit: "ML" }), (e: unknown) => isDuplicateKey(e, "name"));
    await StockProduct.create({ organizationId: new Types.ObjectId(), name: "Shampoing", unit: "ML" }); // autre organisation
    await StockProduct.updateOne({ _id: key.productId }, { $set: { active: false } });
    await StockProduct.create({ organizationId: key.organizationId, name: "shampoing", unit: "ML" });
  });

  it("une recette est unique par (service, produit)", async () => {
    const serviceId = new Types.ObjectId();
    await ServiceRecipe.create({ organizationId: key.organizationId, serviceId, productId: key.productId, quantityPerService: 30 });
    await assert.rejects(ServiceRecipe.create({ organizationId: key.organizationId, serviceId, productId: key.productId, quantityPerService: 10 }), (e: unknown) => isDuplicateKey(e));
  });

  it("un mouvement enregistré ne se modifie pas, même par updateOne (champs immuables)", async () => {
    const m = await commit(5);
    await StockMovement.updateOne({ _id: m._id }, { $set: { delta: 99, balanceAfter: 99 } }).catch(() => {});
    const stored = (await StockMovement.findById(m._id).lean())!;
    assert.deepEqual([stored.delta, stored.balanceAfter], [5, 5]);
  });
});

describe("réception d'une ligne de commande : mouvement RECEIPT idempotent", () => {
  const order = () => String(new Types.ObjectId());

  it("crédite une fois ; rejouer renvoie le même mouvement sans recréditer", async () => {
    await openLevel({ ...key, quantity: 100 });
    const purchaseOrderId = order();
    const first = await commitReceipt({ ...key, purchaseOrderId, quantity: 50 });
    const second = await commitReceipt({ ...key, purchaseOrderId, quantity: 50 });
    const third = await commitReceipt({ ...key, purchaseOrderId, quantity: 9999 }); // une quantité différente ne crée rien non plus
    assert.deepEqual([first.created, second.created, third.created], [true, false, false]);
    assert.deepEqual([second.movement.seq, third.movement.balanceAfter], [2, 150]);
    assert.deepEqual((await movements()).map((m) => [m.kind, m.delta, m.balanceAfter]), [["OPENING", 100, 100], ["RECEIPT", 50, 150]]);
    assert.equal((await verifyLedger(key)).ledgerOk, true);
  });

  it("10 appels simultanés pour la même commande : un seul mouvement, un seul crédit", async () => {
    await openLevel({ ...key, quantity: 100 });
    const purchaseOrderId = order();
    const results = await Promise.all(Array.from({ length: 10 }, () => commitReceipt({ ...key, purchaseOrderId, quantity: 50 })));
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(new Set(results.map((r) => r.movement.seq)).size, 1);
    assert.equal((await movements()).length, 2);
    assert.equal((await readTail(key)).balanceAfter, 150);
  });

  it("réceptions de plusieurs commandes et entrées manuelles simultanées : rangs contigus, soldes exacts", async () => {
    await openLevel({ ...key, quantity: 10 });
    const orders = Array.from({ length: 4 }, order);
    await Promise.all([
      ...orders.flatMap((o) => [commitReceipt({ ...key, purchaseOrderId: o, quantity: 5 }), commitReceipt({ ...key, purchaseOrderId: o, quantity: 5 })]),
      ...Array.from({ length: 4 }, () => commit(1)),
    ]);
    const report = await verifyLedger(key);
    assert.equal(report.ledgerOk, true, JSON.stringify(report.issues));
    assert.deepEqual(report.tail, { seq: 9, balanceAfter: 10 + 4 * 5 + 4 });
    assert.equal((await movements()).filter((m) => m.kind === "RECEIPT").length, 4);
  });

  it("interruption entre l'insertion et la projection : niveau en retard, réparé sans nouveau mouvement", async () => {
    await openLevel({ ...key, quantity: 10 });
    await commitReceipt({ ...key, purchaseOrderId: order(), quantity: 5 }); // pas de projectLevel
    assert.equal((await verifyLedger(key)).projection, "LAGGING");
    assert.equal((await repairLevel(key)).status, "REPAIRED");
    assert.deepEqual([(await level()).quantity, (await level()).seq, (await movements()).length], [15, 2, 2]);
  });

  it("isolation : une réception déjà enregistrée dans un autre centre est refusée (incohérence), sans boucle ni nouveau mouvement ; une autre organisation ne voit rien", async () => {
    const purchaseOrderId = order();
    await commitReceipt({ ...key, purchaseOrderId, quantity: 5 });
    await assert.rejects(commitReceipt({ ...key, centerId: otherCenterId, purchaseOrderId, quantity: 5 }), (e: unknown) => e instanceof StockError && e.message === MSG_ORDER_INCONSISTENT);
    assert.equal(await StockMovement.countDocuments({ purchaseOrderId, kind: "RECEIPT" }), 1);
    assert.equal((await readTail({ ...key, organizationId: String(new Types.ObjectId()) })).seq, 0);
  });
});
