// F4 — Prévision de charge : calcul pur. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForecast, dayLoad, type DayInput } from "./forecast";

const day = (date: string, over: Partial<DayInput> = {}): DayInput => ({ date, weekday: 1, openMinutes: 600, staffTotal: 2, staffOff: 0, bookedMinutes: 600, ...over });

describe("dayLoad", () => {
  it("taux = minutes réservées / (praticiens présents × minutes d'ouverture)", () => {
    const d = dayLoad(day("2030-06-03", { bookedMinutes: 600 }));
    assert.equal(d.capacityMinutes, 1200);
    assert.equal(d.rate, 0.5);
    assert.equal(d.status, "ok");
  });
  it("seuils : surchargé, chargé, creux", () => {
    assert.equal(dayLoad(day("d", { bookedMinutes: 1100 })).status, "overloaded");
    assert.equal(dayLoad(day("d", { bookedMinutes: 850 })).status, "busy");
    assert.equal(dayLoad(day("d", { bookedMinutes: 100 })).status, "low");
  });
  it("les absences réduisent la capacité et augmentent le taux", () => {
    assert.ok(dayLoad(day("d", { staffOff: 1 })).rate! > dayLoad(day("d")).rate!);
  });
  it("centre fermé ; tout le monde absent = non couvert ; jamais de NaN", () => {
    assert.equal(dayLoad(day("d", { openMinutes: 0 })).status, "closed");
    const u = dayLoad(day("d", { staffOff: 2 }));
    assert.equal(u.status, "uncovered");
    assert.equal(u.rate, null);
    assert.equal(dayLoad(day("d", { staffTotal: 0, bookedMinutes: 0 })).status, "closed");
  });
});

describe("buildForecast", () => {
  const today = "2030-06-05"; // mercredi
  const days = [
    day("2030-06-03", { bookedMinutes: 600 }), // passé : 0.5
    day("2030-06-04", { bookedMinutes: 800 }), // passé : 0.67
    day("2030-06-05", { bookedMinutes: 1100 }), // surchargé
    day("2030-06-06", { bookedMinutes: 50 }), // creux
    day("2030-06-09", { weekday: 0, openMinutes: 0, bookedMinutes: 0 }), // dimanche fermé
    day("2030-06-10", { staffOff: 2 }), // non couvert
  ];
  it("sépare passé (référence) et futur ; regroupe par semaine (lundi)", () => {
    const f = buildForecast(days, today);
    assert.equal(f.days.length, 4);
    assert.equal(f.referenceAvgRate, 0.59);
    assert.deepEqual(f.weeks.map((w) => w.start), ["2030-06-03", "2030-06-10"]);
    assert.equal(f.weeks[0].overloaded, 1);
    assert.equal(f.weeks[0].low, 1);
    assert.equal(f.weeks[1].uncovered, 1);
  });
  it("alertes : surcharge, creux et non couvert, pas le jour fermé", () => {
    const f = buildForecast(days, today);
    assert.deepEqual(f.alerts.map((a) => a.status), ["overloaded", "low", "uncovered"]);
  });
  it("sans donnée : tout est vide, sans erreur", () => {
    const f = buildForecast([], today);
    assert.deepEqual([f.days.length, f.weeks.length, f.referenceAvgRate, f.alerts.length], [0, 0, null, 0]);
  });
});
