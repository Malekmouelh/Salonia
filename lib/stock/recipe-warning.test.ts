// Module 5 (F5.3) — Alerte « recette plus gourmande que le stock » : fonction pure. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addToCover, recipeStockWarning, servicesBeforeAlert } from "./recipe-warning";

describe("alerte de stock d'une ligne de recette", () => {
  it("signale une quantité supérieure au stock du centre le mieux fourni (30 ml en stock, 40 ml demandés)", () => {
    assert.equal(recipeStockWarning(addToCover(undefined, 30), 40), "INSUFFICIENT");
  });

  it("ne dit rien quand le stock suffit, y compris pile à la quantité demandée", () => {
    assert.equal(recipeStockWarning(addToCover(undefined, 30), 30), null);
    assert.equal(recipeStockWarning(addToCover(undefined, 30), 10), null);
  });

  it("compare au meilleur centre, pas au total : 30 + 30 ml dans deux centres ne permettent pas 40 ml", () => {
    const cover = addToCover(addToCover(undefined, 30), 30);
    assert.deepEqual(cover, { total: 60, best: 30, centers: 2 });
    assert.equal(recipeStockWarning(cover, 40), "INSUFFICIENT");
    assert.equal(recipeStockWarning(addToCover(cover, 45), 40), null);
  });

  it("signale un produit activé nulle part (jamais décompté), et un produit à zéro comme insuffisant", () => {
    assert.equal(recipeStockWarning(undefined, 5), "NOT_TRACKED");
    assert.equal(recipeStockWarning({ total: 0, best: 0, centers: 0 }, 5), "NOT_TRACKED");
    assert.equal(recipeStockWarning(addToCover(undefined, 0), 5), "INSUFFICIENT");
  });

  it("ignore une saisie vide ou invalide (le formulaire la refuse déjà)", () => {
    for (const quantity of [0, -3, 2.5, Number.NaN]) assert.equal(recipeStockWarning(undefined, quantity), null);
  });
});

describe("prestations avant l'alerte de seuil", () => {
  it("100 ml en stock, seuil 20, 30 ml par prestation : 3 prestations (100 → 70 → 40 → 10, le seuil est franchi à la 3e)", () => {
    assert.equal(servicesBeforeAlert(100, 20, 30), 3);
  });
  it("tombe pile sur le seuil : l'alerte se déclenche (quantité <= seuil)", () => {
    assert.equal(servicesBeforeAlert(100, 40, 30), 2); // 100 → 70 → 40 = seuil
    assert.equal(servicesBeforeAlert(100, 70, 30), 1);
  });
  it("seuil déjà atteint ou dépassé : 0 ; seuil à 0 : prestations jusqu'à la rupture", () => {
    assert.equal(servicesBeforeAlert(20, 20, 5), 0);
    assert.equal(servicesBeforeAlert(5, 20, 5), 0);
    assert.equal(servicesBeforeAlert(100, 0, 30), 4);
  });
  it("saisie invalide : null", () => {
    for (const q of [0, -1, 2.5, Number.NaN]) assert.equal(servicesBeforeAlert(100, 20, q), null);
  });
});
