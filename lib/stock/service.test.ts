// Module 5 (étape 3) — Services de stock : droits, périmètre multi-centres, isolation entre organisations, produits,
// activation par centre, mouvements manuels, lecture et réparation. Base MongoDB éphémère en mémoire
// (lib/booking/test-support.ts, inchangé). Les actions serveur ne sont pas encore créées : seuls les services sont testés.
// Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { createCenter, createOrg, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { Role } from "@/lib/enums";
import { Equipment, ServiceRecipe, StockLevel, StockMovement, StockProduct } from "@/lib/models/stock";
import { MSG_INSUFFICIENT_STOCK } from "./errors";
import { commitMovement } from "./ledger";
import {
  activateProductInCenter,
  archiveProduct,
  createProduct,
  listProducts,
  listStockLevels,
  recordStockMovement,
  repairStockLevels,
  updateAlertThreshold,
  updateProduct,
  type StockActor,
  type StockFailure,
  type StockResult,
} from "./service";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN } from "./scope";

let db: TestDb;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

type Org = Awaited<ReturnType<typeof createOrg>>;
type Center = Awaited<ReturnType<typeof createCenter>>;
let orgA: Org, orgB: Org;
let a1: Center, a2: Center, a3: Center, b1: Center;
let centersA: Center[], centersB: Center[];

beforeEach(async () => {
  await resetTestDb(db);
  await Promise.all([Equipment, StockProduct, StockLevel, ServiceRecipe, StockMovement].map((m) => m.syncIndexes()));
  orgA = await createOrg("Salon A");
  orgB = await createOrg("Salon B");
  a1 = await createCenter(orgA._id, "Tunis");
  a2 = await createCenter(orgA._id, "Sousse");
  a3 = await createCenter(orgA._id, "Djerba");
  b1 = await createCenter(orgB._id, "Sfax");
  centersA = [a1, a2, a3];
  centersB = [b1];
});

function actor(role: Role, org: Org | null, assigned: Center[] = []): StockActor {
  const centers = org === orgA ? centersA : org === orgB ? centersB : [];
  return {
    id: String(new Types.ObjectId()),
    role,
    centerIds: assigned.map((c) => String(c._id)),
    organization: org ? { id: String(org._id), name: org.name, slug: org.slug, centers: centers.map((c) => ({ id: String(c._id), name: c.name, governorate: "TUNIS" as const })) } : null,
  };
}
const ownerA = () => actor("OWNER", orgA);
const managerA = (...centers: Center[]) => actor("MANAGER", orgA, centers);
const ownerB = () => actor("OWNER", orgB);
const id = (doc: { _id: unknown }) => String(doc._id);

function expectOk<T>(result: StockResult<T>) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as Extract<StockResult<T>, { ok: true }>;
}
function expectFail<T>(result: StockResult<T>, message?: string) {
  assert.equal(result.ok, false, "une réussite était inattendue");
  const failure = result as StockFailure;
  if (message) assert.equal(failure.message, message);
  return failure;
}

async function product(owner = ownerA(), name = "Shampoing", unit: "PIECE" | "ML" | "G" = "ML") {
  return expectOk(await createProduct(owner, { name, unit })).product;
}
async function activate(who: StockActor, productId: string, center: Center, extra: Record<string, unknown> = {}) {
  return activateProductInCenter(who, { productId, centerId: id(center), alertThreshold: 20, initialQuantity: 50, ...extra });
}
const ledger = (productId: string, center: Center, org: Org = orgA) => StockMovement.find({ organizationId: org._id, productId, centerId: center._id }).sort({ seq: 1 }).lean();
const levelDoc = (productId: string, center: Center, org: Org = orgA) => StockLevel.findOne({ organizationId: org._id, productId, centerId: center._id }).lean();

const FORBIDDEN_ACTORS: [string, () => StockActor][] = [
  ["STAFF", () => actor("STAFF", orgA, [a1])],
  ["CLIENT", () => actor("CLIENT", orgA, [a1])],
  ["SUPER_ADMIN", () => actor("SUPER_ADMIN", orgA, [a1])],
  ["OWNER sans organisation", () => actor("OWNER", null)],
  ["MANAGER sans organisation", () => actor("MANAGER", null)],
];

