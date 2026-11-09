// Module 5 (IA) — Historique simulé : plan déterministe, écriture limitée au produit visé, journal cohérent, refus sur de vrais mouvements,
// annulation. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Booking } from "@/lib/models/booking";
import { PurchaseOrder, StockLevel, StockMovement, Supplier } from "@/lib/models/stock";
import { addDaysToKey } from "./forecast";
import { getStockForecast } from "./forecast-data";
import { verifyLedger } from "./ledger";
import { SIMULATION_NOTE, SimulationError, applySimulation, assertSimulationTarget, planHistory, undoSimulation } from "./simulate-history";
import { activateProductInCenter, createProduct, recordStockMovement } from "./service";
import { expectOk, id, makeWorld, type World } from "./test-fixtures";

const NOW = new Date("2030-01-07T09:00:00Z"); // lundi
const TODAY = "2030-01-07";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  w = await makeWorld(db);
});

async function freshProduct(name = "[Démo] Shampoing", center = w.a1, threshold = 100) {
  const product = expectOk(await createProduct(w.ownerA(), { name, unit: "ML" })).product;
  expectOk(await activateProductInCenter(w.ownerA(), { productId: product.id, centerId: id(center), alertThreshold: threshold, initialQuantity: 0 }));
  return { productId: product.id, key: { organizationId: id(w.orgA), productId: product.id, centerId: id(center) } };
}

describe("plan", () => {
  it("est déterministe, finit exactement au stock demandé, et le samedi consomme plus que le lundi", () => {
    const a = planHistory({ perDay: 70, days: 56, stock: 300, now: NOW });
    const b = planHistory({ perDay: 70, days: 56, stock: 300, now: NOW });
    assert.deepEqual(a, b);
    assert.equal(a.days.length, 56);
    assert.equal(a.opening - a.total, 300);
    const byWeekday = (weekday: number) => a.days.filter((d) => d.at.getUTCDay() === weekday).reduce((s, d) => s + d.quantity, 0);
    assert.ok(byWeekday(6) > 2 * byWeekday(1)); // samedi (1,8) contre lundi (0,6) : environ trois fois plus
  });

  it("--flat donne exactement la même quantité chaque jour", () => {
    const plan = planHistory({ perDay: 70, days: 28, stock: 0, flat: true, now: NOW });
    assert.deepEqual([...new Set(plan.days.map((d) => d.quantity))], [70]);
    assert.equal(plan.total, 70 * 28);
  });

  it("les dates sont des jours civils distincts, du plus ancien à hier ; le stock initial est antérieur", () => {
    const plan = planHistory({ perDay: 10, days: 14, stock: 5, now: NOW });
    const keys = plan.days.map((d) => d.at.toISOString().slice(0, 10));
    assert.deepEqual([keys[0], keys.at(-1)], [addDaysToKey(TODAY, -14), addDaysToKey(TODAY, -1)]);
    assert.equal(new Set(keys).size, 14);
    assert.ok(plan.openingAt < plan.days[0].at);
  });

  it("refuse les valeurs invalides ou trop grandes", () => {
    for (const bad of [{ perDay: 0 }, { perDay: 1.5 }, { perDay: -3 }, { days: 13 }, { days: 121 }, { stock: -1 }, { stock: 2.5 }, { perDay: 9_999_999 }]) {
      assert.throws(() => planHistory({ perDay: 70, days: 56, stock: 300, now: NOW, ...bad }), SimulationError, JSON.stringify(bad));
    }
  });
});

