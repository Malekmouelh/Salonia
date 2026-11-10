// Plusieurs clés Gemini : lecture, répartition et passage à la clé suivante. Fetch SIMULÉ (aucun appel réseau).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchWithGeminiKeys, geminiKeys } from "./gemini-keys";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Fetch simulé : répond selon la clé reçue et note les clés utilisées.
function mock(byKey: Record<string, number>) {
  const used: string[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)["x-goog-api-key"];
    used.push(key);
    const status = byKey[key] ?? 200;
    return new Response(status === 400 ? "API key not valid" : "{}", { status });
  }) as typeof fetch;
  return used;
}
const init = (key: string): RequestInit => ({ headers: { "x-goog-api-key": key } });

describe("geminiKeys", () => {
  it("lit GEMINI_API_KEY, GEMINI_API_KEY_2…9 et GEMINI_API_KEYS, sans doublon ni valeur vide", () => {
    const env = { GEMINI_API_KEY: "a", GEMINI_API_KEY_2: "b", GEMINI_API_KEY_5: " c ", GEMINI_API_KEY_3: "", GEMINI_API_KEYS: "d, a ,,e" };
    assert.deepEqual(geminiKeys(env), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(geminiKeys({}), []);
  });
});

describe("fetchWithGeminiKeys", () => {
  const env = { GEMINI_API_KEY: "k1", GEMINI_API_KEY_2: "k2", GEMINI_API_KEY_3: "k3" };

  it("passe à la clé suivante sur quota dépassé (429) ou clé invalide", async () => {
    const used = mock({ k1: 429, k2: 400, k3: 200 });
    const res = await fetchWithGeminiKeys("u", init, { GEMINI_API_KEYS: "k1,k2,k3" });
    // Le point de départ tourne d'un appel à l'autre : on vérifie seulement qu'on finit sur k3.
    assert.equal(res.status, 200);
    assert.equal(used.at(-1), "k3");
  });

  it("ne change pas de clé sur une surcharge du modèle (503) : la clé n'y est pour rien", async () => {
    const used = mock({ k1: 503, k2: 503, k3: 503 });
    const res = await fetchWithGeminiKeys("u", init, env);
    assert.equal(res.status, 503);
    assert.equal(used.length, 1);
  });

  it("toutes les clés en quota : renvoie la dernière réponse (429)", async () => {
    const used = mock({ k1: 429, k2: 429, k3: 429 });
    const res = await fetchWithGeminiKeys("u", init, env);
    assert.equal(res.status, 429);
    assert.equal(used.length, 3);
  });

  it("répartit les appels entre les clés", async () => {
    const used = mock({});
    for (let i = 0; i < 3; i++) await fetchWithGeminiKeys("u", init, env);
    assert.deepEqual([...used].sort(), ["k1", "k2", "k3"]);
  });

  it("sans clé : erreur explicite", async () => {
    await assert.rejects(fetchWithGeminiKeys("u", init, {}), /Aucune clé Gemini/);
  });
});
