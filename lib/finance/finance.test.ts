// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/finance.test.ts — LES TESTS AUTOMATISÉS DU MODULE 6
// ═══════════════════════════════════════════════════════════════════════════
// À QUOI SERVENT LES TESTS ? À vérifier AUTOMATIQUEMENT, en une commande (`npm test`), que les
// fonctions importantes donnent les bons résultats — et que cela reste vrai après chaque modification
// du code. C'est l'exigence « tests automatisés sur les parcours critiques » du cahier des charges §7.
//
// OUTILS UTILISÉS : l'exécuteur de tests INTÉGRÉ à Node.js (module `node:test`), sans bibliothèque
// externe. Vocabulaire :
//   • describe("…", () => { … }) : regroupe des tests sur un même sujet ;
//   • it("…", () => { … })       : UN test (une vérification) ;
//   • assert.equal(réel, attendu) : échoue si les deux valeurs diffèrent ; assert.ok(x) : échoue si x est faux ;
//   • assert.deepEqual : compare des objets/tableaux en profondeur.
//
// CE QUI EST TESTÉ ICI : uniquement des fonctions PURES (money.ts et analytics.ts) : elles ne dépendent
// ni de la base de données ni du réseau, donc les tests sont instantanés et fiables.
// (La logique avec base de données — encaissement, remboursement, isolation entre centres — a été
// validée à part par un test de bout-en-bout sur une vraie base MongoDB.)
// ═══════════════════════════════════════════════════════════════════════════

// Tests du Module 6 (parcours critiques : montants, soldes, numérotation, IA statistique).
// Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backtest, cashAnomalies, closingAnomalies, expenseAnomalies, forecastMonth, mad, median, revenueAnomalies, type DayPoint } from "./analytics";
import { balanceDue, cashVariance, computeTotals, formatDocNumber, netPaid, roundTnd, vatBreakdown } from "./money";

// ───────────────────────── Tests des calculs d'argent ─────────────────────────
describe("montants en dinars (millimes)", () => {
  it("arrondit au millime", () => {
    // 0.1 + 0.2 vaut 0.30000000000000004 en JavaScript : roundTnd doit le ramener à 0.3.
    assert.equal(roundTnd(0.1 + 0.2), 0.3);
    assert.equal(roundTnd(12.3456), 12.346);
    assert.equal(roundTnd(1.0005), 1.001); // arrondi « vers le haut » à la moitié
  });

  it("calcule les totaux d'une facture avec remise plafonnée", () => {
    // 1 × 35 + 2 × 25 = 85 DT de sous-total ; remise de 10 → total 75.
    const t = computeTotals([
      { label: "Coupe femme", quantity: 1, unitPriceTnd: 35 },
      { label: "Brushing", quantity: 2, unitPriceTnd: 25 },
    ], 10);
    assert.equal(t.subtotalTnd, 85);
    assert.equal(t.discountTnd, 10);
    assert.equal(t.totalTnd, 75);
    assert.equal(t.lines[1].totalTnd, 50);
    // Une remise supérieure au sous-total est ramenée au sous-total ; une remise négative à 0.
    // (Garde-fou : impossible d'obtenir une facture négative ou un « supplément » déguisé en remise.)
    assert.equal(computeTotals([{ label: "x", quantity: 1, unitPriceTnd: 20 }], 50).totalTnd, 0);
    assert.equal(computeTotals([{ label: "x", quantity: 1, unitPriceTnd: 20 }], -5).totalTnd, 20);
  });

  it("déduit la TVA incluse (19 %) d'un prix TTC", () => {
    // 119 TTC = 100 HT + 19 de TVA (cas « rond » facile à vérifier à la main).
    const v = vatBreakdown(119);
    assert.equal(v.ht, 100);
    assert.equal(v.vat, 19);
    assert.equal(roundTnd(v.ht + v.vat), v.ttc);
    // Cas non rond : HT + TVA doit TOUJOURS retomber exactement sur le TTC.
    const odd = vatBreakdown(35);
    assert.equal(roundTnd(odd.ht + odd.vat), 35);
  });

  it("calcule le solde : acomptes et paiements moins remboursements, paiements non confirmés ignorés", () => {
    const payments = [
      { kind: "DEPOSIT", amountTnd: 30, status: "PAID" },
      { kind: "PAYMENT", amountTnd: 50, status: "PAID" },
      { kind: "REFUND", amountTnd: 20, status: "PAID" },
      { kind: "PAYMENT", amountTnd: 100, status: "PENDING" }, // lien de paiement non payé : ne compte pas
      { kind: "PAYMENT", amountTnd: 100, status: "FAILED" }, // paiement échoué : ne compte pas
    ];
    // 30 + 50 − 20 = 60 DT réellement encaissés ; il reste 140 − 60 = 80 à payer.
    assert.equal(netPaid(payments), 60);
    assert.equal(balanceDue(140, payments), 80);
  });

  it("numérote les pièces sur 5 chiffres par année", () => {
    assert.equal(formatDocNumber("FAC", 2026, 42), "FAC-2026-00042");
    assert.equal(formatDocNumber("REC", 2027, 1), "REC-2027-00001");
  });
});