describe("droits : tout service refuse STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation", () => {
  it("aucune lecture, écriture ni réparation n'est possible, et rien n'est écrit", async () => {
    const p = await product();
    await activate(ownerA(), p.id, a1);
    const before = [await StockProduct.countDocuments(), await StockLevel.countDocuments(), await StockMovement.countDocuments()];
    for (const [label, make] of FORBIDDEN_ACTORS) {
      const who = make();
      const calls: [string, Promise<StockResult<unknown>>][] = [
        ["createProduct", createProduct(who, { name: "X", unit: "G" })],
        ["updateProduct", updateProduct(who, { productId: p.id, name: "Y" })],
        ["archiveProduct", archiveProduct(who, { productId: p.id })],
        ["listProducts", listProducts(who)],
        ["activateProductInCenter", activate(who, p.id, a1)],
        ["updateAlertThreshold", updateAlertThreshold(who, { productId: p.id, centerId: id(a1), alertThreshold: 1 })],
        ["recordStockMovement", recordStockMovement(who, { productId: p.id, centerId: id(a1), kind: "IN", quantity: 5 })],
        ["listStockLevels", listStockLevels(who)],
        ["repairStockLevels", repairStockLevels(who, [{ productId: p.id, centerId: id(a1) }])],
      ];
      for (const [name, call] of calls) assert.equal(expectFail(await call, MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, `${label} : ${name}`);
      assert.ok(calls.length === 9, `${label} : tous les services sont couverts`);
    }
    assert.deepEqual([await StockProduct.countDocuments(), await StockLevel.countDocuments(), await StockMovement.countDocuments()], before);
  });

  it("le gérant ne crée, ne modifie ni n'archive une définition de produit", async () => {
    const p = await product();
    const manager = managerA(a1);
    expectFail(await createProduct(manager, { name: "Gel", unit: "ML" }), MSG_STOCK_FORBIDDEN);
    expectFail(await updateProduct(manager, { productId: p.id, name: "Autre" }), MSG_STOCK_FORBIDDEN);
    expectFail(await archiveProduct(manager, { productId: p.id }), MSG_STOCK_FORBIDDEN);
    assert.equal((await StockProduct.findById(p.id).lean())!.name, "Shampoing");
    expectOk(await listProducts(manager)); // lecture des définitions : permise
  });
});

describe("définitions de produits (OWNER)", () => {
  it("crée un produit dans l'organisation de l'acteur ; une organisation fournie par le client est ignorée", async () => {
    const result = expectOk(await createProduct(ownerA(), { name: "  Gel coiffant ", unit: "G", organizationId: id(orgB), active: false }));
    assert.deepEqual([result.product.name, result.product.unit, result.product.active], ["Gel coiffant", "G", true]);
    assert.equal(String((await StockProduct.findById(result.product.id).lean())!.organizationId), id(orgA));
  });

  it("refuse une unité hors liste, un nom vide ou trop long, des types incorrects", async () => {
    expectFail(await createProduct(ownerA(), { name: "X", unit: "L" }));
    expectFail(await createProduct(ownerA(), { name: "   ", unit: "ML" }));
    expectFail(await createProduct(ownerA(), { name: "x".repeat(81), unit: "ML" }));
    expectFail(await createProduct(ownerA(), null));
    expectFail(await createProduct(ownerA(), { name: { $ne: "" }, unit: "ML" }));
    assert.equal(await StockProduct.countDocuments(), 0);
  });

  it("le nom est unique parmi les produits actifs de l'organisation (insensible à la casse), pas entre organisations", async () => {
    await product(ownerA(), "Shampoing");
    const dup = expectFail(await createProduct(ownerA(), { name: "SHAMPOING", unit: "ML" }));
    assert.ok(dup.errors?.name?.length);
    expectOk(await createProduct(ownerB(), { name: "Shampoing", unit: "ML" }));
  });

  it("renomme ; refuse un nom déjà pris ; un produit d'une autre organisation ou inexistant est « introuvable »", async () => {
    const a = await product(ownerA(), "Shampoing");
    await product(ownerA(), "Masque", "G");
    assert.equal(expectOk(await updateProduct(ownerA(), { productId: a.id, name: "Shampoing doux" })).product.name, "Shampoing doux");
    assert.ok(expectFail(await updateProduct(ownerA(), { productId: a.id, name: "masque" })).errors?.name);
    const foreign = await product(ownerB(), "Produit B");
    for (const productId of [foreign.id, id({ _id: new Types.ObjectId() })]) {
      expectFail(await updateProduct(ownerA(), { productId, name: "Piraté" }), "Produit introuvable.");
      expectFail(await archiveProduct(ownerA(), { productId }), "Produit introuvable.");
    }
    expectFail(await updateProduct(ownerA(), { productId: "pas-un-id", name: "x" }));
    expectFail(await updateProduct(ownerA(), { productId: a.id }));
    assert.equal((await StockProduct.findById(foreign.id).lean())!.name, "Produit B");
  });

  it("l'unité est modifiable tant qu'aucun mouvement n'existe, puis verrouillée", async () => {
    const p = await product(ownerA(), "Gel", "ML");
    assert.equal(expectOk(await updateProduct(ownerA(), { productId: p.id, unit: "G" })).product.unit, "G");
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 10 }));
    expectFail(await updateProduct(ownerA(), { productId: p.id, unit: "PIECE" }), "L'unité ne peut plus changer : des mouvements existent.");
    assert.equal((await StockProduct.findById(p.id).lean())!.unit, "G");
    expectOk(await updateProduct(ownerA(), { productId: p.id, name: "Gel fixant", unit: "G" })); // même unité : permis
  });

  it("l'archivage conserve niveaux et mouvements, bloque l'activation et les mouvements, libère le nom, et est idempotent", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1));
    expectOk(await archiveProduct(ownerA(), { productId: p.id }));
    expectOk(await archiveProduct(ownerA(), { productId: p.id }));
    assert.equal((await StockProduct.findById(p.id).lean())!.active, false);
    assert.equal(await StockLevel.countDocuments({ productId: p.id }), 1);
    assert.equal((await ledger(p.id, a1)).length, 1);
    expectFail(await activate(ownerA(), p.id, a2), "Ce produit est archivé.");
    expectFail(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "IN", quantity: 5 }), "Ce produit est archivé.");
    expectFail(await updateProduct(ownerA(), { productId: p.id, name: "x" }), "Ce produit est archivé.");
    expectOk(await createProduct(ownerA(), { name: "Shampoing", unit: "ML" })); // le nom est de nouveau libre
    const list = expectOk(await listProducts(ownerA())).products;
    assert.equal(list.filter((x) => x.name === "Shampoing").length, 2);
  });
});

