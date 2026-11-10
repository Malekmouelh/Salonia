// Module 5 (IA) — Analyse de la consommation entre centres : calculs purs (comparaison équitable, pic, tendance, pertes, stock immobilisé,
// déséquilibre, données insuffisantes). Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInsights, type InsightsInput, type PairInput, type Finding } from "./insights";

const W = 28;
const flat = (previous: number, current: number) => [...Array<number>(W).fill(previous), ...Array<number>(W).fill(current)];
const input = (over: Partial<InsightsInput> = {}): InsightsInput => ({
  todayKey: "2030-01-07",
  windowDays: W,
  centers: [
    { id: "c1", name: "Tunis" },
    { id: "c2", name: "Sousse" },
    { id: "c3", name: "Djerba" },
  ],
  products: [{ id: "p1", name: "Shampoing", unit: "ML" }],
  pairs: [],
  appointments: {},
  risks: [],
  quality: { simulatedMovements: 0, totalMovements: 0, historyDays: 84 },
  ...over,
});
const pair = (centerId: string, daily: number[], stock = 500, manualOut = 0, productId = "p1"): PairInput => ({ productId, centerId, stock, alertThreshold: 0, daily, manualOut });
const of = (findings: Finding[], type: Finding["type"]) => findings.filter((f) => f.type === type);

describe("comparaison entre centres : équitable", () => {
  // Tunis consomme le double de Sousse par jour (100 contre 50) mais Sousse consomme le double PAR RENDEZ-VOUS (20 contre 10).
  const data = () =>
    input({
      pairs: [pair("c1", flat(100, 100)), pair("c2", flat(50, 50)), pair("c3", flat(40, 40))],
      appointments: { c1: { current: 280, previous: 280 }, c2: { current: 70, previous: 70 }, c3: { current: 112, previous: 112 } },
    });

  it("signale le centre qui consomme plus PAR RENDEZ-VOUS, pas le plus gros centre", () => {
    const report = buildInsights(data());
    const outliers = of(report.findings, "CENTER_OUTLIER");
    assert.deepEqual(outliers.map((f) => f.centerId), ["c2"]);
    assert.equal(outliers[0].severity, "HIGH");
    assert.deepEqual([outliers[0].metrics.normalizedBy, outliers[0].metrics.aboveOthersPct, outliers[0].metrics.intensity, outliers[0].metrics.peerIntensity], ["APPOINTMENTS", 100, 2000, 1000]); // pour 100 rendez-vous
  });

  it("repasse en comparaison par jour quand un centre n'a aucun rendez-vous mesuré", () => {
    const report = buildInsights({ ...data(), appointments: { c1: { current: 280, previous: 280 }, c2: { current: 70, previous: 70 } } });
    const outliers = of(report.findings, "CENTER_OUTLIER");
    assert.deepEqual(outliers.map((f) => [f.centerId, f.metrics.normalizedBy]), [["c1", "DAYS"]]);
  });

  it("indice d'intensité par centre : 100 = moyenne des centres comparés", () => {
    const report = buildInsights(data());
    const index = Object.fromEntries(report.centers.map((c) => [c.name, c.intensityIndex]));
    assert.deepEqual(index, { Tunis: 75, Sousse: 150, Djerba: 75 }); // par rendez-vous : 10, 20 et 10 ; moyenne 13,3 donc 75 %, 150 % et 75 %
    assert.equal(report.centers.find((c) => c.name === "Sousse")!.comparedProducts, 1);
  });

  it("un seul centre : rien à comparer", () => {
    const report = buildInsights(input({ centers: [{ id: "c1", name: "Tunis" }], pairs: [pair("c1", flat(10, 10))], appointments: { c1: { current: 28, previous: 28 } } }));
    assert.equal(report.quality.comparable, false);
    assert.equal(of(report.findings, "CENTER_OUTLIER").length, 0);
    assert.equal(report.centers[0].intensityIndex, null);
  });
});