// ───────────────────────── Jeu de données de test ─────────────────────────
// Série journalière de test : 10 semaines, fermé le dimanche, samedi plus chargé.
// Les valeurs de base : 500 DT en semaine, 900 le samedi, 0 le dimanche (salon fermé).
function series(weeks: number, value = (wd: number) => (wd === 0 ? 0 : wd === 6 ? 900 : 500)): DayPoint[] {
  const out: DayPoint[] = [];
  // On part d'un lundi (6 juillet 2026). `Date.UTC(2026, 6, 6)` : le mois 6 = juillet (les mois commencent à 0).
  const start = Date.UTC(2026, 6, 6); // lundi
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start + i * 86_400_000); // jour n° i
    const weekday = d.getUTCDay(); // 0 = dimanche … 6 = samedi
    const base = value(weekday);
    // Bruit déterministe de ±30 DT les jours ouverts ; les jours fermés restent à 0.
    // (`(i * 37) % 60` produit une variation « pseudo-aléatoire » mais toujours identique d'un test à l'autre.)
    out.push({ day: d.toISOString().slice(0, 10), weekday, value: base > 0 ? base + ((i * 37) % 60) - 30 : 0 });
  }
  return out;
}

// ───────────────────────── Tests de la détection d'anomalies ─────────────────────────
describe("détection d'anomalies", () => {
  it("médiane et écart absolu médian", () => {
    assert.equal(median([3, 1, 2]), 2); // nombre impair : l'élément du milieu après tri
    assert.equal(median([1, 2, 3, 4]), 2.5); // nombre pair : moyenne des deux du milieu
    assert.equal(mad([1, 1, 1]), 0); // aucune dispersion
  });

  it("ne signale rien sur une activité régulière", () => {
    // Test d'absence de FAUSSES ALERTES : une activité normale ne doit rien déclencher.
    assert.deepEqual(revenueAnomalies(series(10)), []);
  });

  it("signale une chute brutale du chiffre d'affaires et ignore les jours de fermeture", () => {
    const s = series(10);
    // On « sabote » le dernier mardi : 80 DT au lieu d'environ 500.
    const lastTuesday = s.findLastIndex((p) => p.weekday === 2);
    s[lastTuesday] = { ...s[lastTuesday], value: 80 };
    const found = revenueAnomalies(s, { centerId: "c1", centerName: "Tunis" });
    // Exactement UNE alerte : la chute (pas de fausse alerte les dimanches fermés).
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "REVENUE_DROP");
    assert.equal(found[0].severity, "high"); // −84 % : au-delà du seuil « important » (70 %)
    assert.equal(found[0].day, s[lastTuesday].day);
    assert.ok(found.every((a) => a.day !== s.findLast((p) => p.weekday === 0)!.day));
  });

  it("signale une catégorie de dépenses en forte hausse et une dépense isolée inhabituelle", () => {
    // 3 mois de dépenses « Produits » stables (~820 DT/mois), puis 2 600 DT d'un coup en octobre.
    const rows = [
      ...["2026-07", "2026-08", "2026-09"].flatMap((month, i) => [
        { id: `a${i}`, centerId: "c1", category: "PRODUCTS", label: "Produits", amountTnd: 400, month },
        { id: `b${i}`, centerId: "c1", category: "PRODUCTS", label: "Produits", amountTnd: 420, month },
      ]),
      { id: "x", centerId: "c1", category: "PRODUCTS", label: "Stock kératine", amountTnd: 2600, month: "2026-10" },
    ];
    const found = expenseAnomalies(rows, "2026-10", ["2026-09", "2026-08", "2026-07"], { center: () => "Tunis", category: () => "Produits" });
    // Deux alertes attendues : la catégorie en hausse (plus du double → « important ») ET la dépense isolée.
    assert.ok(found.some((a) => a.kind === "EXPENSE_SPIKE" && a.severity === "high"));
    assert.ok(found.some((a) => a.kind === "LARGE_EXPENSE"));
  });

  it("ignore un jour habituellement fermé, même avec quelques acomptes en ligne", () => {
    // Régression : cette situation a produit une FAUSSE alerte pendant le développement (des acomptes
    // payés en ligne un dimanche fermé). Ce test garantit qu'elle ne revienne pas.
    const s = series(10);
    const sundays = s.map((p, j) => (p.weekday === 0 ? j : -1)).filter((j) => j >= 0);
    // Quelques dimanches avec un petit acompte en ligne, puis un dimanche à 230 DT.
    for (const i of sundays.slice(-7, -1)) s[i] = { ...s[i], value: 38 };
    s[sundays.at(-1)!] = { ...s[sundays.at(-1)!], value: 230 };
    assert.deepEqual(revenueAnomalies(s), []);
  });

  it("signale des remboursements ou remises excessifs", () => {
    // Seuils : remboursements > 5 % du CA, remises > 10 % du sous-total.
    assert.equal(cashAnomalies({ revenue: 10000, refunds: 200, subtotal: 10000, discounts: 300 }).length, 0); // normal
    const found = cashAnomalies({ revenue: 10000, refunds: 1200, subtotal: 10000, discounts: 1500 }); // 12 % et 15 %
    assert.deepEqual(found.map((a) => a.kind).sort(), ["DISCOUNTS", "REFUNDS"]);
  });
});

