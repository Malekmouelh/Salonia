// F4 — Suggestion de praticien : classement pur, IA SIMULÉE (aucun appel réseau), droits et conflits en base mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildAssignmentPrompt, suggestPractitioners } from "@/lib/ai/team-assignment";
import { createCenter, createCustomer, createOrg, createService, createUser, insertBooking, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import { AvailabilityBlock } from "@/lib/models/booking";
import { Service } from "@/lib/models/catalog";
import { User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { rankCandidates, scoreCandidate, skillMatch, type Candidate } from "./assignment";
import { suggestPractitionerForSlot } from "./assignment-service";

const cand = (label: string, over: Partial<Candidate> = {}): Candidate => ({ id: `id-${label}`, label, skillMatch: 1, conflict: "none", loadMinutes: 0, performance: 70, ...over });

describe("classement de référence", () => {
  it("skillMatch : part des compétences possédées, insensible à la casse, null si rien d'exigé", () => {
    assert.equal(skillMatch([], ["x"]), null);
    assert.equal(skillMatch(["Coloration", "Coupe"], ["coloration"]), 0.5);
    assert.equal(skillMatch([" coupe "], ["COUPE"]), 1);
  });

  it("un conflit donne 0 et relègue le candidat après les éligibles", () => {
    assert.equal(scoreCandidate(cand("A", { conflict: "booking" })), 0);
    const r = rankCandidates([cand("A", { conflict: "block" }), cand("B", { skillMatch: 0.2 })]);
    assert.deepEqual(r.map((c) => c.label), ["B", "A"]);
    assert.equal(r[1].eligible, false);
  });

  it("compétences, charge et performance font monter le score ; égalité : ordre d'origine", () => {
    const r = rankCandidates([cand("A", { loadMinutes: 1500 }), cand("B", { loadMinutes: 0 }), cand("C", { skillMatch: 0.5 })]);
    assert.deepEqual(r.map((c) => c.label), ["B", "A", "C"]);
    assert.deepEqual(rankCandidates([cand("A"), cand("B")]).map((c) => c.label), ["A", "B"]);
    for (const c of r) assert.ok(c.score >= 0 && c.score <= 100);
  });
});

describe("suggestPractitioners (IA simulée)", () => {
  const set = [cand("A", { loadMinutes: 1200 }), cand("B"), cand("C", { conflict: "booking" })];

  it("le prompt ne contient que des étiquettes et des chiffres, sans les candidats indisponibles", () => {
    const p = buildAssignmentPrompt(rankCandidates(set), ["Coupe"], "fr");
    assert.ok(!p.includes("id-") && !/@/.test(p));
    assert.ok(p.includes('"label":"A"') && p.includes('"label":"B"') && !p.includes('"label":"C"'));
  });

  it("suit l'ordre de l'IA, ignore les étiquettes inconnues, non éligibles ou répétées", async () => {
    const r = await suggestPractitioners(set, ["Coupe"], "fr", async () =>
      JSON.stringify({ ranking: [{ label: "C", reason: "x" }, { label: "A", reason: "plus de pratique" }, { label: "Z", reason: "?" }, { label: "A", reason: "bis" }] }),
    );
    assert.equal(r.source, "ai");
    assert.deepEqual(r.suggestions.map((s) => s.staffId), ["id-A", "id-B"]); // B oublié par l'IA : ajouté ensuite
    assert.equal(r.suggestions[0].reason, "plus de pratique");
    assert.equal(r.blocked, 1);
  });

  it("repli de référence : JSON invalide, hors schéma, erreur réseau, pas de clé, aucun candidat valide", async () => {
    for (const ask of [async () => "nope", async () => JSON.stringify({ ranking: [] }), async () => { throw new Error("Gemini 429"); }, async () => null, async () => JSON.stringify({ ranking: [{ label: "Q", reason: "x" }] })]) {
      const r = await suggestPractitioners(set, ["Coupe"], "fr", ask);
      assert.equal(r.source, "offline");
      assert.deepEqual(r.suggestions.map((s) => s.staffId), ["id-B", "id-A"]);
    }
  });

  it("un seul éligible ou aucun : pas d'appel à l'IA", async () => {
    let called = 0;
    const ask = async () => { called++; return null; };
    assert.equal((await suggestPractitioners([cand("A")], ["x"], "fr", ask)).suggestions.length, 1);
    assert.equal((await suggestPractitioners([cand("A", { conflict: "block" })], ["x"], "fr", ask)).suggestions.length, 0);
    assert.equal(called, 0);
  });
});

describe("suggestPractitionerForSlot : droits, conflits, données", () => {
  let db: TestDb;
  before(async () => { db = await startTestDb(); });
  after(async () => { await db?.stop(); });
  beforeEach(async () => { await resetTestDb(db); });

  const NOW = new Date("2030-06-03T08:00:00Z"); // lundi
  async function world() {
    const org = await createOrg("Salon A");
    const tunis = await createCenter(org._id, "Tunis");
    const sousse = await createCenter(org._id, "Sousse");
    const centers = [tunis, sousse].map((c) => ({ id: String(c._id), name: c.name, governorate: "TUNIS" as const }));
    const alice = await createUser(org._id, [tunis._id], "Alice", "STAFF");
    const bob = await createUser(org._id, [tunis._id], "Bob", "STAFF");
    const carl = await createUser(org._id, [sousse._id], "Carl", "STAFF");
    const service = await createService(org._id, 60, 50, "Coloration");
    const customer = await createCustomer(org._id);
    return { org, tunis, sousse, centers, alice, bob, carl, service, customer };
  }
  type W = Awaited<ReturnType<typeof world>>;
  const viewer = (w: W, role: Role, centerIds: string[] = []): CurrentUser => ({
    id: "000000000000000000000001", firstName: "A", lastName: "T", email: null, phone: null, role, lastLoginAt: null, centerIds,
    organization: { id: String(w.org._id), name: "Salon A", slug: w.org.slug, centers: w.centers },
  });
  const input = (w: W, over: Record<string, unknown> = {}) => ({ centerId: String(w.tunis._id), day: "2030-06-04", time: "10:00", serviceIds: [String(w.service._id)], ...over });
  const noAi = async () => null;
  const slot = new Date("2030-06-04T09:00:00Z"); // 10:00 à Tunis (UTC+1)

  it("propriétaire : praticiens du centre seulement ; gérant : seulement ses centres ; STAFF et CLIENT refusés", async () => {
    const w = await world();
    const r = await suggestPractitionerForSlot(viewer(w, "OWNER"), input(w), { now: NOW, ask: noAi });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.suggestions.map((s) => s.name).sort(), ["Alice Test", "Bob Test"]); // Carl est à Sousse
    const mgr = viewer(w, "MANAGER", [String(w.sousse._id)]);
    assert.deepEqual(await suggestPractitionerForSlot(mgr, input(w), { now: NOW, ask: noAi }), { ok: false, message: "Accès refusé à ce centre." });
    assert.equal((await suggestPractitionerForSlot(mgr, input(w, { centerId: String(w.sousse._id) }), { now: NOW, ask: noAi })).ok, true);
    for (const role of ["STAFF", "CLIENT"] as Role[]) assert.equal((await suggestPractitionerForSlot(viewer(w, role, [String(w.tunis._id)]), input(w), { now: NOW, ask: noAi })).ok, false);
  });

  it("entrées invalides refusées ; prestation d'une autre organisation introuvable", async () => {
    const w = await world();
    const o = viewer(w, "OWNER");
    for (const bad of [null, {}, input(w, { serviceIds: [] }), input(w, { day: "demain" }), input(w, { time: "25:00" }), input(w, { centerId: { $ne: 1 } })]) {
      assert.equal((await suggestPractitionerForSlot(o, bad, { now: NOW, ask: noAi })).ok, false);
    }
    const other = await createOrg("Autre");
    const foreign = await Service.create({ organizationId: other._id, name: "X", category: "T", durationMinutes: 30, priceTnd: 10 });
    assert.deepEqual(await suggestPractitionerForSlot(o, input(w, { serviceIds: [String(foreign._id)] }), { now: NOW, ask: noAi }), { ok: false, message: "Prestation introuvable." });
  });

  it("exclut un praticien déjà réservé, bloqué ou absent sur le créneau ; ignore les rendez-vous annulés", async () => {
    const w = await world();
    const o = viewer(w, "OWNER");
    await insertBooking({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.alice._id, customerId: w.customer._id, start: slot, minutes: 60, status: "CONFIRMED" });
    let r = await suggestPractitionerForSlot(o, input(w), { now: NOW, ask: noAi });
    assert.ok(r.ok && r.suggestions.map((s) => s.name).join() === "Bob Test" && r.blocked === 1);

    await resetTestDb(db);
    const w2 = await world();
    await insertBooking({ organizationId: w2.org._id, centerId: w2.tunis._id, staffId: w2.alice._id, customerId: w2.customer._id, start: slot, minutes: 60, status: "CANCELLED" });
    await AvailabilityBlock.create({ organizationId: w2.org._id, centerId: w2.tunis._id, staffId: w2.bob._id, kind: "BREAK", start: slot, end: new Date(slot.getTime() + 3_600_000) });
    r = await suggestPractitionerForSlot(viewer(w2, "OWNER"), input(w2), { now: NOW, ask: noAi });
    assert.ok(r.ok && r.suggestions.map((s) => s.name).join() === "Alice Test");

    await resetTestDb(db);
    const w3 = await world();
    await StaffTimeOff.create({ organizationId: w3.org._id, userId: w3.alice._id, kind: "LEAVE", start: new Date("2030-06-03T23:00:00Z"), end: new Date("2030-06-05T23:00:00Z"), allDay: true, reason: "SECRET-MEDICAL" });
    r = await suggestPractitionerForSlot(viewer(w3, "OWNER"), input(w3), { now: NOW, ask: noAi });
    assert.ok(r.ok && r.suggestions.map((s) => s.name).join() === "Bob Test");
  });

  it("préfère le praticien qui a les compétences exigées ; désactivés exclus ; prompt sans nom ni motif", async () => {
    const w = await world();
    await Service.updateOne({ _id: w.service._id }, { $set: { requiredSkills: ["Coloration"] } });
    await User.updateOne({ _id: w.bob._id }, { $set: { skills: ["coloration"] } });
    let prompt = "";
    const r = await suggestPractitionerForSlot(viewer(w, "OWNER"), input(w), { now: NOW, ask: async (p) => { prompt = p; return null; } });
    assert.ok(r.ok && r.suggestions[0].name === "Bob Test");
    assert.ok(prompt.includes('"skillMatch":1') && !/Alice|Bob|SECRET/.test(prompt));
    await User.updateOne({ _id: w.bob._id }, { $set: { deactivatedAt: new Date() } });
    const r2 = await suggestPractitionerForSlot(viewer(w, "OWNER"), input(w), { now: NOW, ask: noAi });
    assert.ok(r2.ok && !r2.suggestions.some((s) => s.name === "Bob Test"));
  });

  it("performance inconnue (null) sans historique : pas de 100 par défaut", async () => {
    const w = await world();
    const o = viewer(w, "OWNER");
    let prompt = "";
    await suggestPractitionerForSlot(o, input(w), { now: NOW, ask: async (p) => { prompt = p; return null; } });
    assert.ok(prompt.includes('"performance0to100":null'), prompt);
  });

  it("n'écrit rien en base et l'action est gardée (structurel)", async () => {
    const src = readFileSync(join(process.cwd(), "app/actions/team.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function suggestPractitionerAction"));
    assert.ok(body.indexOf('requireRole("OWNER", "MANAGER")') > -1 && body.indexOf("requireRole") < body.indexOf("suggestPractitionerForSlot("));
    assert.ok(body.includes('"STAFF_ASSIGNMENT_SUGGESTED"') && !/detail:[^\n]*(score|name|reason)/.test(body));
    const svc = readFileSync(join(process.cwd(), "lib/team/assignment-service.ts"), "utf8");
    assert.ok(!/\.(create|update\w*|delete\w*|insertMany|save)\(/.test(svc.replace(/z\.object/g, "")));
  });
});