describe("8. Activation d'un produit dans un centre (OWNER et MANAGER)", () => {
  it("un gérant active un produit dans son centre : niveau, seuil et mouvement OPENING au rang 1", async () => {
    const p = await product();
    const result = expectOk(await activate(managerA(a1), p.id, a1, { alertThreshold: 20, initialQuantity: 50 }));
    assert.deepEqual([result.levelCreated, result.initialStock], [true, "RECORDED"]);
    assert.deepEqual(result.level, { productId: p.id, centerId: id(a1), alertThreshold: 20, quantity: 50, seq: 1 });
    const rows = await ledger(p.id, a1);
    assert.deepEqual(rows.map((m) => [m.kind, m.seq, m.delta, m.balanceAfter]), [["OPENING", 1, 50, 50]]);
  });

  it("sans stock initial : niveau à zéro, aucun mouvement", async () => {
    const p = await product();
    const result = expectOk(await activate(managerA(a1), p.id, a1, { initialQuantity: 0 }));
    assert.equal(result.initialStock, "NONE");
    assert.equal(result.level.quantity, 0);
    assert.equal((await ledger(p.id, a1)).length, 0);
  });

  it("réactiver un produit déjà activé ne crédite pas une deuxième fois et ne change pas le seuil", async () => {
    const p = await product();
    expectOk(await activate(managerA(a1), p.id, a1));
    const again = expectOk(await activate(managerA(a1), p.id, a1, { alertThreshold: 999, initialQuantity: 50 }));
    assert.deepEqual([again.levelCreated, again.initialStock], [false, "ALREADY_RECORDED"]);
    assert.deepEqual([again.level.quantity, again.level.alertThreshold, again.level.seq], [50, 20, 1]);
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 500 }));
    assert.equal((await ledger(p.id, a1)).length, 1);
    assert.equal((await levelDoc(p.id, a1))!.quantity, 50);
  });

  it("5 activations simultanées : un niveau, un seul stock initial", async () => {
    const p = await product();
    const results = await Promise.all(Array.from({ length: 5 }, () => activate(managerA(a1), p.id, a1)));
    const oks = results.map((r) => expectOk(r));
    assert.equal(oks.filter((r) => r.initialStock === "RECORDED").length, 1);
    assert.equal(await StockLevel.countDocuments({ productId: p.id, centerId: a1._id }), 1);
    assert.equal((await ledger(p.id, a1)).length, 1);
    assert.equal((await levelDoc(p.id, a1))!.quantity, 50);
  });

  it("reprise après interruption : niveau sans mouvement initial, puis mouvement sans projection", async () => {
    const p = await product();
    await StockLevel.create({ organizationId: orgA._id, productId: p.id, centerId: a1._id, alertThreshold: 20 }); // niveau créé, rien d'autre
    assert.equal(expectOk(await activate(managerA(a1), p.id, a1)).initialStock, "RECORDED");
    assert.equal((await levelDoc(p.id, a1))!.quantity, 50);

    const q = await product(ownerA(), "Masque", "G");
    await StockLevel.create({ organizationId: orgA._id, productId: q.id, centerId: a1._id, alertThreshold: 5 });
    await StockMovement.create({ organizationId: orgA._id, productId: q.id, centerId: a1._id, kind: "OPENING", seq: 1, delta: 50, balanceAfter: 50, note: "Stock initial" });
    const resumed = expectOk(await activate(managerA(a1), q.id, a1));
    assert.equal(resumed.initialStock, "ALREADY_RECORDED");
    assert.deepEqual([resumed.level.quantity, resumed.level.seq], [50, 1]);
    assert.equal((await ledger(q.id, a1)).length, 1);
  });

  it("10. refuse un centre hors périmètre, d'une autre organisation, inexistant ou mal formé : même message, rien d'écrit", async () => {
    const p = await product();
    const manager = managerA(a1);
    const badCenters: unknown[] = [id(a2), id(b1), id({ _id: new Types.ObjectId() }), "pas-un-id", "", { $ne: "" }, undefined, null];
    for (const centerId of badCenters) {
      expectFail(await activateProductInCenter(manager, { productId: p.id, centerId, initialQuantity: 10 }), MSG_STOCK_CENTER_NOT_FOUND);
    }
    expectFail(await activateProductInCenter(ownerA(), { productId: p.id, centerId: id(b1), initialQuantity: 10 }), MSG_STOCK_CENTER_NOT_FOUND);
    assert.equal(await StockLevel.countDocuments(), 0);
    assert.equal(await StockMovement.countDocuments(), 0);
  });

  it("10. un produit d'une autre organisation ou inexistant est « introuvable » ; une organisation fournie par le client est ignorée", async () => {
    const foreign = await product(ownerB(), "Produit B");
    expectFail(await activate(ownerA(), foreign.id, a1), "Produit introuvable.");
    expectFail(await activate(ownerA(), id({ _id: new Types.ObjectId() }), a1), "Produit introuvable.");
    expectFail(await activate(ownerA(), "n'importe quoi", a1));
    const mine = await product();
    expectOk(await activate(ownerA(), mine.id, a1, { organizationId: id(orgB) }));
    assert.equal(String((await levelDoc(mine.id, a1))!.organizationId), id(orgA));
    assert.equal(await StockLevel.countDocuments({ organizationId: orgB._id }), 0);
  });

  it("refuse un seuil ou un stock initial négatif, décimal ou absurde, sans rien créer", async () => {
    const p = await product();
    for (const extra of [{ alertThreshold: -1 }, { alertThreshold: 1.5 }, { initialQuantity: -5 }, { initialQuantity: 2.5 }, { initialQuantity: 2_000_000_000 }, { initialQuantity: "10" }]) {
      expectFail(await activate(ownerA(), p.id, a1, extra));
    }
    assert.equal(await StockLevel.countDocuments(), 0);
  });

  it("le propriétaire active dans n'importe quel centre de son organisation, jamais dans une autre", async () => {
    const p = await product();
    for (const center of [a1, a2, a3]) expectOk(await activate(ownerA(), p.id, center));
    assert.equal(await StockLevel.countDocuments({ productId: p.id }), 3);
  });
});