describe("pic, tendance, pertes, stock immobilisé", () => {
  it("pic de la dernière semaine (et pas de tendance en double)", () => {
    const current = [...Array<number>(21).fill(10), ...Array<number>(7).fill(30)];
    const report = buildInsights(input({ pairs: [pair("c1", [...Array<number>(W).fill(10), ...current])] }));
    const spike = of(report.findings, "SPIKE");
    assert.equal(spike.length, 1);
    assert.deepEqual([spike[0].severity, spike[0].metrics.lastWeek, spike[0].metrics.usualWeek, spike[0].metrics.aboveUsualPct], ["HIGH", 210, 70, 200]);
    assert.equal(of(report.findings, "TREND_UP").length, 0);
  });

  it("tendance à la hausse (faible puis forte) et à la baisse", () => {
    const up = buildInsights(input({ pairs: [pair("c1", flat(10, 15))] })); // +50 %
    assert.deepEqual(of(up.findings, "TREND_UP").map((f) => [f.severity, f.metrics.changePct]), [["LOW", 50]]);
    const strong = buildInsights(input({ pairs: [pair("c1", flat(10, 16))] })); // +60 %
    assert.equal(of(strong.findings, "TREND_UP")[0].severity, "MEDIUM");
    const down = buildInsights(input({ pairs: [pair("c1", flat(10, 5))] }));
    assert.deepEqual(of(down.findings, "TREND_DOWN").map((f) => f.metrics.changePct), [-50]);
    assert.equal(buildInsights(input({ pairs: [pair("c1", flat(10, 11))] })).findings.length, 0); // +10 % : rien
  });

  it("sorties manuelles : part dans consommation + sorties, jamais sous le seuil", () => {
    const high = buildInsights(input({ pairs: [pair("c1", flat(10, 10), 500, 100)] })); // 100 / (280 + 100) = 26 %
    assert.deepEqual(of(high.findings, "LOSSES").map((f) => [f.severity, f.metrics.sharePct]), [["HIGH", 26]]);
    const low = buildInsights(input({ pairs: [pair("c1", flat(10, 10), 500, 20)] })); // 6 %
    assert.equal(of(low.findings, "LOSSES").length, 0);
  });

  it("stock immobilisé : du stock, plus de consommation, alors qu'il y en avait", () => {
    const report = buildInsights(input({ pairs: [pair("c1", flat(10, 0), 500)] }));
    assert.deepEqual(of(report.findings, "DORMANT").map((f) => [f.metrics.stock, f.metrics.previous]), [[500, 280]]);
    assert.equal(of(buildInsights(input({ pairs: [pair("c1", flat(10, 0), 0)] })).findings, "DORMANT").length, 0); // plus de stock : rien d'immobilisé
    assert.equal(of(buildInsights(input({ pairs: [pair("c1", flat(0, 0), 500)] })).findings, "DORMANT").length, 0); // jamais consommé
  });
});

describe("déséquilibre entre centres", () => {
  it("propose de transférer le stock d'un centre qui n'en a plus l'usage vers un centre presque à court, jusqu'à 30 jours de couverture", () => {
    const report = buildInsights(input({ pairs: [pair("c1", flat(70, 70), 300), pair("c3", flat(10, 0), 2000), pair("c2", flat(10, 10), 900)] }));
    const [imbalance] = of(report.findings, "IMBALANCE");
    assert.deepEqual([imbalance.centerId, imbalance.otherCenterId], ["c1", "c3"]); // le plus gros excédent d'abord (Djerba : 2000, contre 600 à Sousse)
    assert.deepEqual([imbalance.metrics.quantity, imbalance.metrics.receiverCoverDays, imbalance.metrics.senderCoverDays], [1800, 4, null]); // 70 × 30 − 300
  });

  it("la quantité proposée ne dépasse jamais ce que le centre source peut céder", () => {
    const report = buildInsights(input({ pairs: [pair("c1", flat(70, 70), 300), pair("c3", flat(10, 0), 500)] }));
    assert.equal(of(report.findings, "IMBALANCE")[0].metrics.quantity, 500);
  });

  it("aucun déséquilibre sans centre source, ni quand la couverture est suffisante", () => {
    assert.equal(of(buildInsights(input({ pairs: [pair("c1", flat(70, 70), 300), pair("c2", flat(70, 70), 300)] })).findings, "IMBALANCE").length, 0);
    assert.equal(of(buildInsights(input({ pairs: [pair("c1", flat(10, 10), 600), pair("c3", flat(10, 0), 2000)] })).findings, "IMBALANCE").length, 0); // 60 jours de couverture
  });
});

