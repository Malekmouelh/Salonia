// Module 5 (IA) — Lecture des données de l'analyse de consommation : les chiffres correspondent aux mouvements de la base, comparaison entre
// centres, sorties manuelles (jamais les transferts), aujourd'hui exclu, droits par centre, isolation entre organisations, données de
// démonstration signalées. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { StockMovement } from "@/lib/models/stock";
import { getConsumptionInsights, resolveWindow } from "./insights-data";
import { projectLevel } from "./ledger";
import { MSG_STOCK_FORBIDDEN } from "./scope";
import { SIMULATION_NOTE } from "./simulate-history";
import { activateProductInCenter, createProduct, type StockActor } from "./service";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, type World } from "./test-fixtures";

const NOW = new Date("2030-01-07T09:00:00Z"); // lundi ; la fenêtre de 14 jours couvre « il y a 1 jour » à « il y a 14 jours »
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

type Ev = { ago: number; kind: "CONSUMPTION" | "OUT" | "ADJUSTMENT" | "IN" | "TRANSFER_OUT"; delta: number; booking?: Types.ObjectId; note?: string };
const consume = (ago: number, qty: number, booking = new Types.ObjectId(), note?: string): Ev => ({ ago, kind: "CONSUMPTION", delta: -qty, booking, note });

const product = async (actor: StockActor, name: string) => expectOk(await createProduct(actor, { name, unit: "ML" })).product.id;

// Journal cohérent d'un produit dans un centre : stock initial ancien, puis les événements dans l'ordre du temps, stock final voulu.
async function track(actor: StockActor, orgId: unknown, productId: string, center: { _id: unknown }, events: Ev[], finalStock: number) {
  expectOk(await activateProductInCenter(actor, { productId, centerId: String(center._id), initialQuantity: 0 }));
  const key = { organizationId: orgId, productId, centerId: center._id };
  const sorted = [...events].sort((a, b) => b.ago - a.ago);
  let balance = finalStock - sorted.reduce((s, e) => s + e.delta, 0);
  assert.ok(balance > 0, "stock initial calculé invalide");
  const docs: Record<string, unknown>[] = [{ ...key, kind: "OPENING", seq: 1, delta: balance, balanceAfter: balance, createdAt: at(60) }];
  for (const e of sorted) {
    balance += e.delta;
    docs.push({
      ...key,
      kind: e.kind,
      seq: docs.length + 1,
      delta: e.delta,
      balanceAfter: balance,
      createdAt: at(e.ago),
      ...(e.kind === "CONSUMPTION" ? { requested: -e.delta, shortfall: 0, bookingId: e.booking } : {}),
      ...(e.kind === "TRANSFER_OUT" ? { transferId: new Types.ObjectId() } : {}),
      ...(e.kind === "ADJUSTMENT" ? { note: e.note ?? "Correction" } : e.note ? { note: e.note } : {}),
    });
  }
  assert.equal(balance, finalStock);
  await StockMovement.insertMany(docs, { ordered: true });
  await projectLevel({ organizationId: String(orgId), productId, centerId: String(center._id), seq: docs.length, balanceAfter: balance });
}

const report = async (actor = w.ownerA(), days?: unknown) => expectOk(await getConsumptionInsights(actor, days, NOW)).report;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i); // « il y a » from … to jours