describe("mouvements manuels", () => {
  it("entrée, sortie et correction : soldes exacts, niveau projeté, mouvement signé", async () => {
    const p = await product();
    expectOk(await activate(managerA(a1), p.id, a1, { initialQuantity: 50 }));
    const who = managerA(a1);
    const input = (extra: Record<string, unknown>) => ({ productId: p.id, centerId: id(a1), ...extra });
    assert.equal(expectOk(await recordStockMovement(who, input({ kind: "IN", quantity: 30 }))).movement.balanceAfter, 80);
    assert.equal(expectOk(await recordStockMovement(who, input({ kind: "OUT", quantity: 20, note: " Atelier " }))).movement.delta, -20);
    const fix = expectOk(await recordStockMovement(who, input({ kind: "ADJUSTMENT", quantity: -10, note: "Casse" })));
    assert.deepEqual([fix.movement.balanceAfter, fix.projectionPending], [50, false]);
    assert.deepEqual([(await levelDoc(p.id, a1))!.quantity, (await levelDoc(p.id, a1))!.seq], [50, 4]);
    const rows = await ledger(p.id, a1);
    assert.deepEqual(rows.map((m) => m.kind), ["OPENING", "IN", "OUT", "ADJUSTMENT"]);
    assert.equal(rows[2].note, "Atelier");
    assert.ok(rows.slice(1).every((m) => String(m.createdBy) === who.id)); // l'acteur est tracé sur chaque mouvement manuel
  });

  it("9. refuse une sortie ou une correction impossible : état inchangé", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 10 }));
    expectFail(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "OUT", quantity: 11 }), MSG_INSUFFICIENT_STOCK);
    expectFail(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "ADJUSTMENT", quantity: -11, note: "x" }), MSG_INSUFFICIENT_STOCK);
    assert.equal((await ledger(p.id, a1)).length, 1);
    assert.equal((await levelDoc(p.id, a1))!.quantity, 10);
    expectOk(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "OUT", quantity: 10 })); // jusqu'à zéro
    assert.equal((await levelDoc(p.id, a1))!.quantity, 0);
  });

  it("valide la forme : quantité entière et signée selon le type, note de correction obligatoire, types connus", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1));
    const bad: Record<string, unknown>[] = [
      { kind: "IN", quantity: 0 },
      { kind: "IN", quantity: -5 },
      { kind: "OUT", quantity: -5 },
      { kind: "IN", quantity: 1.5 },
      { kind: "IN", quantity: "5" },
      { kind: "ADJUSTMENT", quantity: 0, note: "x" },
      { kind: "ADJUSTMENT", quantity: 5 },
      { kind: "ADJUSTMENT", quantity: 5, note: "   " },
      { kind: "IN", quantity: 5, note: "x".repeat(121) },
      { kind: "CONSUMPTION", quantity: 5 },
      { kind: "OPENING", quantity: 5 },
      { quantity: 5 },
    ];
    for (const extra of bad) expectFail(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), ...extra }), undefined);
    assert.equal((await ledger(p.id, a1)).length, 1); // seulement le stock initial
  });

  it("10. centre hors périmètre / étranger / inexistant, produit étranger, niveau non activé : refus sans écriture", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1));
    const manager = managerA(a1);
    for (const centerId of [id(a2), id(b1), id({ _id: new Types.ObjectId() }), "x", { $ne: "" }]) {
      expectFail(await recordStockMovement(manager, { productId: p.id, centerId, kind: "IN", quantity: 5 }), MSG_STOCK_CENTER_NOT_FOUND);
    }
    expectFail(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a2), kind: "IN", quantity: 5 }), "Ce produit n'est pas activé dans ce centre.");
    const foreign = await product(ownerB(), "Produit B");
    expectFail(await recordStockMovement(ownerA(), { productId: foreign.id, centerId: id(a1), kind: "IN", quantity: 5 }), "Produit introuvable.");
    expectFail(await recordStockMovement(ownerB(), { productId: p.id, centerId: id(b1), kind: "IN", quantity: 5 }), "Produit introuvable.");
    assert.equal(await StockMovement.countDocuments(), 1);
  });

  it("des mouvements simultanés via le service gardent des rangs contigus et un niveau juste", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 5 }));
    const results = await Promise.all(Array.from({ length: 8 }, () => recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "IN", quantity: 2 })));
    results.forEach((r) => expectOk(r));
    assert.deepEqual((await ledger(p.id, a1)).map((m) => m.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const row = expectOk(await listStockLevels(ownerA())).levels[0];
    assert.deepEqual([row.quantity, row.needsRepair], [21, false]);
  });

  it("ignore les champs inconnus ou réservés au serveur (rang, delta, solde, organisation, auteur, type de consommation)", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 10 }));
    const intruder = { seq: 99, delta: 1000, balanceAfter: 5000, organizationId: id(orgB), createdBy: "pirate", bookingId: id({ _id: new Types.ObjectId() }), requested: 7, shortfall: 3, _id: id({ _id: new Types.ObjectId() }) };
    const result = expectOk(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "IN", quantity: 4, ...intruder }));
    assert.deepEqual([result.movement.seq, result.movement.delta, result.movement.balanceAfter], [2, 4, 14]);
    const stored = (await ledger(p.id, a1)).at(-1)!;
    assert.equal(String(stored.organizationId), id(orgA));
    assert.ok(!stored.bookingId && stored.requested == null && stored.shortfall == null);
    assert.notEqual(String(stored.createdBy), "pirate");
    assert.equal(await StockMovement.countDocuments({ organizationId: orgB._id }), 0);
  });

  it("LIMITE DOCUMENTÉE : sans clé de requête (absente du schéma approuvé), un double envoi crée deux mouvements", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 0 }));
    const input = { productId: p.id, centerId: id(a1), kind: "IN", quantity: 5 };
    expectOk(await recordStockMovement(ownerA(), input));
    expectOk(await recordStockMovement(ownerA(), input));
    assert.equal((await levelDoc(p.id, a1))!.quantity, 10);
  });
});

