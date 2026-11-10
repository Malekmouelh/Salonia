// Module 5 — État, filtres et tri des niveaux de stock : fonctions pures. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countByState, filterLevels, levelState, sortLevels, summarizeProduct } from "./level-filter";

const level = (productName: string, centerId: string, quantity: number, alertThreshold: number, productActive = true, productId = productName) => ({
  productId,
  productName,
  centerId,
  productActive,
  quantity,
  alertThreshold,
  lowStock: quantity <= alertThreshold,
});

const LEVELS = [
  level("Shampoing", "c1", 500, 100), // suffisant
  level("Shampoing", "c2", 80, 100), // bas
  level("Gants", "c1", 0, 20), // rupture (seuil aussi atteint)
  level("Colorant", "c1", 40, 40), // pile au seuil : bas
  level("Ancien", "c1", 5, 10, false), // archivé
];

describe("état d'un niveau", () => {
  it("rupture avant stock bas ; pile au seuil = stock bas ; archivé prime sur tout", () => {
    assert.deepEqual(LEVELS.map(levelState), ["OK", "LOW", "OUT", "LOW", "ARCHIVED"]);
  });
});

describe("filtres", () => {
  const all = { state: "ALL" as const, supplierId: null, needle: "" };
  const names = (list: typeof LEVELS) => list.map((l) => `${l.productName}@${l.centerId}`);

  it("par état : à surveiller = rupture + bas (jamais archivé), puis chaque état seul", () => {
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, state: "WATCH" }, {})), ["Shampoing@c2", "Gants@c1", "Colorant@c1"]);
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, state: "OUT" }, {})), ["Gants@c1"]);
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, state: "LOW" }, {})), ["Shampoing@c2", "Colorant@c1"]);
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, state: "OK" }, {})), ["Shampoing@c1"]);
    assert.equal(filterLevels(LEVELS, all, {}).length, 5);
  });

  it("par nom (sans tenir compte de la casse ni des espaces autour)", () => {
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, needle: "  SHAMP " }, {})), ["Shampoing@c1", "Shampoing@c2"]);
  });

  it("par fournisseur habituel, ou « NONE » pour les produits sans fournisseur", () => {
    const supplierOf = { Shampoing: "s1", Gants: "s2", Colorant: null };
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, supplierId: "s1" }, supplierOf)), ["Shampoing@c1", "Shampoing@c2"]);
    assert.deepEqual(names(filterLevels(LEVELS, { ...all, supplierId: "NONE" }, supplierOf)), ["Colorant@c1", "Ancien@c1"]);
  });

  it("les filtres se combinent", () => {
    assert.deepEqual(names(filterLevels(LEVELS, { state: "LOW", supplierId: "s1", needle: "sham" }, { Shampoing: "s1" })), ["Shampoing@c2"]);
  });
});

describe("tri", () => {
  const order = (sort: Parameters<typeof sortLevels>[1]) => sortLevels(LEVELS, sort).map((l) => `${l.productName}@${l.centerId}`);
  it("par nom puis centre ; par quantité croissante ; par criticité (rapport quantité/seuil), archivés en dernier", () => {
    assert.deepEqual(order("NAME"), ["Ancien@c1", "Colorant@c1", "Gants@c1", "Shampoing@c1", "Shampoing@c2"]);
    assert.deepEqual(order("QUANTITY"), ["Gants@c1", "Ancien@c1", "Colorant@c1", "Shampoing@c2", "Shampoing@c1"]);
    assert.deepEqual(order("CRITICAL"), ["Gants@c1", "Shampoing@c2", "Colorant@c1", "Shampoing@c1", "Ancien@c1"]);
  });
  it("ne modifie pas la liste d'origine", () => {
    const before = LEVELS.map((l) => l.productName).join();
    sortLevels(LEVELS, "QUANTITY");
    assert.equal(LEVELS.map((l) => l.productName).join(), before);
  });
});

describe("décomptes et synthèse d'un produit", () => {
  it("compte chaque état (à surveiller = rupture + bas)", () => {
    assert.deepEqual(countByState(LEVELS), { ALL: 5, WATCH: 3, OUT: 1, LOW: 2, OK: 1 });
  });
  it("total, centres et répartition d'un produit", () => {
    assert.deepEqual(summarizeProduct(LEVELS.filter((l) => l.productName === "Shampoing")), { total: 580, centers: 2, out: 0, low: 1, ok: 1 });
    assert.deepEqual(summarizeProduct([]), { total: 0, centers: 0, out: 0, low: 0, ok: 0 });
  });
});