describe("écriture", () => {
  it("écrit un journal complet et cohérent, projette le niveau au stock demandé, et la prévision le reconnaît", async () => {
    const { key } = await freshProduct();
    const plan = planHistory({ perDay: 70, days: 56, stock: 300, flat: true, now: NOW });
    const result = await applySimulation(key, plan);
    assert.deepEqual([result.movements, result.stock, result.issues], [57, 300, []]);
    assert.equal((await StockMovement.countDocuments({ ...key, note: SIMULATION_NOTE })), 57);
    const level = (await StockLevel.findOne(key).lean())!;
    assert.deepEqual([level.quantity, level.seq, level.alertThreshold], [300, 57, 100]); // le seuil choisi dans l'application est conservé
    assert.deepEqual((await verifyLedger(key)).issues, []);

    const [row] = expectOk(await getStockForecast(w.ownerA(), undefined, NOW)).rows;
    assert.deepEqual([row.status, row.weeksOfData, row.dailyRate, row.stock], ["OK", 8, 70, 300]);
  });

  it("n'écrit rien en dehors du produit visé : autre produit, autre centre, rendez-vous, commandes, fournisseurs", async () => {
    const target = await freshProduct("[Démo] Cible", w.a1);
    const other = await freshProduct("[Démo] Autre", w.a1);
    const otherCenter = await freshProduct("[Démo] Ailleurs", w.a2);
    const before = [await Booking.countDocuments(), await PurchaseOrder.countDocuments(), await Supplier.countDocuments()];
    await applySimulation(target.key, planHistory({ perDay: 20, days: 28, stock: 50, now: NOW }));
    assert.equal(await StockMovement.countDocuments(other.key), 0);
    assert.equal(await StockMovement.countDocuments(otherCenter.key), 0);
    assert.equal((await StockLevel.findOne(other.key).lean())!.quantity, 0);
    assert.deepEqual([await Booking.countDocuments(), await PurchaseOrder.countDocuments(), await Supplier.countDocuments()], before);
    assert.equal(await StockMovement.countDocuments({ bookingId: { $exists: true }, productId: { $ne: new Types.ObjectId(target.productId) } }), 0);
  });

  it("refuse un produit non activé dans le centre", async () => {
    const product = expectOk(await createProduct(w.ownerA(), { name: "Pas activé", unit: "ML" })).product;
    const key = { organizationId: id(w.orgA), productId: product.id, centerId: id(w.a1) };
    await assert.rejects(applySimulation(key, planHistory({ perDay: 10, days: 14, stock: 0, now: NOW })), /pas activé/);
    assert.equal(await StockMovement.countDocuments(), 0);
  });

  it("refuse un produit qui a déjà de vrais mouvements (stock initial à l'activation ou mouvement manuel) et ne modifie rien", async () => {
    const real = expectOk(await createProduct(w.ownerA(), { name: "Réel", unit: "ML" })).product;
    expectOk(await activateProductInCenter(w.ownerA(), { productId: real.id, centerId: id(w.a1), initialQuantity: 500 }));
    const key = { organizationId: id(w.orgA), productId: real.id, centerId: id(w.a1) };
    await assert.rejects(applySimulation(key, planHistory({ perDay: 10, days: 14, stock: 0, now: NOW })), /déjà des mouvements/);
    assert.equal(await StockMovement.countDocuments(key), 1);
    assert.equal((await StockLevel.findOne(key).lean())!.quantity, 500);

    const manual = await freshProduct("Manuel");
    expectOk(await recordStockMovement(w.ownerA(), { productId: manual.productId, centerId: id(w.a1), kind: "IN", quantity: 10 }));
    await assert.rejects(applySimulation(manual.key, planHistory({ perDay: 10, days: 14, stock: 0, now: NOW })), /déjà des mouvements/);
  });

  it("les contrôles préalables (utilisés par --dry-run) acceptent un produit neuf et refusent les autres, sans rien écrire", async () => {
    const fresh = await freshProduct("Neuf");
    await assertSimulationTarget(fresh.key);
    const used = await freshProduct("Utilisé");
    expectOk(await recordStockMovement(w.ownerA(), { productId: used.productId, centerId: id(w.a1), kind: "IN", quantity: 10 }));
    await assert.rejects(assertSimulationTarget(used.key), /déjà des mouvements/);
    const notActivated = expectOk(await createProduct(w.ownerA(), { name: "Non activé", unit: "ML" })).product;
    await assert.rejects(assertSimulationTarget({ ...fresh.key, productId: notActivated.id }), /pas activé/);
    assert.equal(await StockMovement.countDocuments(fresh.key), 0);
  });

  it("un second lancement est refusé : pas de doublon", async () => {
    const { key } = await freshProduct();
    const plan = planHistory({ perDay: 10, days: 14, stock: 5, now: NOW });
    await applySimulation(key, plan);
    await assert.rejects(applySimulation(key, plan), /déjà des mouvements/);
    assert.equal(await StockMovement.countDocuments(key), 15);
  });
});

describe("annulation", () => {
  it("retire toute la simulation, remet le niveau à zéro (seuil conservé), et permet de recommencer avec d'autres valeurs", async () => {
    const { key } = await freshProduct();
    await applySimulation(key, planHistory({ perDay: 70, days: 56, stock: 300, now: NOW }));
    assert.deepEqual(await undoSimulation(key), { removed: 57 });
    assert.equal(await StockMovement.countDocuments(key), 0);
    const level = (await StockLevel.findOne(key).lean())!;
    assert.deepEqual([level.quantity, level.seq, level.alertThreshold], [0, 0, 100]);
    const again = await applySimulation(key, planHistory({ perDay: 30, days: 28, stock: 900, flat: true, now: NOW }));
    assert.deepEqual([again.movements, again.stock, again.issues], [29, 900, []]);
  });

  it("refuse s'il n'y a rien à retirer, et refuse (sans rien supprimer) dès qu'un vrai mouvement existe", async () => {
    const { key, productId } = await freshProduct();
    await assert.rejects(undoSimulation(key), /Aucune simulation/);
    await applySimulation(key, planHistory({ perDay: 10, days: 14, stock: 100, now: NOW }));
    expectOk(await recordStockMovement(w.ownerA(), { productId, centerId: id(w.a1), kind: "OUT", quantity: 5 })); // un vrai mouvement après la simulation
    await assert.rejects(undoSimulation(key), /vrais mouvements/);
    assert.equal(await StockMovement.countDocuments(key), 16);
  });
});