describe("seuil d'alerte", () => {
  it("un gérant modifie le seuil dans son centre seulement ; valeurs invalides et niveau non activé refusés", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1));
    expectOk(await activate(ownerA(), p.id, a2));
    assert.equal(expectOk(await updateAlertThreshold(managerA(a1), { productId: p.id, centerId: id(a1), alertThreshold: 5 })).level.alertThreshold, 5);
    expectFail(await updateAlertThreshold(managerA(a1), { productId: p.id, centerId: id(a2), alertThreshold: 5 }), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await updateAlertThreshold(managerA(a1), { productId: p.id, centerId: id(a1), alertThreshold: -1 }));
    expectFail(await updateAlertThreshold(managerA(a1, a3), { productId: p.id, centerId: id(a3), alertThreshold: 5 }), "Ce produit n'est pas activé dans ce centre.");
    assert.equal((await levelDoc(p.id, a2))!.alertThreshold, 20);
    assert.equal((await levelDoc(p.id, a1))!.quantity, 50); // la quantité n'est pas touchée
  });
});

describe("lecture des niveaux et alerte de stock bas", () => {
  it("le propriétaire voit tous ses centres, le gérant les siens, personne ne voit une autre organisation", async () => {
    const p = await product();
    for (const center of [a1, a2, a3]) expectOk(await activate(ownerA(), p.id, center));
    const pb = await product(ownerB(), "Produit B");
    expectOk(await activate(ownerB(), pb.id, b1));

    assert.deepEqual(expectOk(await listStockLevels(ownerA())).levels.map((l) => l.centerId).sort(), [id(a1), id(a2), id(a3)].sort());
    assert.deepEqual(expectOk(await listStockLevels(managerA(a1, a3))).levels.map((l) => l.centerId).sort(), [id(a1), id(a3)].sort());
    assert.deepEqual(expectOk(await listStockLevels(managerA())).levels, []);
    assert.deepEqual(expectOk(await listStockLevels(ownerB())).levels.map((l) => l.productName), ["Produit B"]);
    assert.equal(expectOk(await listStockLevels(managerA(a1, a3), id(a3))).levels.length, 1);
  });

  it("refuse un centre demandé hors périmètre, étranger ou inexistant (jamais ignoré)", async () => {
    for (const requested of [id(a2), id(b1), id({ _id: new Types.ObjectId() }), "", { $ne: "" }]) {
      expectFail(await listStockLevels(managerA(a1), requested), MSG_STOCK_CENTER_NOT_FOUND);
    }
    expectFail(await listStockLevels(ownerA(), id(b1)), MSG_STOCK_CENTER_NOT_FOUND);
  });

  it("alerte AU seuil (quantité <= seuil), pas au-dessus", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { alertThreshold: 20, initialQuantity: 21 }));
    const low = async () => expectOk(await listStockLevels(ownerA())).levels[0].lowStock;
    assert.equal(await low(), false);
    expectOk(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "OUT", quantity: 1 }));
    assert.equal(await low(), true); // 20 <= 20
    expectOk(await recordStockMovement(ownerA(), { productId: p.id, centerId: id(a1), kind: "OUT", quantity: 20 }));
    assert.equal(await low(), true); // 0 <= 20
  });

  it("affiche la quantité du journal et signale une projection en retard ; un produit archivé reste lisible", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 10 }));
    await commitMovement({ organizationId: id(orgA), productId: p.id, centerId: id(a1), kind: "IN", delta: 5 }); // sans projection
    const row = expectOk(await listStockLevels(ownerA())).levels[0];
    assert.deepEqual([row.quantity, row.projectedQuantity, row.needsRepair], [15, 10, true]);
    expectOk(await archiveProduct(ownerA(), { productId: p.id }));
    assert.equal(expectOk(await listStockLevels(ownerA())).levels[0].productActive, false);
  });

  it("ne renvoie aucun identifiant d'organisation", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1));
    assert.ok(!JSON.stringify(expectOk(await listStockLevels(ownerA()))).includes(id(orgA)));
  });
});

