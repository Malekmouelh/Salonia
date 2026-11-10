// Assistant financier : périmètre (intentions), mois futur demandé et prévision d'un mois futur. Fonctions pures.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromLocal } from "@/lib/booking/time";
import { monthlyTotals, projectMonth, type DayPoint } from "./analytics";
import { classifyIntent, parseFutureMonth, REFUSAL } from "./assistant-intent";

describe("classifyIntent : seuls salutations, remerciements et finances du salon", () => {
  it("reconnaît les salutations (français, derja, arabe)", () => {
    for (const q of ["Bonjour", "salut !", "Aslema", "السلام عليكم", "Bonsoir, ça va ?"]) assert.equal(classifyIntent(q), "greeting", q);
  });
  it("reconnaît les remerciements", () => {
    for (const q of ["Merci beaucoup", "merci !", "yaatik saha", "شكرا", "Parfait, merci"]) assert.equal(classifyIntent(q), "thanks", q);
  });
  it("reconnaît les questions financières, même informelles ou mêlées à une salutation", () => {
    for (const q of [
      "Bonjour, quel est mon chiffre d'affaires ce mois-ci ?",
      "ch7al dakhalna lchhar hedha",
      "Prévois mon CA en mars",
      "combien j'ai dépensé ?",
      "quel centre est le plus rentable",
      "كم مداخيل هذا الشهر؟",
      "comment va mon salon ?",
    ]) assert.equal(classifyIntent(q), "finance", q);
  });
  it("classe tout le reste hors sujet", () => {
    for (const q of ["Quelle est la capitale de la France ?", "écris-moi un poème", "Donne-moi une recette de couscous", "qui a gagné le match ?"]) {
      assert.notEqual(classifyIntent(q), "finance", q);
      assert.notEqual(classifyIntent(q), "greeting", q);
    }
  });
  it("le refus présente l'agent comme spécialisé dans la gestion financière des salons", () => {
    assert.match(REFUSAL.fr, /agent spécialisé dans la gestion financière des salons de beauté/);
  });
});

describe("parseFutureMonth : mois futur demandé", () => {
  const now = fromLocal(2026, 11, 10, 12);
  it("« le mois prochain » et « dans 3 mois »", () => {
    assert.deepEqual(parseFutureMonth("CA le mois prochain ?", now), { year: 2026, month: 12 });
    assert.deepEqual(parseFutureMonth("prévision dans 3 mois", now), { year: 2027, month: 2 });
  });
  it("un nom de mois désigne sa prochaine occurrence ; une année explicite est respectée", () => {
    assert.deepEqual(parseFutureMonth("prévision pour mars", now), { year: 2027, month: 3 });
    assert.deepEqual(parseFutureMonth("prévision décembre", now), { year: 2026, month: 12 });
    assert.deepEqual(parseFutureMonth("mars 2027", now), { year: 2027, month: 3 });
  });
  it("refuse le mois en cours, le passé et au-delà de 12 mois", () => {
    assert.equal(parseFutureMonth("novembre", now), null);
    assert.equal(parseFutureMonth("mars 2026", now), null);
    assert.equal(parseFutureMonth("mars 2028", now), null);
    assert.equal(parseFutureMonth("dans 18 mois", now), null);
  });
});

// Historique synthétique : `days` jours se terminant le 2026-11-09, valeur = f(jour).
function history(days: number, value: (d: Date, i: number) => number): DayPoint[] {
  const end = Date.UTC(2026, 10, 9);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000);
    return { day: d.toISOString().slice(0, 10), weekday: (d.getUTCDay() + 6) % 7, value: value(d, i) };
  });
}
// Jours de février 2027 (28 jours, commence un lundi).
const FEB_2027 = Array.from({ length: 28 }, (_, i) => ({ day: `2027-02-${String(i + 1).padStart(2, "0")}`, weekday: i % 7 }));

describe("projectMonth : prévision d'un mois futur", () => {
  it("activité stable : prévision ≈ base, fourchette qui contient la prévision", () => {
    const h = history(400, () => 100);
    const f = projectMonth(h, { month: "2027-02", days: FEB_2027, monthsAhead: 3 }, "2026-11");
    assert.equal(f.baseline, 2800);
    assert.equal(f.trendPercentPerMonth, 0);
    assert.ok(Math.abs(f.forecast - 2800) < 60, String(f.forecast));
    assert.ok(f.low < f.forecast && f.forecast < f.high);
  });
  it("activité en croissance : tendance positive et prévision au-dessus de la base", () => {
    const h = history(400, (_, i) => 50 + i * 0.5);
    const f = projectMonth(h, { month: "2027-02", days: FEB_2027, monthsAhead: 3 }, "2026-11");
    assert.ok(f.trendPercentPerMonth > 0);
    assert.ok(f.forecast > f.baseline);
  });
  it("la fourchette s'élargit avec l'horizon", () => {
    const h = history(400, (d) => 80 + (d.getUTCDate() % 7) * 10);
    const near = projectMonth(h, { month: "2027-02", days: FEB_2027, monthsAhead: 1 }, "2026-11");
    const far = projectMonth(h, { month: "2027-02", days: FEB_2027, monthsAhead: 9 }, "2026-11");
    assert.ok(far.uncertaintyPercent > near.uncertaintyPercent);
  });
  it("saisonnalité : un mois de février fort l'an dernier relève la prévision", () => {
    const h = history(400, (d) => (d.getUTCMonth() === 1 ? 200 : 100));
    const f = projectMonth(h, { month: "2027-02", days: FEB_2027, monthsAhead: 3 }, "2026-11");
    assert.ok(f.seasonalFactor != null && f.seasonalFactor > 1);
    assert.ok(f.forecast > f.baseline);
  });
  it("salon récent : la période avant la première recette est ignorée (ni fausse tendance ni fausse saison)", () => {
    const h = history(400, (_, i) => (i < 300 ? 0 : 100));
    const f = projectMonth(h, { month: "2027-02", days: FEB_2027, monthsAhead: 3 }, "2026-11");
    assert.equal(f.seasonalFactor, null);
    assert.equal(f.trendPercentPerMonth, 0);
    assert.ok(Math.abs(f.forecast - 2800) < 60, String(f.forecast));
  });
  it("monthlyTotals exclut le mois en cours et les mois incomplets", () => {
    const months = monthlyTotals(history(70, () => 10), "2026-11");
    assert.deepEqual(months.map((m) => m.month), ["2026-09", "2026-10"]);
    assert.equal(months[1].revenue, 310);
  });
});