// ───────────────────────── Tests de la prévision ─────────────────────────
describe("prévision du chiffre d'affaires", () => {
  it("prévoit les jours restants selon le jour de la semaine, avec une fourchette cohérente", () => {
    const history = series(12); // 12 semaines d'historique
    // Trois jours à prévoir : un mardi, un samedi, un dimanche.
    const remaining = [
      { day: "2026-10-27", weekday: 2 },
      { day: "2026-10-31", weekday: 6 },
      { day: "2026-11-01", weekday: 0 },
    ];
    const f = forecastMonth(history, [{ day: "2026-10-01", weekday: 4, value: 1000 }], remaining);
    assert.equal(f.actualToDate, 1000);
    const [tue, sat, sun] = f.days.filter((d) => d.predicted).map((d) => d.value);
    // Les prévisions doivent suivre le profil hebdomadaire : ≈ 500 un mardi, ≈ 900 un samedi, 0 un dimanche.
    assert.ok(Math.abs(tue - 500) < 40, `mardi ≈ 500 (${tue})`);
    assert.ok(Math.abs(sat - 900) < 40, `samedi ≈ 900 (${sat})`);
    assert.equal(sun, 0);
    // Cohérence de la fourchette : basse ≤ prévision ≤ haute, et la borne basse n'est jamais sous le déjà-encaissé.
    assert.ok(f.low <= f.forecastTotal && f.forecastTotal <= f.high);
    assert.ok(f.low >= f.actualToDate);
  });

  it("borne la tendance et mesure l'erreur du modèle sur l'historique", () => {
    const growing = series(12, (wd) => (wd === 0 ? 0 : 500));
    // On TRIPLE le CA des 4 dernières semaines : sans plafond, la prévision s'envolerait.
    const boosted = growing.map((p, i) => (i >= growing.length - 28 ? { ...p, value: p.value * 3 } : p));
    const f = forecastMonth(boosted, [], [{ day: "2026-10-27", weekday: 2 }]);
    assert.ok(f.trend <= 1.15); // la tendance est plafonnée à +15 %
    // Sur une série régulière, le modèle doit se tromper de moins de 10 % (backtest).
    const error = backtest(series(12));
    assert.ok(error !== null && error < 0.1, `erreur faible sur une série régulière (${error})`);
  });
});

// ───────────────────────── Tests de la clôture de caisse ─────────────────────────
describe("clôture de caisse", () => {
  it("calcule l'écart : compté moins attendu (négatif = il manque de l'argent)", () => {
    assert.equal(cashVariance(480, 465), -15);
    assert.equal(cashVariance(480, 480), 0);
    assert.equal(cashVariance(100.5, 103), 2.5);
    // Pas d'erreur de virgule flottante : 0.1 + 0.2 attendu, 0.3 compté → écart exactement nul.
    assert.equal(cashVariance(roundTnd(0.1 + 0.2), 0.3), 0);
  });

  it("ignore les petits écarts, signale un écart isolé et alerte en cas de répétition", () => {
    const labels = { center: () => "Tunis" };
    // Écarts de 1 à 3 DT (monnaie) : sous le seuil de 10 DT, aucune alerte.
    assert.deepEqual(closingAnomalies([{ id: "1", centerId: "c1", day: "2026-10-01", varianceTnd: -3 }], labels), []);
    // Un écart isolé de 14 DT : alerte « à surveiller » ; de 60 DT : alerte « importante ».
    const one = closingAnomalies([{ id: "2", centerId: "c1", day: "2026-10-02", varianceTnd: 14 }], labels);
    assert.equal(one.length, 1);
    assert.equal(one[0].severity, "medium");
    assert.equal(closingAnomalies([{ id: "3", centerId: "c1", day: "2026-10-03", varianceTnd: -60 }], labels)[0].severity, "high");
    // Trois écarts sur le même centre : UNE seule alerte « répétés », importante.
    const repeated = closingAnomalies(
      [
        { id: "a", centerId: "c1", day: "2026-10-04", varianceTnd: -18 },
        { id: "b", centerId: "c1", day: "2026-10-05", varianceTnd: -35 },
        { id: "c", centerId: "c1", day: "2026-10-06", varianceTnd: -12 },
      ],
      labels,
    );
    assert.equal(repeated.length, 1);
    assert.equal(repeated[0].severity, "high");
    assert.match(repeated[0].title, /répétés/);
  });
});

