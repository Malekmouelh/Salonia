// Module 5 (IA) — Lecture des données de la prévision : demande réelle (manque compris), niveau du journal, commandes en cours, délai du
// fournisseur habituel, droits par centre et isolation entre organisations. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { PurchaseOrder, StockMovement } from "@/lib/models/stock";
import { addDaysToKey } from "./forecast";
import { getStockForecast } from "./forecast-data";
import { projectLevel } from "./ledger";
import { MSG_STOCK_FORBIDDEN } from "./scope";
import { activateProductInCenter, createProduct } from "./service";
import { createSupplier } from "./suppliers";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, type World } from "./test-fixtures";

const NOW = new Date("2030-01-07T09:00:00Z"); // lundi
const TODAY = "2030-01-07";
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY + 3_600_000); // 10 h UTC : même jour civil à Tunis

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

// Fabrique l'historique d'un produit dans un centre : stock initial il y a `openedDaysAgo` jours, puis une consommation par jour sur les
// `days` derniers jours (demandé / appliqué), puis une sortie manuelle qui ramène le stock à `finalStock`.
async function history(opts: { name?: string; center?: typeof w.a1; openedDaysAgo?: number; days?: number; requested?: number; applied?: number; finalStock?: number; supplierId?: string }) {
  const { name = "Shampoing", center = w.a1, openedDaysAgo = 60, days = 56, requested = 70, applied = requested, finalStock = 300, supplierId } = opts;
  const product = expectOk(await createProduct(w.ownerA(), { name, unit: "ML", supplierId })).product;
  expectOk(await activateProductInCenter(w.ownerA(), { productId: product.id, centerId: id(center), initialQuantity: 0 }));
  const key = { organizationId: w.orgA._id, productId: product.id, centerId: center._id };
  let seq = 1;
  let balance = 100_000;
  await StockMovement.create({ ...key, kind: "OPENING", seq: seq++, delta: balance, balanceAfter: balance, createdAt: at(openedDaysAgo) });
  for (let d = days; d >= 1; d--) {
    balance -= applied;
    await StockMovement.create({ ...key, kind: "CONSUMPTION", seq: seq++, delta: -applied, balanceAfter: balance, requested, shortfall: requested - applied, bookingId: new Types.ObjectId(), createdAt: at(d) });
  }
  await StockMovement.create({ ...key, kind: "OUT", seq: seq++, delta: finalStock - balance, balanceAfter: finalStock, createdAt: at(0) });
  await projectLevel({ organizationId: id(w.orgA), productId: product.id, centerId: id(center), seq: seq - 1, balanceAfter: finalStock });
  return product.id;
}

const rows = async (actor = w.ownerA(), center?: string) => expectOk(await getStockForecast(actor, center, NOW)).rows;

describe("lecture de la prévision", () => {
  it("reconstruit le rythme à partir des consommations, le stock depuis le journal, et date la rupture", async () => {
    const productId = await history({});
    const [row] = await rows();
    assert.equal(row.productId, productId);
    assert.deepEqual([row.status, row.weeksOfData, row.dailyRate, row.weeklyRate, row.stock], ["OK", 8, 70, 490, 300]);
    assert.deepEqual([row.daysLeft, row.ruptureDate], [5, addDaysToKey(TODAY, 5)]);
    assert.deepEqual([row.supplierId, row.leadDays, row.orderBy], [null, null, null]); // pas de fournisseur habituel
  });

  it("la demande est la quantité DEMANDÉE par les recettes : un manque (stock à zéro) reste de la demande", async () => {
    await history({ requested: 70, applied: 50 });
    const [row] = await rows();
    assert.equal(row.dailyRate, 70); // et non 50
  });

  it("le fournisseur habituel donne le délai ; les commandes passées (pas les brouillons) sont déduites de la quantité", async () => {
    const supplier = expectOk(await createSupplier(w.ownerA(), { name: "Distri", leadTimeDays: 7 })).supplier;
    const productId = await history({ supplierId: supplier.id });
    const line = { productId, productName: "Shampoing", unit: "ML" as const, quantity: 300 };
    await PurchaseOrder.create({ organizationId: w.orgA._id, centerId: w.a1._id, supplierId: supplier.id, supplierName: "Distri", status: "ORDERED", lines: [line] });
    await PurchaseOrder.create({ organizationId: w.orgA._id, centerId: w.a1._id, supplierId: supplier.id, supplierName: "Distri", status: "DRAFT", lines: [{ ...line, quantity: 9000 }] });
    const [row] = await rows();
    assert.deepEqual([row.supplierId, row.supplierName, row.leadDays, row.onOrder], [supplier.id, "Distri", 7, 300]);
    assert.equal(row.breakBeforeDelivery, true); // rupture dans 5 jours, délai 7
    assert.equal(row.suggestedQuantity, 70 * 14 - 300 - 300); // 380 : rythme x (délai + cycle) - stock - commandé
    assert.equal(row.urgency, "URGENT");
  });

  it("ne devine pas quand l'historique est trop court", async () => {
    await history({ openedDaysAgo: 8, days: 7 });
    const [row] = await rows();
    assert.deepEqual([row.status, row.suggestedQuantity, row.ruptureDate], ["NO_DATA", 0, null]);
  });

  it("un produit activé depuis longtemps mais jamais consommé : aucune rupture annoncée", async () => {
    await history({ days: 0, finalStock: 500 }); // seulement le stock initial et une sortie manuelle
    const [row] = await rows();
    assert.deepEqual([row.status, row.ruptureDate, row.suggestedQuantity], ["NO_CONSUMPTION", null, 0]);
  });

  it("les produits les plus urgents viennent en premier", async () => {
    await history({ name: "Abondant", finalStock: 50_000 });
    await history({ name: "Critique", finalStock: 10 });
    assert.deepEqual((await rows()).map((r) => r.productName), ["Critique", "Abondant"]);
  });
});

describe("droits et isolation", () => {
  it("le gérant ne voit que ses centres ; le propriétaire tous ; un centre hors périmètre est refusé", async () => {
    await history({ name: "Tunis", center: w.a1 });
    await history({ name: "Sousse", center: w.a2 });
    assert.deepEqual((await rows(w.ownerA())).map((r) => r.productName).sort(), ["Sousse", "Tunis"]);
    assert.deepEqual((await rows(w.managerA(w.a1))).map((r) => r.productName), ["Tunis"]);
    assert.deepEqual((await rows(w.ownerA(), id(w.a2))).map((r) => r.productName), ["Sousse"]);
    expectFail(await getStockForecast(w.managerA(w.a1), id(w.a2), NOW), "Centre introuvable.");
  });

  it("une autre organisation ne voit rien ; STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation sont refusés", async () => {
    await history({});
    assert.deepEqual(await rows(w.ownerB()), []);
    for (const [label, who] of forbiddenActors(w)) assert.equal(expectFail(await getStockForecast(who, undefined, NOW), MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, label);
  });
});
