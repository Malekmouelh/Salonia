// askGemini : un seul nouvel essai sur erreur temporaire, aucun sur erreur définitive ; jamais de clé dans les erreurs. Fetch SIMULÉ.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { askGemini } from "./team-performance";

const realFetch = globalThis.fetch;
const reply = (status: number, text = "{}") =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
let calls = 0;
const mock = (...steps: (Response | Error)[]) => {
  calls = 0;
  globalThis.fetch = (async () => {
    const step = steps[Math.min(calls++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step.clone();
  }) as typeof fetch;
};
beforeEach(() => { process.env.GEMINI_API_KEY = "test-key-not-real"; });
afterEach(() => { globalThis.fetch = realFetch; delete process.env.GEMINI_API_KEY; });

describe("askGemini : nouvel essai limité", () => {
  it("réessaie une fois après un délai dépassé puis réussit", async () => {
    mock(new Error("aborted"), reply(200, '{"ok":1}'));
    assert.equal(await askGemini("p"), '{"ok":1}');
    assert.equal(calls, 2);
  });
  it("réessaie une fois après 503 ou 429, puis abandonne (2 appels maximum)", async () => {
    for (const status of [503, 429]) {
      mock(reply(status), reply(status), reply(200));
      await assert.rejects(askGemini("p"), new RegExp(`Gemini ${status}`));
      assert.equal(calls, 2);
    }
  });
  it("ne réessaie pas sur une erreur définitive (400, 403)", async () => {
    for (const status of [400, 403]) {
      mock(reply(status), reply(200));
      await assert.rejects(askGemini("p"), new RegExp(`Gemini ${status}`));
      assert.equal(calls, 1);
    }
  });
  it("sans clé : aucun appel ; l'erreur ne contient jamais la clé", async () => {
    delete process.env.GEMINI_API_KEY;
    mock(reply(200));
    assert.equal(await askGemini("p"), null);
    assert.equal(calls, 0);
    process.env.GEMINI_API_KEY = "secret-xyz";
    mock(new Error("boom secret-xyz"), new Error("boom secret-xyz"));
    await assert.rejects(askGemini("p"), (e: Error) => !e.message.includes("secret-xyz"));
  });
});
