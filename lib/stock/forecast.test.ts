// Module 5 (IA) — Prévision de consommation : calcul pur, valeurs attendues exactes. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_DAYS, addDaysToKey, compareForecasts, forecastProduct, weeklyTotals, type ForecastInput } from "./forecast";

const MONDAY = "2030-01-07"; // un lundi ; la série se termine donc le dimanche 2030-01-06

// 8 semaines (56 jours) ; chaque semaine a une demande journalière constante.
const series = (perDay: number[]) => perDay.flatMap((v) => Array<number>(7).fill(v)).slice(-HISTORY_DAYS);
const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  todayKey: MONDAY,
  dailyDemand: series([70, 70, 70, 70, 70, 70, 70, 70]),
  historyDays: 56,
  stock: 300,
  alertThreshold: 0,
  onOrder: 0,
  leadDays: 7,
  ...over,
});

describe("dates", () => {
  it("ajoute des jours à un jour civil, mois et années compris", () => {
    assert.equal(addDaysToKey("2030-01-07", 5), "2030-01-12");
    assert.equal(addDaysToKey("2030-01-31", 1), "2030-02-01");
    assert.equal(addDaysToKey("2030-01-01", -1), "2029-12-31");
  });
});

describe("totaux hebdomadaires", () => {
  it("découpe depuis la fin : la semaine la plus récente est complète", () => {
    const days = [...Array(3).fill(1), ...Array(7).fill(2), ...Array(7).fill(3)];
    assert.deepEqual(weeklyTotals(days, 2), [14, 21]);
    assert.deepEqual(weeklyTotals(days, 3), [3, 14, 21]);
  });
});

