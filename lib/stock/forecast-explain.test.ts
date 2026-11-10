// Module 5 (IA) — Explication d'une prévision : phrase de secours, appel Gemini simulé (aucun réseau), refus d'un nombre inventé,
// cache de la journée, secret jamais exposé, droits. Lancer : npm test
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { StockMovement } from "@/lib/models/stock";
import { forecastProduct, HISTORY_DAYS } from "./forecast";
import type { ForecastRow } from "./forecast-data";
import { basicExplanation, clearExplanationCache, explainForecastRow, explainStockForecast, usesOnlyGivenNumbers, type FetchLike } from "./forecast-explain";
import { activateProductInCenter, createProduct } from "./service";
import { expectFail, expectOk, id, makeWorld, newId, type World } from "./test-fixtures";

const TODAY = "2030-01-07";
const SECRET = "cle-de-test-ne-pas-divulguer";

const row = (over: Partial<ForecastRow> = {}, stock = 300, leadDays: number | null = 7): ForecastRow => ({
  ...forecastProduct({ todayKey: TODAY, dailyDemand: Array(HISTORY_DAYS).fill(70), historyDays: 56, stock, alertThreshold: 0, onOrder: 0, leadDays }),
  productId: newId(),
  productName: "Shampoing",
  unit: "ML",
  centerId: newId(),
  supplierId: null,
  supplierName: null,
  supplierActive: false,
  ...over,
});

const noForecast = (historyDays: number) =>
  row(forecastProduct({ todayKey: TODAY, dailyDemand: Array(HISTORY_DAYS).fill(0), historyDays, stock: 10, alertThreshold: 0, onOrder: 0, leadDays: null }));

type Call = { url: string; headers: Record<string, string>; body: string };
function fakeGemini(reply: string | null | Error, ok = true) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (reply instanceof Error) throw reply;
    return { ok, status: ok ? 200 : 500, json: async () => ({ candidates: reply === null ? [] : [{ content: { parts: [{ text: reply }] } }] }) };
  };
  return { calls, fetchImpl };
}