describe("risque de rupture, données insuffisantes, rangement", () => {
  const risk = (urgency: "URGENT" | "SOON" | "OK") => ({ productId: "p1", centerId: "c1", urgency, status: "OK" as const, stock: 50, daysLeft: 3, leadDays: 5, breakBeforeDelivery: true, suggestedQuantity: 400 });

  it("reprend la prévision (urgent = grave, bientôt = moyen, ok = rien)", () => {
    const f = (u: "URGENT" | "SOON" | "OK") => buildInsights(input({ risks: [risk(u)] })).findings;
    assert.deepEqual(f("URGENT").map((x) => [x.type, x.severity, x.metrics.daysLeft, x.metrics.suggestedQuantity]), [["RUPTURE_RISK", "HIGH", 3, 400]]);
    assert.equal(f("SOON")[0].severity, "MEDIUM");
    assert.equal(f("OK").length, 0);
  });

  it("trop peu de jours de consommation : aucune conclusion", () => {
    const sparse = [...Array<number>(W * 2 - 2).fill(0), 90, 90];
    const report = buildInsights(input({ pairs: [pair("c1", sparse), pair("c2", sparse)], appointments: { c1: { current: 2, previous: 0 }, c2: { current: 2, previous: 0 } } }));
    assert.deepEqual(report.findings, []);
    assert.equal(report.products[0].current, 360); // les chiffres (180 par centre), eux, restent affichés
  });

  it("une série trop courte est complétée par des zéros ; produits et centres inconnus ignorés", () => {
    const report = buildInsights(input({ pairs: [pair("c1", [5, 5, 5]), pair("ailleurs", flat(1, 1)), pair("c1", flat(1, 1), 10, 0, "inconnu")] }));
    assert.deepEqual(report.products.map((p) => [p.productId, p.current]), [["p1", 15]]);
  });

  it("classe les constats : gravité d'abord, puis type", () => {
    const report = buildInsights(input({ pairs: [pair("c1", flat(10, 10), 500, 100), pair("c2", flat(10, 15))], risks: [{ ...risk("SOON"), centerId: "c2" }] }));
    // Grave : pertes. Moyen : risque de rupture avant centre qui consomme plus que les autres (15 contre 10 par jour). Faible : tendance.
    assert.deepEqual(report.findings.map((f) => [f.type, f.severity]), [["LOSSES", "HIGH"], ["RUPTURE_RISK", "MEDIUM"], ["CENTER_OUTLIER", "MEDIUM"], ["TREND_UP", "LOW"]]);
  });

  it("tableau par produit : parts qui totalisent la consommation, évolution, couverture ; trié par unité puis volume", () => {
    const report = buildInsights(
      input({
        products: [
          { id: "p1", name: "Shampoing", unit: "ML" },
          { id: "p2", name: "Colorant", unit: "G" },
          { id: "p3", name: "Gants", unit: "PIECE" },
        ],
        pairs: [pair("c1", flat(10, 15), 300), pair("c2", flat(10, 5), 100), pair("c1", flat(1, 1), 10, 0, "p2"), pair("c1", flat(3, 3), 10, 0, "p3")],
      }),
    );
    assert.deepEqual(report.products.map((p) => p.name), ["Colorant", "Shampoing", "Gants"]); // G, ML, PIECE
    const shampoing = report.products.find((p) => p.productId === "p1")!;
    assert.deepEqual([shampoing.current, shampoing.previous, shampoing.changePct], [560, 560, 0]);
    assert.deepEqual(shampoing.centers.map((c) => [c.centerId, c.current, c.sharePct, c.changePct, c.dailyRate, c.coverDays]), [["c1", 420, 75, 50, 15, 20], ["c2", 140, 25, -50, 5, 20]]);
  });

  it("part de données de démonstration", () => {
    const report = buildInsights(input({ quality: { simulatedMovements: 30, totalMovements: 120, historyDays: 60 } }));
    assert.deepEqual([report.quality.simulatedSharePct, report.quality.historyDays], [25, 60]);
    assert.equal(buildInsights(input()).quality.simulatedSharePct, 0);
  });
});
