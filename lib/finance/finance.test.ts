// Tests du Module 6 (parcours critiques : montants, soldes, numérotation, IA statistique).
// Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backtest, cashAnomalies, expenseAnomalies, forecastMonth, mad, median, revenueAnomalies, type DayPoint } from "./analytics";
import { balanceDue, computeTotals, formatDocNumber, netPaid, roundTnd, vatBreakdown } from "./money";

describe("montants en dinars (millimes)", () => {
  it("arrondit au millime", () => {
    assert.equal(roundTnd(0.1 + 0.2), 0.3);
    assert.equal(roundTnd(12.3456), 12.346);
    assert.equal(roundTnd(1.0005), 1.001);
  });

  it("calcule les totaux d'une facture avec remise plafonnée", () => {
    const t = computeTotals([
      { label: "Coupe femme", quantity: 1, unitPriceTnd: 35 },
      { label: "Brushing", quantity: 2, unitPriceTnd: 25 },
    ], 10);
    assert.equal(t.subtotalTnd, 85);
    assert.equal(t.discountTnd, 10);
    assert.equal(t.totalTnd, 75);
    assert.equal(t.lines[1].totalTnd, 50);
    // Une remise supérieure au sous-total est ramenée au sous-total ; une remise négative à 0.
    assert.equal(computeTotals([{ label: "x", quantity: 1, unitPriceTnd: 20 }], 50).totalTnd, 0);
    assert.equal(computeTotals([{ label: "x", quantity: 1, unitPriceTnd: 20 }], -5).totalTnd, 20);
  });

  it("déduit la TVA incluse (19 %) d'un prix TTC", () => {
    const v = vatBreakdown(119);
    assert.equal(v.ht, 100);
    assert.equal(v.vat, 19);
    assert.equal(roundTnd(v.ht + v.vat), v.ttc);
    const odd = vatBreakdown(35);
    assert.equal(roundTnd(odd.ht + odd.vat), 35);
  });

  it("calcule le solde : acomptes et paiements moins remboursements, paiements non confirmés ignorés", () => {
    const payments = [
      { kind: "DEPOSIT", amountTnd: 30, status: "PAID" },
      { kind: "PAYMENT", amountTnd: 50, status: "PAID" },
      { kind: "REFUND", amountTnd: 20, status: "PAID" },
      { kind: "PAYMENT", amountTnd: 100, status: "PENDING" },
      { kind: "PAYMENT", amountTnd: 100, status: "FAILED" },
    ];
    assert.equal(netPaid(payments), 60);
    assert.equal(balanceDue(140, payments), 80);
  });

  it("numérote les pièces sur 5 chiffres par année", () => {
    assert.equal(formatDocNumber("FAC", 2026, 42), "FAC-2026-00042");
    assert.equal(formatDocNumber("REC", 2027, 1), "REC-2027-00001");
  });
});

// Série journalière de test : 10 semaines, fermé le dimanche, samedi plus chargé.
function series(weeks: number, value = (wd: number) => (wd === 0 ? 0 : wd === 6 ? 900 : 500)): DayPoint[] {
  const out: DayPoint[] = [];
  const start = Date.UTC(2026, 6, 6); // lundi
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start + i * 86_400_000);
    const weekday = d.getUTCDay();
    const base = value(weekday);
    // Bruit déterministe de ±30 DT les jours ouverts ; les jours fermés restent à 0.
    out.push({ day: d.toISOString().slice(0, 10), weekday, value: base > 0 ? base + ((i * 37) % 60) - 30 : 0 });
  }
  return out;
}

