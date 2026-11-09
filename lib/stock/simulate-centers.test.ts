// Module 5 (IA) — Scénario de démonstration multi-centres : déterministe, cohérent (journal exact), et qui fait bien ressortir de l'analyse
// ce pour quoi il a été conçu (comparaison équitable, pic, tendance, pertes, stock dormant, transfert). Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { StockMovement } from "@/lib/models/stock";
import { getConsumptionInsights } from "./insights-data";
import { verifyLedger } from "./ledger";
import { activateProductInCenter, createProduct } from "./service";
import { DEMO_SCENARIO, planScenario, writeScenario } from "./simulate-centers";
import { SIMULATION_NOTE } from "./simulate-history";
import { expectOk, id, makeWorld, type World } from "./test-fixtures";

const NOW = new Date("2030-01-07T09:00:00Z");
const DAYS = 84;

describe("plan du scénario", () => {
  const plan = planScenario(DEMO_SCENARIO, DAYS, NOW);
  const pair = (center: string, product: string) => plan.pairs.find((p) => p.center === center && p.product === product)!;
  const consumption = (center: string, product: string, from: number, to: number) =>
    pair(center, product).events.filter((e) => e.kind === "CONSUMPTION" && e.daysAgo >= from && e.daysAgo <= to).reduce((s, e) => s + e.quantity, 0);

  it("est déterministe : le même scénario donne les mêmes mouvements", () => {
    assert.deepEqual(planScenario(DEMO_SCENARIO, DAYS, NOW), plan);
  });

  it("un rendez-vous consomme plusieurs produits de son centre (identifiant partagé), jamais ceux d'un autre centre", () => {
    const byBooking = new Map<number, Set<string>>();
    for (const p of plan.pairs) for (const e of p.events) if (e.booking !== null) byBooking.set(e.booking, new Set([...(byBooking.get(e.booking) ?? []), `${p.center}:${p.product}`]));
    assert.ok([...byBooking.values()].some((s) => s.size >= 3));
    for (const set of byBooking.values()) assert.equal(new Set([...set].map((k) => k.split(":")[0])).size, 1);
    assert.deepEqual(Object.keys(plan.bookingsByCenter), ["tunis", "sousse", "djerba"]);
    assert.ok(plan.bookingsByCenter.tunis > plan.bookingsByCenter.sousse && plan.bookingsByCenter.sousse > plan.bookingsByCenter.djerba);
  });

  it("stock initial = tout ce qui sort + le stock final voulu ; quantités entières positives", () => {
    for (const p of plan.pairs) {
      assert.equal(p.opening, p.events.reduce((s, e) => s + e.quantity, 0) + p.finalStock);
      assert.ok(p.events.every((e) => Number.isInteger(e.quantity) && e.quantity >= 1));
    }
  });

  it("reproduit les situations voulues : dose plus forte, pic récent, arrêt de consommation, sorties manuelles, hausse", () => {
    const averageDose = (center: string, product: string) => {
      const events = pair(center, product).events.filter((e) => e.kind === "CONSUMPTION");
      return events.reduce((s, e) => s + e.quantity, 0) / events.length;
    };
    assert.ok(averageDose("sousse", "color") > 1.6 * averageDose("tunis", "color")); // dosage : 70 contre 40
    assert.ok(consumption("sousse", "developer", 1, 7) > 1.6 * (consumption("sousse", "developer", 8, 28) / 3)); // pic de la dernière semaine
    assert.equal(consumption("djerba", "shampoo", 1, 30), 0); // plus rien depuis un mois
    assert.ok(consumption("djerba", "shampoo", 31, 56) > 0);
    const out = pair("sousse", "gloves").events.filter((e) => e.kind === "OUT").reduce((s, e) => s + e.quantity, 0);
    const consumed = consumption("sousse", "gloves", 1, 28);
    assert.ok(Math.abs(out / consumed - 0.4) < 0.05, `part des sorties ${out / consumed}`);
    assert.equal(pair("tunis", "gloves").events.filter((e) => e.kind === "OUT").length, 0);
    assert.ok(consumption("tunis", "spray", 1, 28) > 1.4 * consumption("tunis", "spray", 29, 56)); // hausse
  });
});

describe("écriture et analyse du scénario", () => {
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

  it("écrit un journal exact (notes de simulation, rendez-vous fictifs) que l'analyse lit : chaque situation voulue ressort", async () => {
    const centers: Record<string, string> = { tunis: id(w.a1), sousse: id(w.a2), djerba: id(w.a3) };
    const products: Record<string, string> = {};
    for (const p of DEMO_SCENARIO.products) {
      products[p.key] = expectOk(await createProduct(w.ownerA(), { name: p.name, unit: p.unit })).product.id;
      for (const centerKey of Object.keys(centers)) expectOk(await activateProductInCenter(w.ownerA(), { productId: products[p.key], centerId: centers[centerKey], alertThreshold: p.threshold, initialQuantity: 0 }));
    }
    const plan = planScenario(DEMO_SCENARIO, DAYS, NOW);
    const key = (center: string, product: string) => ({ organizationId: id(w.orgA), productId: products[product], centerId: centers[center] });
    const written = await writeScenario(plan, key);
    assert.equal(written.pairs, 18);

    for (const p of plan.pairs) {
      const report = await verifyLedger(key(p.center, p.product));
      assert.deepEqual(report.issues, [], `${p.center}:${p.product}`);
    }
    assert.equal(await StockMovement.countDocuments({ note: { $ne: SIMULATION_NOTE } }), 0); // tout est signalé comme simulation

    const r = expectOk(await getConsumptionInsights(w.ownerA(), 28, NOW)).report;
    const find = (type: string, product: string, center: string) => r.findings.find((f) => f.type === type && f.productId === products[product] && f.centerId === centers[center]);

    const dosage = find("CENTER_OUTLIER", "color", "sousse")!;
    assert.deepEqual([dosage.severity, dosage.metrics.normalizedBy], ["HIGH", "APPOINTMENTS"]); // Sousse, pas Tunis, malgré le volume de Tunis
    assert.equal(find("CENTER_OUTLIER", "color", "tunis"), undefined);
    assert.equal(find("SPIKE", "developer", "sousse")?.severity, "HIGH");
    assert.ok(find("DORMANT", "shampoo", "djerba"));
    const transfer = r.findings.find((f) => f.type === "IMBALANCE" && f.productId === products.shampoo)!;
    assert.deepEqual([transfer.centerId, transfer.otherCenterId], [centers.tunis, centers.djerba]);
    assert.equal(find("LOSSES", "gloves", "sousse")?.severity, "HIGH");
    assert.ok(find("TREND_UP", "spray", "tunis") ?? find("SPIKE", "spray", "tunis"));
    assert.ok(find("RUPTURE_RISK", "shampoo", "tunis"));

    // Activité et comparaison : Tunis est le plus gros centre ; les trois centres sont comparables.
    const appointments = Object.fromEntries(r.centers.map((c) => [c.name, c.appointments]));
    assert.ok(appointments.Tunis > appointments.Sousse && appointments.Sousse > appointments.Djerba);
    assert.equal(r.quality.simulatedSharePct, 100);
    // Produit rarement utilisé : la lotion est le produit le moins consommé de son unité.
    const ml = r.products.filter((p) => p.unit === "ML");
    assert.equal(ml[ml.length - 1].productId, products.tonic);
  });
});