const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
beforeEach(() => {
  clearExplanationCache();
  process.env.GEMINI_API_KEY = SECRET;
  delete process.env.GEMINI_MODEL;
});
afterEach(() => {
  if (saved.key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved.key;
  if (saved.model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = saved.model;
});

describe("phrase de secours (sans IA)", () => {
  it("reprend les chiffres du calcul, en français et en arabe", () => {
    const r = row({}, 300, 7);
    const fr = basicExplanation(r, "fr");
    assert.match(fr, /Shampoing/);
    assert.match(fr, /70/);
    assert.match(fr, /300/);
    assert.match(fr, /avant la livraison/); // rupture dans 5 jours, délai 7
    assert.match(fr, /680/);
    assert.match(basicExplanation(r, "ar"), /الكمية المقترحة/);
  });

  it("dit clairement quand il n'y a pas assez de données ou pas de consommation, sans inventer de date", () => {
    assert.match(basicExplanation(noForecast(5), "fr"), /Pas assez d'historique/);
    assert.match(basicExplanation(noForecast(56), "fr"), /aucune rupture/);
  });
});

describe("appel à Gemini", () => {
  it("utilise la réponse du modèle quand elle ne contient que les chiffres fournis ; la clé passe par l'en-tête, jamais par le corps", async () => {
    const r = row();
    const text = "Le shampoing sera épuisé dans 5 jours, soit le 12 janvier. Commandez 680 ml.";
    const { calls, fetchImpl } = fakeGemini(text);
    const result = await explainForecastRow(r, "fr", TODAY, fetchImpl);
    assert.deepEqual(result, { text, source: "AI" });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /gemini-flash-lite-latest:generateContent$/);
    assert.equal(calls[0].headers["x-goog-api-key"], SECRET);
    assert.equal(calls[0].body.includes(SECRET), false);
    assert.equal(calls[0].url.includes(SECRET), false);
  });

  it("GEMINI_MODEL change le modèle sans toucher au code", async () => {
    process.env.GEMINI_MODEL = "autre-modele";
    const { calls, fetchImpl } = fakeGemini("Commandez 680 ml.");
    await explainForecastRow(row(), "fr", TODAY, fetchImpl);
    assert.match(calls[0].url, /autre-modele:generateContent$/);
  });

  it("n'envoie que des chiffres et le nom du produit : aucune donnée de client ni identifiant", async () => {
    const { calls, fetchImpl } = fakeGemini("Commandez 680 ml.");
    await explainForecastRow(row(), "fr", TODAY, fetchImpl);
    const body = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    assert.match(body, /"produit":"Shampoing"/);
    assert.doesNotMatch(body, /centerId|organizationId|productId|client|téléphone|email/i);
  });

  it("une date limite de commande déjà dépassée est transmise comme « dès aujourd'hui », pas comme une date", async () => {
    const r = row({}, 300, 7); // rupture dans 5 jours, délai 7 : date limite le 5 janvier, avant le 7
    assert.equal(r.orderBy, "2030-01-05");
    const { calls, fetchImpl } = fakeGemini("Commandez 680 ml dès aujourd'hui.");
    await explainForecastRow(r, "fr", TODAY, fetchImpl);
    const body = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    assert.match(body, /"commanderDesAujourdhui":true/);
    assert.match(body, /"commanderAvant":null/);
  });

  it("refuse une réponse qui contient un nombre inventé : phrase de secours", async () => {
    const { fetchImpl } = fakeGemini("Commandez 900 ml dès demain.");
    const result = await explainForecastRow(row(), "fr", TODAY, fetchImpl);
    assert.equal(result.source, "BASIC");
    assert.match(result.text, /680/);
  });

  it("repli sans erreur visible : réponse vide, erreur HTTP, réseau coupé, texte trop long", async () => {
    for (const make of [() => fakeGemini(null), () => fakeGemini("x", false), () => fakeGemini(new Error("réseau")), () => fakeGemini("a".repeat(700))]) {
      clearExplanationCache();
      const result = await explainForecastRow(row(), "fr", TODAY, make().fetchImpl);
      assert.equal(result.source, "BASIC");
      assert.ok(result.text.length > 0);
    }
  });

  it("sans clé API : aucun appel réseau, phrase de secours", async () => {
    delete process.env.GEMINI_API_KEY;
    const { calls, fetchImpl } = fakeGemini("ne doit pas être appelé");
    assert.equal((await explainForecastRow(row(), "fr", TODAY, fetchImpl)).source, "BASIC");
    assert.equal(calls.length, 0);
  });

  it("sans prévision (historique trop court) : pas d'appel, donc pas de quota consommé", async () => {
    const { calls, fetchImpl } = fakeGemini("x");
    assert.equal((await explainForecastRow(noForecast(3), "fr", TODAY, fetchImpl)).source, "BASIC");
    assert.equal(calls.length, 0);
  });

  it("une phrase de secours n'est pas gardée : après un échec de Gemini, l'appel suivant réessaie", async () => {
    const r = row();
    const down = fakeGemini("x", false);
    assert.equal((await explainForecastRow(r, "fr", TODAY, down.fetchImpl)).source, "BASIC");
    const up = fakeGemini("Commandez 680 ml.");
    assert.equal((await explainForecastRow(r, "fr", TODAY, up.fetchImpl)).source, "AI");
    assert.equal(up.calls.length, 1);
  });

  it("garde la réponse en mémoire pour la journée ; des chiffres différents, un autre jour ou une autre langue donnent un nouvel appel", async () => {
    const r = row();
    const { calls, fetchImpl } = fakeGemini("Commandez 680 ml.");
    await explainForecastRow(r, "fr", TODAY, fetchImpl);
    await explainForecastRow(r, "fr", TODAY, fetchImpl);
    assert.equal(calls.length, 1);
    await explainForecastRow({ ...r, stock: 250 }, "fr", TODAY, fetchImpl);
    await explainForecastRow(r, "fr", "2030-01-08", fetchImpl);
    await explainForecastRow(r, "ar", TODAY, fetchImpl);
    assert.equal(calls.length, 4);
  });
});

describe("contrôle des nombres", () => {
  it("accepte les nombres fournis, bruts ou mis en forme, et les chiffres arabes ; refuse les autres", () => {
    const r = row({}, 1500);
    assert.equal(usesOnlyGivenNumbers("Il reste 1500 ml, soit 70 par jour.", r, "fr"), true);
    assert.equal(usesOnlyGivenNumbers("Il reste 1 500 ml.", r, "fr"), true);
    assert.equal(usesOnlyGivenNumbers("Il reste 1501 ml.", r, "fr"), false);
    assert.equal(usesOnlyGivenNumbers("Commandez 12 unités.", r, "fr"), false);
    assert.equal(usesOnlyGivenNumbers("المتبقي ٧٠ مل", r, "ar"), true);
    assert.equal(usesOnlyGivenNumbers("Aucun chiffre ici.", r, "fr"), true);
  });
});

describe("service : droits, centre et recalcul côté serveur", () => {
  let db: TestDb;
  let w: World;
  const NOW = new Date("2030-01-07T09:00:00Z");
  before(async () => {
    db = await startTestDb();
  });
  after(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    w = await makeWorld(db);
  });

  async function seed(center = w.a1) {
    const product = expectOk(await createProduct(w.ownerA(), { name: "Gel", unit: "ML" })).product;
    expectOk(await activateProductInCenter(w.ownerA(), { productId: product.id, centerId: id(center), initialQuantity: 0 }));
    const key = { organizationId: w.orgA._id, productId: product.id, centerId: center._id };
    await StockMovement.create({ ...key, kind: "OPENING", seq: 1, delta: 500, balanceAfter: 500, createdAt: new Date("2029-10-01T10:00:00Z") });
    return product.id;
  }

  it("renvoie une explication pour un produit du périmètre ; les chiffres viennent du serveur, jamais de la saisie", async () => {
    delete process.env.GEMINI_API_KEY;
    const productId = await seed();
    const result = expectOk(await explainStockForecast(w.ownerA(), { productId, centerId: id(w.a1), lang: "fr", stock: 99999, dailyRate: 1 }, NOW));
    assert.equal(result.source, "BASIC");
    assert.doesNotMatch(result.text, /99999/);
  });

  it("refuse un centre hors périmètre du gérant, un produit inconnu ou d'une autre organisation, une saisie invalide et un rôle sans droit", async () => {
    const productId = await seed(w.a2);
    expectFail(await explainStockForecast(w.managerA(w.a1), { productId, centerId: id(w.a2) }, NOW), "Centre introuvable.");
    expectFail(await explainStockForecast(w.ownerA(), { productId: newId(), centerId: id(w.a2) }, NOW), "Produit introuvable.");
    expectFail(await explainStockForecast(w.ownerB(), { productId, centerId: id(w.a2) }, NOW), "Centre introuvable.");
    expectFail(await explainStockForecast(w.ownerA(), { productId: "pas-un-id", centerId: id(w.a2) }, NOW));
    expectFail(await explainStockForecast(w.ownerA(), { productId, centerId: id(w.a2), lang: "de" }, NOW));
    expectFail(await explainStockForecast(w.actor("STAFF", w.orgA, [w.a2]), { productId, centerId: id(w.a2) }, NOW), "Action non autorisée.");
  });
});