describe("détection d'anomalies", () => {
  it("médiane et écart absolu médian", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(mad([1, 1, 1]), 0);
  });

  it("ne signale rien sur une activité régulière", () => {
    assert.deepEqual(revenueAnomalies(series(10)), []);
  });

  it("signale une chute brutale du chiffre d'affaires et ignore les jours de fermeture", () => {
    const s = series(10);
    const lastTuesday = s.findLastIndex((p) => p.weekday === 2);
    s[lastTuesday] = { ...s[lastTuesday], value: 80 };
    const found = revenueAnomalies(s, { centerId: "c1", centerName: "Tunis" });
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "REVENUE_DROP");
    assert.equal(found[0].severity, "high");
    assert.equal(found[0].day, s[lastTuesday].day);
    assert.ok(found.every((a) => a.day !== s.findLast((p) => p.weekday === 0)!.day));
  });

  it("signale une catégorie de dépenses en forte hausse et une dépense isolée inhabituelle", () => {
    const rows = [
      ...["2026-07", "2026-08", "2026-09"].flatMap((month, i) => [
        { id: `a${i}`, centerId: "c1", category: "PRODUCTS", label: "Produits", amountTnd: 400, month },
        { id: `b${i}`, centerId: "c1", category: "PRODUCTS", label: "Produits", amountTnd: 420, month },
      ]),
      { id: "x", centerId: "c1", category: "PRODUCTS", label: "Stock kératine", amountTnd: 2600, month: "2026-10" },
    ];
    const found = expenseAnomalies(rows, "2026-10", ["2026-09", "2026-08", "2026-07"], { center: () => "Tunis", category: () => "Produits" });
    assert.ok(found.some((a) => a.kind === "EXPENSE_SPIKE" && a.severity === "high"));
    assert.ok(found.some((a) => a.kind === "LARGE_EXPENSE"));
  });

  it("ignore un jour habituellement fermé, même avec quelques acomptes en ligne", () => {
    const s = series(10);
    const sundays = s.map((p, j) => (p.weekday === 0 ? j : -1)).filter((j) => j >= 0);
    // Quelques dimanches avec un petit acompte en ligne, puis un dimanche à 230 DT.
    for (const i of sundays.slice(-7, -1)) s[i] = { ...s[i], value: 38 };
    s[sundays.at(-1)!] = { ...s[sundays.at(-1)!], value: 230 };
    assert.deepEqual(revenueAnomalies(s), []);
  });

  it("signale des remboursements ou remises excessifs", () => {
    assert.equal(cashAnomalies({ revenue: 10000, refunds: 200, subtotal: 10000, discounts: 300 }).length, 0);
    const found = cashAnomalies({ revenue: 10000, refunds: 1200, subtotal: 10000, discounts: 1500 });
    assert.deepEqual(found.map((a) => a.kind).sort(), ["DISCOUNTS", "REFUNDS"]);
  });
});

describe("prévision du chiffre d'affaires", () => {
  it("prévoit les jours restants selon le jour de la semaine, avec une fourchette cohérente", () => {
    const history = series(12);
    const remaining = [
      { day: "2026-10-27", weekday: 2 },
      { day: "2026-10-31", weekday: 6 },
      { day: "2026-11-01", weekday: 0 },
    ];
    const f = forecastMonth(history, [{ day: "2026-10-01", weekday: 4, value: 1000 }], remaining);
    assert.equal(f.actualToDate, 1000);
    const [tue, sat, sun] = f.days.filter((d) => d.predicted).map((d) => d.value);
    assert.ok(Math.abs(tue - 500) < 40, `mardi ≈ 500 (${tue})`);
    assert.ok(Math.abs(sat - 900) < 40, `samedi ≈ 900 (${sat})`);
    assert.equal(sun, 0);
    assert.ok(f.low <= f.forecastTotal && f.forecastTotal <= f.high);
    assert.ok(f.low >= f.actualToDate);
  });

  it("borne la tendance et mesure l'erreur du modèle sur l'historique", () => {
    const growing = series(12, (wd) => (wd === 0 ? 0 : 500));
    const boosted = growing.map((p, i) => (i >= growing.length - 28 ? { ...p, value: p.value * 3 } : p));
    const f = forecastMonth(boosted, [], [{ day: "2026-10-27", weekday: 2 }]);
    assert.ok(f.trend <= 1.15);
    const error = backtest(series(12));
    assert.ok(error !== null && error < 0.1, `erreur faible sur une série régulière (${error})`);
  });
});
