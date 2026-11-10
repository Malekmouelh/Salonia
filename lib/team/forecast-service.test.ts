// F4 — Prévision de charge : droits, calcul sur base mémoire, IA simulée (aucun appel réseau). Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { adviseForecast, buildForecastPrompt, offlineAdvice } from "@/lib/ai/team-forecast";
import { createCenter, createCustomer, createOrg, createUser, insertBooking, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import { StaffTimeOff } from "@/lib/models/team";
import { buildForecast, type DayInput } from "./forecast";
import { forecastCenterLoad } from "./forecast-service";

const day = (date: string, over: Partial<DayInput> = {}): DayInput => ({ date, weekday: 1, openMinutes: 600, staffTotal: 2, staffOff: 0, bookedMinutes: 600, ...over });
const flagged = buildForecast([day("2030-06-05", { bookedMinutes: 1100 }), day("2030-06-06", { bookedMinutes: 20 })], "2030-06-05");

describe("adviseForecast (IA simulée)", () => {
  it("le prompt ne contient que des dates et des taux", () => {
    const p = buildForecastPrompt(flagged, "fr");
    assert.ok(p.includes("2030-06-05") && !/@|nom|client:/i.test(p.replace("aucun jugement", "")));
  });
  it("accepte une réponse valide et retire les dates inventées", async () => {
    const r = await adviseForecast(flagged, "fr", async () =>
      JSON.stringify({ summary: "Un jour très chargé.", recommendations: [{ kind: "hours", title: "Étendre", detail: "Ouvrir plus tard.", dates: ["2030-06-05", "2031-01-01"] }] }),
    );
    assert.equal(r.source, "ai");
    assert.deepEqual(r.recommendations[0].dates, ["2030-06-05"]);
  });
  it("repli calculé : JSON invalide, hors schéma, type inconnu, erreur réseau, pas de clé", async () => {
    for (const ask of [async () => "nope", async () => JSON.stringify({ summary: "x", recommendations: [{ kind: "magic", title: "t", detail: "d" }] }), async () => { throw new Error("Gemini 500"); }, async () => null]) {
      const r = await adviseForecast(flagged, "fr", ask);
      assert.equal(r.source, "offline");
      assert.ok(r.recommendations.length > 0);
    }
  });
  it("rien à signaler : pas d'appel à l'IA", async () => {
    let called = false;
    const calm = buildForecast([day("2030-06-05", { bookedMinutes: 600 })], "2030-06-05");
    await adviseForecast(calm, "fr", async () => { called = true; return null; });
    assert.equal(called, false);
    assert.equal(offlineAdvice(calm).recommendations.length, 0);
  });
});

describe("forecastCenterLoad : droits et données", () => {
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
    const customer = await createCustomer(org._id);
    return { org, tunis, sousse, centers, alice, bob, customer };
  }
  type W = Awaited<ReturnType<typeof world>>;
  const viewer = (w: W, role: Role, centerIds: string[] = []): CurrentUser => ({
    id: "000000000000000000000001", firstName: "A", lastName: "T", email: null, phone: null, role, lastLoginAt: null, centerIds,
    organization: { id: String(w.org._id), name: "Salon A", slug: w.org.slug, centers: w.centers },
  });
  const noAi = async () => null;
  const find = (r: Awaited<ReturnType<typeof forecastCenterLoad>>, date: string) => {
    assert.ok(r.ok);
    return r.ok ? r.forecast.days.find((d) => d.date === date)! : undefined!;
  };

  it("propriétaire : tout centre ; gérant : seulement ses centres ; STAFF, CLIENT et entrées invalides refusés", async () => {
    const w = await world();
    const denied = { ok: false, message: "Accès refusé à ce centre." };
    assert.equal((await forecastCenterLoad(viewer(w, "OWNER"), { centerId: String(w.sousse._id) }, { now: NOW, ask: noAi })).ok, true);
    const mgr = viewer(w, "MANAGER", [String(w.tunis._id)]);
    assert.equal((await forecastCenterLoad(mgr, { centerId: String(w.tunis._id) }, { now: NOW, ask: noAi })).ok, true);
    assert.deepEqual(await forecastCenterLoad(mgr, { centerId: String(w.sousse._id) }, { now: NOW, ask: noAi }), denied);
    for (const role of ["STAFF", "CLIENT"] as Role[]) assert.deepEqual(await forecastCenterLoad(viewer(w, role, [String(w.tunis._id)]), { centerId: String(w.tunis._id) }, { now: NOW, ask: noAi }), denied);
    for (const bad of [null, {}, { centerId: "x" }, { centerId: { $ne: 1 } }]) assert.equal((await forecastCenterLoad(viewer(w, "OWNER"), bad, { now: NOW, ask: noAi })).ok, false);
  });

  it("calcule la charge : rendez-vous comptés, annulés ignorés, centre fermé le dimanche", async () => {
    const w = await world();
    const mk = (hourUtc: number, status: "CONFIRMED" | "CANCELLED", minutes = 120) =>
      insertBooking({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.alice._id, customerId: w.customer._id, start: new Date(`2030-06-05T${String(hourUtc).padStart(2, "0")}:00:00Z`), minutes, status });
    await mk(8, "CONFIRMED");
    await mk(11, "CONFIRMED", 60);
    await mk(14, "CANCELLED");
    const r = await forecastCenterLoad(viewer(w, "OWNER"), { centerId: String(w.tunis._id) }, { now: NOW, ask: noAi });
    const d = find(r, "2030-06-05");
    assert.equal(d.bookedMinutes, 180);
    assert.equal(d.capacityMinutes, 2 * 600); // 2 praticiens, 09:00-19:00 par défaut
    assert.equal(find(r, "2030-06-09").status, "closed"); // dimanche
  });

  it("les absences réduisent la capacité ; le motif n'est jamais lu ; un autre centre n'est pas compté", async () => {
    const w = await world();
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "LEAVE", start: new Date("2030-06-04T23:00:00Z"), end: new Date("2030-06-05T23:00:00Z"), allDay: true, reason: "SECRET-MEDICAL" });
    await insertBooking({ organizationId: w.org._id, centerId: w.sousse._id, staffId: w.bob._id, customerId: w.customer._id, start: new Date("2030-06-05T08:00:00Z"), minutes: 300, status: "CONFIRMED" });
    let prompt = "";
    const r = await forecastCenterLoad(viewer(w, "OWNER"), { centerId: String(w.tunis._id) }, { now: NOW, ask: async (p) => { prompt = p; return null; } });
    const d = find(r, "2030-06-05");
    assert.equal(d.staffOff, 1);
    assert.equal(d.capacityMinutes, 600);
    assert.equal(d.bookedMinutes, 0); // la réservation de Sousse n'est pas comptée à Tunis
    assert.ok(!prompt.includes("SECRET-MEDICAL") && !/Alice|Bob/.test(prompt));
  });

  it("l'action vérifie le rôle et journalise sans chiffres ; le service n'écrit rien (structurel)", () => {
    const src = readFileSync(join(process.cwd(), "app/actions/team.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function forecastCenterLoadAction"));
    assert.ok(body.indexOf('requireRole("OWNER", "MANAGER")') > -1 && body.indexOf("requireRole") < body.indexOf("forecastCenterLoad("));
    assert.ok(body.includes('"TEAM_FORECAST_VIEWED"') && !/detail:[^\n]*(rate|summary|forecast)/.test(body));
    const svc = readFileSync(join(process.cwd(), "lib/team/forecast-service.ts"), "utf8");
    assert.ok(!/\.(create|update\w*|delete\w*|insertMany|save)\(/.test(svc.replace(/z\.object/g, "")));
  });
});
