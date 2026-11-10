// Module 5 (IA) — Analyse décisionnelle de la consommation : réponse de Gemini simulée (aucun réseau), refus d'un nombre inventé, d'une
// référence inconnue ou d'un transfert injustifié, synthèse de secours, cache, secret jamais exposé, droits. Lancer : npm test
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { FetchLike } from "./forecast-explain";
import { analyzeReport, analyzeStockConsumption, basicAnalysis, clearAnalysisCache, usesOnlyGivenNumbers } from "./insights-ai";
import { buildInsights, type InsightsInput, type InsightsReport } from "./insights";
import { MSG_STOCK_FORBIDDEN } from "./scope";
import { activateProductInCenter, createProduct } from "./service";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, type World } from "./test-fixtures";

const SECRET = "cle-de-test-ne-pas-divulguer";
const W = 28;
const flat = (previous: number, current: number) => [...Array<number>(W).fill(previous), ...Array<number>(W).fill(current)];

// Tunis presque à court de shampoing (4 jours), Djerba n'en consomme plus et en garde 2000 : déséquilibre, risque de rupture, centre qui consomme plus.
function sample(): InsightsReport {
  const input: InsightsInput = {
    todayKey: "2030-01-07",
    windowDays: W,
    centers: [
      { id: "c1", name: "Tunis" },
      { id: "c2", name: "Sousse" },
      { id: "c3", name: "Djerba" },
    ],
    products: [{ id: "p1", name: "Shampoing", unit: "ML" }],
    pairs: [
      { productId: "p1", centerId: "c1", stock: 300, alertThreshold: 0, daily: flat(70, 70), manualOut: 0 },
      { productId: "p1", centerId: "c2", stock: 900, alertThreshold: 0, daily: flat(10, 10), manualOut: 0 },
      { productId: "p1", centerId: "c3", stock: 2000, alertThreshold: 0, daily: flat(10, 0), manualOut: 0 },
    ],
    appointments: {},
    risks: [{ productId: "p1", centerId: "c1", urgency: "URGENT", status: "OK", stock: 300, daysLeft: 4, leadDays: 5, breakBeforeDelivery: true, suggestedQuantity: 1800 }],
    quality: { simulatedMovements: 0, totalMovements: 100, historyDays: 84 },
  };
  return buildInsights(input);
}
const report = sample();
const alias = (type: string) => `F${report.findings.findIndex((f) => f.type === type) + 1}`; // F1, F2… dans l'ordre des constats
const fid = (type: string) => report.findings.find((f) => f.type === type)!.id;

type Call = { url: string; headers: Record<string, string>; body: string };
function fakeGemini(reply: string | null | Error | (() => string), ok = true) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const value = typeof reply === "function" ? reply() : reply;
    if (value instanceof Error) throw value;
    return { ok, status: ok ? 200 : 503, json: async () => ({ candidates: value === null ? [] : [{ content: { parts: [{ text: value }] } }] }) };
  };
  return { calls, fetchImpl };
}

const good = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    titre: "Tunis risque la rupture de shampoing alors que Djerba en garde beaucoup.",
    priorites: [alias("RUPTURE_RISK"), alias("IMBALANCE")],
    analyses: [
      {
        constats: [alias("RUPTURE_RISK"), alias("IMBALANCE")],
        lecture: "Tunis n'a plus que 4 jours de shampoing, alors que Djerba en détient 2000 ml sans le consommer.",
        hypotheses: ["Djerba a peut-être réduit son activité : à vérifier."],
        action: { type: "TRANSFERER", produit: "P1", centre: "C3", versCentre: "C1", libelle: "Transférer environ 1800 ml de Djerba vers Tunis." },
      },
    ],
    limites: ["Constats statistiques : ils décrivent ce qui s'est passé, pas pourquoi."],
    ...over,
  });