describe("les chiffres viennent du journal", () => {
  it("consommation par fenêtre, rendez-vous distincts, sorties manuelles (sans transferts, sans entrées), aujourd'hui exclu", async () => {
    const shampoo = await product(w.ownerA(), "Shampoing");
    const dye = await product(w.ownerA(), "Colorant");
    const bookings = Object.fromEntries(range(0, 28).map((d) => [d, new Types.ObjectId()]));
    // Shampoing à Tunis : 10 par jour sur les 14 derniers jours (140), 5 par jour sur les 14 précédents (70), un rendez-vous par jour.
    const events: Ev[] = [
      ...range(1, 14).map((d) => consume(d, 10, bookings[d])),
      ...range(15, 28).map((d) => consume(d, 5, bookings[d])),
      consume(0, 1000, bookings[0]), // aujourd'hui : exclu
      { ago: 3, kind: "OUT", delta: -30 },
      { ago: 4, kind: "ADJUSTMENT", delta: -10 },
      { ago: 5, kind: "ADJUSTMENT", delta: 5 }, // correction positive : pas une perte
      { ago: 6, kind: "IN", delta: 500 }, // entrée : pas une perte
      { ago: 7, kind: "TRANSFER_OUT", delta: -50 }, // transfert : jamais une perte
    ];
    await track(w.ownerA(), w.orgA._id, shampoo, w.a1, events, 2000);
    // Le colorant partage les mêmes rendez-vous : l'activité du centre est comptée une seule fois par rendez-vous.
    await track(w.ownerA(), w.orgA._id, dye, w.a1, range(1, 14).map((d) => consume(d, 2, bookings[d])), 300);

    const r = await report(w.ownerA(), 14);
    const row = r.products.find((p) => p.name === "Shampoing")!;
    assert.deepEqual([row.current, row.previous, row.changePct], [140, 70, 100]);
    assert.equal(r.products.find((p) => p.name === "Colorant")!.current, 28);
    const tunis = r.centers.find((c) => c.name === "Tunis")!;
    assert.deepEqual([tunis.appointments, tunis.previousAppointments], [14, 14]); // un par jour, malgré deux produits par rendez-vous

    const losses = r.findings.find((f) => f.type === "LOSSES" && f.productId === shampoo)!;
    assert.deepEqual([losses.metrics.manualOut, losses.metrics.consumption, losses.metrics.sharePct], [40, 140, 22]); // 30 + 10 ; ni +5, ni 500, ni 50
    assert.ok(r.findings.some((f) => f.type === "TREND_UP" && f.productId === shampoo && f.metrics.changePct === 100));
    assert.equal(r.windowDays, 14);
  });

  it("compare les centres PAR rendez-vous : le plus gros centre n'est pas celui qui consomme trop", async () => {
    const shampoo = await product(w.ownerA(), "Shampoing");
    // Tunis : 4 rendez-vous par jour de 5 ml (20/jour) ; Sousse : 1 de 10 ml (10/jour) ; Djerba : 2 de 5 ml (10/jour). Par rendez-vous : 5, 10, 5.
    const perDay = (per: number, qty: number) => range(1, 28).flatMap((d) => Array.from({ length: per }, () => consume(d, qty)));
    await track(w.ownerA(), w.orgA._id, shampoo, w.a1, perDay(4, 5), 5000);
    await track(w.ownerA(), w.orgA._id, shampoo, w.a2, perDay(1, 10), 5000);
    await track(w.ownerA(), w.orgA._id, shampoo, w.a3, perDay(2, 5), 5000);

    const r = await report(w.ownerA(), 14);
    const outliers = r.findings.filter((f) => f.type === "CENTER_OUTLIER");
    assert.deepEqual(outliers.map((f) => [f.centerId, f.severity, f.metrics.normalizedBy, f.metrics.aboveOthersPct]), [[id(w.a2), "HIGH", "APPOINTMENTS", 100]]);
    assert.deepEqual(Object.fromEntries(r.centers.map((c) => [c.name, [c.appointments, c.intensityIndex]])), { Tunis: [56, 75], Sousse: [14, 150], Djerba: [28, 75] });
    // Le volume brut, lui, est bien le plus élevé à Tunis (280 contre 140) : l'écart n'est pas masqué dans le tableau.
    assert.deepEqual(r.products[0].centers.map((c) => [c.centerId, c.current, c.sharePct]), [[id(w.a1), 280, 50], [id(w.a2), 140, 25], [id(w.a3), 140, 25]]);
  });

  it("signale un risque de rupture (prévision) et un stock sans consommation sans rien inventer", async () => {
    const gel = await product(w.ownerA(), "Gel");
    expectOk(await activateProductInCenter(w.ownerA(), { productId: gel, centerId: id(w.a1), alertThreshold: 100, initialQuantity: 50 }));
    const r = await report();
    const risk = r.findings.find((f) => f.type === "RUPTURE_RISK")!;
    assert.deepEqual([risk.severity, risk.metrics.stock, risk.metrics.forecastAvailable], ["MEDIUM", 50, false]); // sous le seuil mais pas d'historique : pas de date inventée, donc pas « prioritaire »
    assert.equal(r.findings.length, 1);
  });

  it("données de démonstration : leur part est mesurée sur la fenêtre", async () => {
    const shampoo = await product(w.ownerA(), "Shampoing");
    await track(w.ownerA(), w.orgA._id, shampoo, w.a1, [...range(1, 10).map((d) => consume(d, 5)), ...range(11, 20).map((d) => consume(d, 5, undefined, SIMULATION_NOTE))], 1000);
    const r = await report(w.ownerA(), 14);
    assert.deepEqual([r.quality.totalMovements, r.quality.simulatedMovements, r.quality.simulatedSharePct], [20, 10, 50]);
    assert.ok(r.quality.historyDays >= 19);
  });
});

describe("droits, isolation, cas limites", () => {
  async function twoCenters() {
    const shampoo = await product(w.ownerA(), "Shampoing");
    await track(w.ownerA(), w.orgA._id, shampoo, w.a1, range(1, 28).map((d) => consume(d, 10)), 1000);
    await track(w.ownerA(), w.orgA._id, shampoo, w.a2, range(1, 28).map((d) => consume(d, 20)), 1000);
    return shampoo;
  }

  it("un gérant ne voit que ses centres ; le propriétaire voit tous les siens", async () => {
    await twoCenters();
    const owner = await report(w.ownerA(), 14);
    assert.deepEqual(owner.centers.map((c) => c.name).sort(), ["Djerba", "Sousse", "Tunis"]);
    assert.deepEqual(owner.products[0].centers.map((c) => c.current).sort(), [140, 280]);
    const manager = await report(w.managerA(w.a1), 14);
    assert.deepEqual(manager.centers.map((c) => c.name), ["Tunis"]);
    assert.deepEqual(manager.products[0].centers.map((c) => [c.centerId, c.current]), [[id(w.a1), 140]]); // jamais les 280 de Sousse
    assert.equal(manager.quality.comparable, false);
  });

  it("une autre organisation ne voit rien, et ne contamine rien", async () => {
    await twoCenters();
    const other = await report(w.ownerB(), 14);
    assert.deepEqual([other.products, other.findings, other.centers.map((c) => c.name)], [[], [], ["Sfax"]]);
  });

  it("refuse les rôles sans droit sur le stock", async () => {
    for (const [, actor] of forbiddenActors(w)) expectFail(await getConsumptionInsights(actor, 14, NOW), MSG_STOCK_FORBIDDEN);
  });

  it("aucun produit : rapport vide mais valide", async () => {
    const r = await report();
    assert.deepEqual([r.products, r.findings, r.quality.historyDays], [[], [], 0]);
    assert.equal(r.centers.length, 3);
  });

  it("la durée vient du client : seule une durée proposée est acceptée", () => {
    assert.deepEqual([14, 28, 42, 7, 999, "28", null, undefined].map(resolveWindow), [14, 28, 42, 28, 28, 28, 28, 28]);
  });
});