describe("réparation à la demande (D10)", () => {
  it("répare les projections en retard, ignore les éléments hors périmètre ou invalides, ne crée aucun mouvement", async () => {
    const p = await product();
    expectOk(await activate(ownerA(), p.id, a1, { initialQuantity: 10 }));
    expectOk(await activate(ownerA(), p.id, a2, { initialQuantity: 10 }));
    for (const center of [a1, a2]) await commitMovement({ organizationId: id(orgA), productId: p.id, centerId: id(center), kind: "IN", delta: 5 });
    const movementsBefore = await StockMovement.countDocuments();

    const manager = managerA(a1);
    const result = expectOk(
      await repairStockLevels(manager, [
        { productId: p.id, centerId: id(a1) },
        { productId: p.id, centerId: id(a1) }, // doublon
        { productId: p.id, centerId: id(a2) }, // hors périmètre
        { productId: p.id, centerId: id(b1) }, // autre organisation
        { productId: "pas-un-id", centerId: id(a1) },
        { productId: p.id, centerId: { $ne: "" } },
        null,
      ]),
    );
    assert.deepEqual(result.repaired, [{ productId: p.id, centerId: id(a1), status: "REPAIRED" }]);
    assert.equal(result.skipped, 6); // doublon, centre hors périmètre, centre étranger, produit mal formé, centre en objet, null
    assert.equal((await levelDoc(p.id, a1))!.quantity, 15);
    assert.equal((await levelDoc(p.id, a2))!.quantity, 10); // non touché : hors périmètre du gérant
    assert.equal(await StockMovement.countDocuments(), movementsBefore);
    assert.equal(expectOk(await repairStockLevels(manager, [{ productId: p.id, centerId: id(a1) }])).repaired[0].status, "IN_SYNC");
  });

  it("n'a aucun effet sur les données d'une autre organisation, même avec leurs identifiants", async () => {
    const pb = await product(ownerB(), "Produit B");
    expectOk(await activate(ownerB(), pb.id, b1, { initialQuantity: 10 }));
    await commitMovement({ organizationId: id(orgB), productId: pb.id, centerId: id(b1), kind: "IN", delta: 5 });
    const result = expectOk(await repairStockLevels(ownerA(), [{ productId: pb.id, centerId: id(b1) }]));
    assert.equal(result.skipped, 1);
    assert.equal((await levelDoc(pb.id, b1, orgB))!.quantity, 10); // toujours en retard : non réparé par un acteur étranger
  });

  it("une entrée qui n'est pas une liste ne fait rien", async () => {
    assert.deepEqual(expectOk(await repairStockLevels(ownerA(), { productId: "x" })), { ok: true, repaired: [], skipped: 0 });
  });
});