const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
beforeEach(() => {
  clearAnalysisCache();
  process.env.GEMINI_API_KEY = SECRET;
  delete process.env.GEMINI_MODEL;
});
afterEach(() => {
  if (saved.key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved.key;
  if (saved.model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = saved.model;
});

describe("synthèse sans IA", () => {
  it("un point par constat prioritaire, avec les mêmes chiffres, sans hypothèse inventée", () => {
    const fr = basicAnalysis(report, "fr");
    assert.equal(fr.source, "BASIC");
    assert.equal(fr.priorities.length, 3);
    assert.deepEqual(fr.priorities, report.findings.slice(0, 3).map((f) => f.id));
    const imbalance = fr.items.find((i) => i.findingIds[0] === fid("IMBALANCE"))!;
    assert.match(imbalance.reading, /Tunis n'a plus que 4 jour\(s\) de Shampoing, alors que Djerba en détient 2.000 ml sans le consommer/);
    assert.deepEqual([imbalance.action.type, imbalance.action.productId, imbalance.action.centerId, imbalance.action.toCenterId], ["TRANSFERER", "p1", "c3", "c1"]); // centre = celui qui envoie (Djerba), toCenterId = celui qui reçoit (Tunis)
    assert.match(imbalance.action.label, /1.800 ml de Shampoing de Djerba vers Tunis/);
    assert.ok(fr.items.every((i) => i.hypotheses.length === 0));
    const risk = fr.items.find((i) => i.findingIds[0] === fid("RUPTURE_RISK"))!;
    assert.deepEqual([risk.action.type, risk.action.centerId], ["COMMANDER", "c1"]);
    assert.match(risk.reading, /rupture estimée dans 4 jour\(s\), avant la livraison possible du fournisseur/);
  });

  it("en arabe, et un rapport sans constat le dit", () => {
    const ar = basicAnalysis(report, "ar");
    assert.match(ar.items[0].reading, /[؀-ۿ]/);
    assert.match(ar.title, /حالة/);
    const none = basicAnalysis({ ...report, findings: [] }, "fr");
    assert.deepEqual([none.title, none.items, none.priorities], ["Aucune situation inhabituelle détectée sur cette période.", [], []]);
  });
});

describe("analyse par Gemini", () => {
  it("accepte une réponse conforme : constats reliés, hypothèse, action validée ; envoie des alias, jamais les identifiants ni le secret dans le texte", async () => {
    const { calls, fetchImpl } = fakeGemini(good());
    const result = await analyzeReport(report, "fr", "org1", fetchImpl);
    assert.equal(result.source, "AI");
    assert.deepEqual(result.priorities, [fid("RUPTURE_RISK"), fid("IMBALANCE")]);
    assert.deepEqual(result.items[0].findingIds, [fid("RUPTURE_RISK"), fid("IMBALANCE")]);
    assert.deepEqual(result.items[0].action, { type: "TRANSFERER", productId: "p1", centerId: "c3", toCenterId: "c1", label: "Transférer environ 1800 ml de Djerba vers Tunis." });
    assert.equal(result.items[0].hypotheses.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers["x-goog-api-key"], SECRET);
    assert.ok(!calls[0].body.includes(SECRET));
    assert.match(calls[0].url, /gemini-flash-lite-latest:generateContent$/);
    const prompt = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    assert.match(prompt, /Shampoing/);
    assert.match(prompt, /"constats":\[\{"id":"F1"/);
    assert.ok(!/"(c1|c2|c3|p1)"/.test(prompt.slice(prompt.indexOf("Données"))), "identifiants internes transmis");
  });

  it("accepte du JSON entouré de balises de code, et GEMINI_MODEL change le modèle", async () => {
    process.env.GEMINI_MODEL = "gemini-autre";
    const { calls, fetchImpl } = fakeGemini("```json\n" + good() + "\n```");
    assert.equal((await analyzeReport(report, "fr", "org1", fetchImpl)).source, "AI");
    assert.match(calls[0].url, /models\/gemini-autre:generateContent/);
  });

  it("accepte le nom exact d'un produit ou d'un centre à la place de son identifiant (constaté avec Gemini), mais pas un nom inconnu", async () => {
    const withNames = (produit: string, centre: string, versCentre: string) => good({ analyses: [{ ...JSON.parse(good()).analyses[0], action: { type: "TRANSFERER", produit, centre, versCentre, libelle: "Transférer environ 1800 ml de Djerba vers Tunis." } }] });
    const ok = await analyzeReport(report, "fr", "org-noms", fakeGemini(withNames("Shampoing", "djerba", "Tunis")).fetchImpl);
    assert.equal(ok.source, "AI");
    assert.deepEqual([ok.items[0].action.productId, ok.items[0].action.centerId, ok.items[0].action.toCenterId], ["p1", "c3", "c1"]);
    const unknown = await analyzeReport(report, "fr", "org-noms2", fakeGemini(withNames("Shampoing", "Sfax", "Tunis")).fetchImpl);
    assert.equal(unknown.source, "BASIC");
  });

  const rejected: [string, string][] = [
    ["un nombre inventé", good({ titre: "Tunis sera à court dans 37 jours." })],
    ["un nombre inventé dans une hypothèse", good({ analyses: [{ ...JSON.parse(good()).analyses[0], hypotheses: ["Une hausse de 63 % des rendez-vous."] }] })],
    ["un constat inconnu", good({ priorites: ["F99"] })],
    ["un constat cité inconnu", good({ analyses: [{ ...JSON.parse(good()).analyses[0], constats: ["F99"] }] })],
    ["un produit inconnu", good({ analyses: [{ ...JSON.parse(good()).analyses[0], action: { type: "VERIFIER", produit: "P9", centre: "C1", versCentre: null, libelle: "Vérifier." } }] })],
    ["un centre non cité par les constats", good({ analyses: [{ ...JSON.parse(good()).analyses[0], action: { type: "VERIFIER", produit: "P1", centre: "C2", versCentre: null, libelle: "Vérifier." } }] })],
    ["un transfert dans le mauvais sens", good({ analyses: [{ ...JSON.parse(good()).analyses[0], action: { type: "TRANSFERER", produit: "P1", centre: "C1", versCentre: "C3", libelle: "Transférer." } }] })],
    ["un transfert sans déséquilibre calculé", good({ analyses: [{ ...JSON.parse(good()).analyses[0], constats: [alias("RUPTURE_RISK")] }] })],
    ["une commande sans centre", good({ analyses: [{ ...JSON.parse(good()).analyses[0], action: { type: "COMMANDER", produit: "P1", centre: null, versCentre: null, libelle: "Commander." } }] })],
    ["un type d'action inconnu", good({ analyses: [{ ...JSON.parse(good()).analyses[0], action: { type: "SUPPRIMER", produit: null, centre: null, versCentre: null, libelle: "Supprimer." } }] })],
    ["aucune analyse", good({ analyses: [] })],
    ["du texte qui n'est pas du JSON", "Voici mon analyse : tout va bien."],
  ];
  for (const [label, reply] of rejected) {
    it(`refuse ${label} : synthèse sans IA, et rien n'est gardé en cache`, async () => {
      const { calls, fetchImpl } = fakeGemini(reply);
      const first = await analyzeReport(report, "fr", "org1", fetchImpl);
      assert.equal(first.source, "BASIC");
      await analyzeReport(report, "fr", "org1", fetchImpl);
      assert.equal(calls.length, 2); // une synthèse de secours n'est jamais gardée
    });
  }

  it("sans clé, en cas d'erreur HTTP, réponse vide ou exception : synthèse sans IA ; le secret n'apparaît nulle part", async () => {
    delete process.env.GEMINI_API_KEY;
    const none = fakeGemini(good());
    assert.equal((await analyzeReport(report, "fr", "org1", none.fetchImpl)).source, "BASIC");
    assert.equal(none.calls.length, 0);

    process.env.GEMINI_API_KEY = SECRET;
    for (const reply of [fakeGemini(good(), false), fakeGemini(null), fakeGemini(new Error(`boom ${SECRET}`))]) {
      const logged: unknown[][] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => void logged.push(args);
      try {
        const result = await analyzeReport(report, "fr", "org1", reply.fetchImpl);
        assert.equal(result.source, "BASIC");
        assert.ok(!JSON.stringify(result).includes(SECRET));
      } finally {
        console.error = original;
      }
      // L'exception d'origine peut contenir la clé : seul le message d'erreur est journalisé par le service, jamais le corps de la requête.
      assert.ok(logged.every((args) => !JSON.stringify(args).includes("x-goog-api-key")));
    }
  });

  it("garde en cache une analyse de l'IA (mêmes chiffres, même langue, même organisation) ; une autre organisation ou langue refait l'appel", async () => {
    const { calls, fetchImpl } = fakeGemini(good());
    await analyzeReport(report, "fr", "org1", fetchImpl);
    await analyzeReport(report, "fr", "org1", fetchImpl);
    assert.equal(calls.length, 1);
    await analyzeReport(report, "fr", "org2", fetchImpl);
    assert.equal(calls.length, 2);
    await analyzeReport(report, "ar", "org1", fetchImpl);
    assert.equal(calls.length, 3);
  });

  it("sans constat, Gemini n'est pas appelé (pas de quota gaspillé)", async () => {
    const { calls, fetchImpl } = fakeGemini(good());
    const result = await analyzeReport({ ...report, findings: [] }, "fr", "org1", fetchImpl);
    assert.deepEqual([result.source, calls.length], ["BASIC", 0]);
  });
});

describe("contrôle des nombres", () => {
  it("accepte un nombre brut ou mis en forme présent dans les données, refuse les autres", () => {
    const facts = { stock: 1800, jours: 4, nom: "Lac 2" };
    assert.equal(usesOnlyGivenNumbers(["1800 ml dans 4 jours", "1 800 ml", "١٨٠٠"], facts, "fr"), true);
    assert.equal(usesOnlyGivenNumbers(["Lac 2 : 4 jours"], facts, "fr"), true); // chiffre d'un nom de centre
    assert.equal(usesOnlyGivenNumbers(["dans 5 jours"], facts, "fr"), false);
    assert.equal(usesOnlyGivenNumbers(["aucun nombre ici"], facts, "fr"), true);
  });
});

describe("service : droits et périmètre", () => {
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

  const reply = () => JSON.stringify({ titre: "Gel presque épuisé à Tunis.", priorites: ["F1"], analyses: [{ constats: ["F1"], lecture: "Le gel est à 50 ml, sous son seuil.", hypotheses: [], action: { type: "SURVEILLER", produit: "P1", centre: "C1", versCentre: null, libelle: "Surveiller le stock de gel à Tunis." } }], limites: [] });

  it("recalcule les chiffres côté serveur et fait analyser le périmètre du propriétaire", async () => {
    const gel = expectOk(await createProduct(w.ownerA(), { name: "Gel", unit: "ML" })).product.id;
    expectOk(await activateProductInCenter(w.ownerA(), { productId: gel, centerId: id(w.a1), alertThreshold: 100, initialQuantity: 50 }));
    const { calls, fetchImpl } = fakeGemini(reply);
    const result = expectOk(await analyzeStockConsumption(w.ownerA(), { days: 14, lang: "fr", centerId: "ignoré", organizationId: "ignorée" }, new Date("2030-01-07T09:00:00Z"), fetchImpl));
    assert.equal(result.source, "AI");
    assert.equal(calls.length, 1);
    assert.deepEqual(result.items[0].action.centerId, id(w.a1)); // alias C1 → identifiant réel du centre
  });

  it("un gérant n'envoie à Gemini que les données de ses centres ; une autre organisation n'envoie rien", async () => {
    const gel = expectOk(await createProduct(w.ownerA(), { name: "Gel", unit: "ML" })).product.id;
    expectOk(await activateProductInCenter(w.ownerA(), { productId: gel, centerId: id(w.a1), alertThreshold: 100, initialQuantity: 50 }));
    expectOk(await activateProductInCenter(w.ownerA(), { productId: gel, centerId: id(w.a2), alertThreshold: 100, initialQuantity: 40 }));
    const { calls, fetchImpl } = fakeGemini(reply);
    await analyzeStockConsumption(w.managerA(w.a2), { days: 14 }, new Date("2030-01-07T09:00:00Z"), fetchImpl);
    const prompt = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    assert.match(prompt, /Sousse/);
    assert.ok(!/\bTunis\b|Djerba/.test(prompt)); // (la consigne parle de « Tunisie », pas d'un centre)
    const other = fakeGemini(reply);
    const empty = expectOk(await analyzeStockConsumption(w.ownerB(), { days: 14 }, new Date("2030-01-07T09:00:00Z"), other.fetchImpl));
    assert.deepEqual([empty.source, other.calls.length], ["BASIC", 0]);
  });

  it("refuse les rôles sans droit et une durée invalide", async () => {
    const { calls, fetchImpl } = fakeGemini(reply);
    for (const [, actor] of forbiddenActors(w)) expectFail(await analyzeStockConsumption(actor, { days: 14 }, undefined, fetchImpl), MSG_STOCK_FORBIDDEN);
    assert.equal(expectFail(await analyzeStockConsumption(w.ownerA(), { days: "beaucoup" }, undefined, fetchImpl)).ok, false);
    assert.equal(calls.length, 0);
  });
});