describe("prévision", () => {
  it("consommation régulière de 70 par jour, stock 300, délai 7 jours : rupture le 12, commande urgente, quantité exacte", () => {
    const f = forecastProduct(input());
    assert.equal(f.status, "OK");
    assert.deepEqual([f.weeklyRate, f.dailyRate, f.weeksOfData, f.confidence], [490, 70, 8, "HIGH"]);
    assert.deepEqual([f.daysLeft, f.ruptureDate], [5, "2030-01-12"]); // 300 - 70 x 5 < 0
    assert.equal(f.breakBeforeDelivery, true); // 5 jours < délai de 7 jours
    assert.equal(f.orderBy, "2030-01-05"); // avant aujourd'hui : on aurait dû commander
    assert.equal(f.safetyStock, 0); // aucune variabilité
    assert.equal(f.suggestedQuantity, 680); // 70 x (7 + 7) - 300
    assert.equal(f.urgency, "URGENT");
  });

  it("une commande déjà en route est déduite de la quantité suggérée", () => {
    assert.equal(forecastProduct(input({ onOrder: 300 })).suggestedQuantity, 380);
    assert.equal(forecastProduct(input({ onOrder: 5000 })).suggestedQuantity, 0);
  });

  it("lissage exponentiel : les semaines récentes pèsent plus (420, 490, 455, 525, 462, 490 par semaine → 483)", () => {
    const f = forecastProduct(input({ dailyDemand: series([60, 70, 65, 75, 66, 70]), historyDays: 42, leadDays: 5 }));
    assert.equal(f.weeklyRate, 483);
    assert.equal(f.dailyRate, 69);
    assert.equal(f.weeksOfData, 6);
    assert.ok(f.safetyStock >= 45 && f.safetyStock <= 48, String(f.safetyStock)); // écart-type hebdomadaire ≈ 33
    assert.equal(f.suggestedQuantity, Math.ceil(69 * (5 + 7) + f.safetyStock - 300));
    assert.equal(f.confidence, "HIGH");
  });

  it("le coefficient par jour de la semaine avance la rupture quand le gros de la demande tombe le samedi", () => {
    const saturdays = Array.from({ length: 8 }, () => [0, 0, 0, 0, 0, 0, 0]); // dimanche → samedi, la série finissant le dimanche
    // Série alignée sur les dates : le dernier jour est le dimanche 6, donc chaque bloc de 7 jours finit un dimanche (lundi → dimanche).
    const daily = saturdays.flatMap(() => [0, 0, 0, 0, 0, 700, 0]);
    const f = forecastProduct(input({ dailyDemand: daily, stock: 300, leadDays: null }));
    assert.equal(f.dailyRate, 100);
    // Sans saisonnalité : 300 / 100 = 3 jours. Avec : 4 jours à 50, puis le samedi à 200 → rupture le samedi 12 (k = 5).
    assert.deepEqual([f.daysLeft, f.ruptureDate], [5, "2030-01-12"]);
  });

  it("stock nul : rupture aujourd'hui, urgence maximale ; stock au seuil d'alerte : urgent aussi", () => {
    const zero = forecastProduct(input({ stock: 0 }));
    assert.deepEqual([zero.daysLeft, zero.ruptureDate, zero.urgency], [0, MONDAY, "URGENT"]);
    assert.equal(forecastProduct(input({ stock: 500, alertThreshold: 500, leadDays: 1 })).urgency, "URGENT");
  });

  it("assez de stock : pas d'urgence ni de quantité ; pas de rupture dans l'horizon", () => {
    const f = forecastProduct(input({ stock: 100_000 }));
    assert.deepEqual([f.ruptureDate, f.daysLeft, f.orderBy, f.suggestedQuantity, f.urgency], [null, null, null, 0, "OK"]);
  });

  it("sans fournisseur habituel : pas de date limite de commande, quantité sur un cycle de 7 jours", () => {
    const f = forecastProduct(input({ leadDays: null }));
    assert.deepEqual([f.orderBy, f.breakBeforeDelivery, f.suggestedQuantity], [null, false, 190]); // 70 x 7 - 300
  });

  it("ne devine pas : moins de 2 semaines d'historique, ou aucune consommation connue", () => {
    for (const historyDays of [0, 6, 13]) {
      const f = forecastProduct(input({ historyDays }));
      assert.deepEqual([f.status, f.suggestedQuantity, f.ruptureDate, f.confidence], ["NO_DATA", 0, null, null], String(historyDays));
    }
  });

  it("produit connu depuis longtemps mais jamais consommé : aucune rupture annoncée", () => {
    const f = forecastProduct(input({ dailyDemand: series([0, 0, 0, 0, 0, 0, 0, 0]) }));
    assert.deepEqual([f.status, f.ruptureDate, f.suggestedQuantity, f.urgency], ["NO_CONSUMPTION", null, 0, "OK"]);
  });

  it("l'historique court limite le nombre de semaines utilisées et la confiance", () => {
    const f = forecastProduct(input({ historyDays: 15 })); // 2 semaines
    assert.deepEqual([f.weeksOfData, f.confidence], [2, "LOW"]);
    assert.equal(forecastProduct(input({ historyDays: 22 })).confidence, "MEDIUM"); // 3 semaines
  });

  it("une consommation très irrégulière baisse la confiance malgré un long historique", () => {
    const f = forecastProduct(input({ dailyDemand: series([10, 200, 5, 300, 0, 250, 20, 180]) }));
    assert.equal(f.confidence, "MEDIUM");
  });

  it("tri : urgents d'abord, puis rupture la plus proche", () => {
    const soon = forecastProduct(input({ stock: 500, leadDays: 2 })); // rupture dans 8 jours, délai 2 : 130 à commander dans le cycle
    const urgent = forecastProduct(input({ stock: 100 }));
    const fine = forecastProduct(input({ stock: 100_000 }));
    assert.equal(soon.urgency, "SOON");
    assert.deepEqual([fine, soon, urgent].sort(compareForecasts).map((f) => f.urgency), ["URGENT", "SOON", "OK"]);
  });
});
