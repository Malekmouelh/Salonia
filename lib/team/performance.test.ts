// F4 — Performance d'un employé : indicateurs purs, notation, évaluation par l'IA (SIMULÉE : aucun appel réseau) et droits.
// Base MongoDB éphémère en mémoire pour les droits. Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { evaluatePerformance, buildPrompt, offlineReport } from "@/lib/ai/team-performance";
import { createCenter, createCustomer, createOrg, createUser, insertBooking, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import { StaffTimeOff } from "@/lib/models/team";
import { baselineScores, computeIndicators, gradeFor, overallScore, type PerfBooking } from "./performance";
import { analyzeStaffPerformance } from "./performance-service";

const NOW = new Date("2026-06-30T12:00:00Z");
const day = (n: number, h = 9) => new Date(NOW.getTime() - n * 86_400_000 - 12 * 3_600_000 + h * 3_600_000);
const b = (n: number, status: PerfBooking["status"], extra: Partial<PerfBooking> = {}): PerfBooking => ({
  start: day(n), end: new Date(day(n).getTime() + 60 * 60_000), status, totalTnd: 50, customerId: "c1", serviceNames: ["Coupe"], ...extra,
});

describe("computeIndicators", () => {
  it("compte les statuts, le chiffre d'affaires et le panier moyen", () => {
    const i = computeIndicators([b(1, "COMPLETED"), b(2, "COMPLETED", { totalTnd: 70 }), b(3, "CANCELLED"), b(4, "NO_SHOW")], [], NOW);
    assert.equal(i.completed, 2);
    assert.equal(i.cancelled, 1);
    assert.equal(i.noShow, 1);
    assert.equal(i.revenueTnd, 120);
    assert.equal(i.avgTicketTnd, 60);
    assert.equal(i.completionRate, 0.5);
    assert.equal(i.noShowRate, 0.33);
  });

  it("ignore les rendez-vous hors période et compte les rendez-vous à venir à part", () => {
    const i = computeIndicators([b(40, "COMPLETED"), b(-3, "CONFIRMED"), b(1, "COMPLETED")], [], NOW);
    assert.equal(i.completed, 1);
    assert.equal(i.upcoming, 1);
  });

  it("calcule la présence à partir des absences (lundi-samedi)", () => {
    const timeOff = [{ start: day(5, 0), end: new Date(day(5, 0).getTime() + 2 * 86_400_000) }];
    const i = computeIndicators([], timeOff, NOW);
    assert.ok(i.absentDays >= 1 && i.absentDays <= 3, String(i.absentDays));
    assert.ok(i.presenceRate! < 1);
    assert.equal(computeIndicators([], [], NOW).presenceRate, 1);
  });

  it("clients fidèles et variété des prestations", () => {
    const i = computeIndicators([b(1, "COMPLETED"), b(2, "COMPLETED"), b(3, "COMPLETED", { customerId: "c2", serviceNames: ["Brushing"] })], [], NOW);
    assert.equal(i.uniqueClients, 2);
    assert.equal(i.returningClientsRate, 0.5);
    assert.equal(i.serviceVariety, 2);
  });

  it("sans donnée : taux non mesurables (null), jamais NaN", () => {
    const i = computeIndicators([], [], NOW);
    assert.equal(i.completionRate, null);
    assert.equal(i.avgTicketTnd, null);
    assert.equal(i.occupancyRate, 0);
    for (const v of Object.values(i)) assert.ok(v === null || Number.isFinite(v as number));
  });
});

describe("notation", () => {
  it("note globale = moyenne pondérée des critères mesurables, bornée 0-100", () => {
    assert.equal(overallScore({ reliability: 100, presence: 100, occupancy: 100, revenue: 100, loyalty: 100, versatility: 100 }), 100);
    assert.equal(overallScore({ reliability: 80, presence: null, occupancy: null, revenue: null, loyalty: null, versatility: null }), 80);
    assert.equal(overallScore({ reliability: null }), null);
    assert.equal(gradeFor(85), "A");
    assert.equal(gradeFor(70), "B");
    assert.equal(gradeFor(55), "C");
    assert.equal(gradeFor(10), "D");
    assert.equal(gradeFor(null), null);
  });

  it("un employé fiable a une meilleure fiabilité qu'un employé qui a des absences de clients", () => {
    const good = baselineScores(computeIndicators([b(1, "COMPLETED"), b(2, "COMPLETED"), b(3, "COMPLETED")], [], NOW));
    const bad = baselineScores(computeIndicators([b(1, "COMPLETED"), b(2, "NO_SHOW"), b(3, "NO_SHOW"), b(4, "CANCELLED")], [], NOW));
    assert.ok(good.reliability! > bad.reliability!);
  });
});

const sample = computeIndicators([b(1, "COMPLETED"), b(2, "COMPLETED", { customerId: "c2" }), b(3, "COMPLETED"), b(4, "CANCELLED")], [], NOW);
const goodJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ scores: { reliability: 80, presence: 90, occupancy: 40, revenue: 50, loyalty: 60, versatility: 30 }, summary: "Bon travail.", strengths: ["Régulier"], improvements: ["Remplir le planning"], ...over });

describe("evaluatePerformance (IA simulée)", () => {
  it("le prompt ne contient ni nom, ni client, ni e-mail : seulement des agrégats", () => {
    const prompt = buildPrompt(sample, "Coiffeuse", "fr", baselineScores(sample));
    assert.ok(!/@|c1|c2|Alice|reason|motif/i.test(prompt.replace("motif d'absence", "")), prompt);
    assert.ok(prompt.includes("Coiffeuse"));
  });

  it("accepte une réponse valide et marque la source « ai »", async () => {
    const r = await evaluatePerformance(sample, null, "fr", async () => goodJson());
    assert.equal(r.source, "ai");
    assert.equal(r.summary, "Bon travail.");
    assert.equal(r.criteria.length, 6);
    assert.ok(r.overall !== null && r.overall >= 0 && r.overall <= 100);
  });

  it("accepte du JSON entouré de balises ```json", async () => {
    const r = await evaluatePerformance(sample, null, "fr", async () => "```json\n" + goodJson() + "\n```");
    assert.equal(r.source, "ai");
  });

  it("borne la note de l'IA autour de la note de référence (±25)", async () => {
    const base = baselineScores(sample);
    const r = await evaluatePerformance(sample, null, "fr", async () => goodJson({ scores: { reliability: 100, presence: 0, occupancy: 100, revenue: 100, loyalty: 100, versatility: 100 } }));
    for (const c of r.criteria) {
      if (base[c.key] === null) assert.equal(c.score, null);
      else assert.ok(Math.abs(c.score! - base[c.key]!) <= 25, c.key);
    }
  });

  it("repli hors ligne : réponse invalide, hors schéma, erreur réseau ou absence de clé", async () => {
    for (const ask of [
      async () => "pas du json",
      async () => JSON.stringify({ scores: { reliability: 500 } }),
      async () => { throw new Error("Gemini 500"); },
      async () => null,
    ]) {
      const r = await evaluatePerformance(sample, null, "fr", ask);
      assert.equal(r.source, "offline");
      assert.equal(r.criteria.length, 6);
    }
  });

  it("aucune donnée : pas d'appel à l'IA", async () => {
    let called = false;
    const empty = computeIndicators([], [], NOW);
    const r = await evaluatePerformance(empty, null, "fr", async () => { called = true; return goodJson(); });
    assert.equal(called, false);
    assert.equal(r.source, "offline");
    assert.equal(r.overall, offlineReport(empty).overall);
  });

  it("n'écrit ni clé ni prompt dans le code (structurel)", () => {
    const src = readFileSync(join(process.cwd(), "lib/ai/team-performance.ts"), "utf8");
    assert.ok(src.includes("process.env.GEMINI_API_KEY"));
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(src));
    assert.ok(!/console\.\w+\([^)]*(prompt|raw|key)/i.test(src));
  });
});

describe("analyzeStaffPerformance : droits et données", () => {
  let db: TestDb;
  before(async () => { db = await startTestDb(); });
  after(async () => { await db?.stop(); });
  beforeEach(async () => { await resetTestDb(db); });

  async function world() {
    const org = await createOrg("Salon A");
    const tunis = await createCenter(org._id, "Tunis");
    const sousse = await createCenter(org._id, "Sousse");
    const centers = [tunis, sousse].map((c) => ({ id: String(c._id), name: c.name, governorate: "TUNIS" as const }));
    const staffT = await createUser(org._id, [tunis._id], "Alice", "STAFF");
    const staffS = await createUser(org._id, [sousse._id], "Sonia", "STAFF");
    const manager = await createUser(org._id, [tunis._id], "Mounir", "MANAGER");
    const customer = await createCustomer(org._id);
    return { org, tunis, sousse, centers, staffT, staffS, manager, customer };
  }
  const viewer = (w: Awaited<ReturnType<typeof world>>, role: Role, centerIds: string[] = [], orgOverride?: Awaited<ReturnType<typeof world>>["org"]): CurrentUser => ({
    id: "000000000000000000000001", firstName: "A", lastName: "T", email: null, phone: null, role, lastLoginAt: null, centerIds,
    organization: { id: String((orgOverride ?? w.org)._id), name: "Salon A", slug: w.org.slug, centers: w.centers },
  });
  const ask = async () => goodJson();

  it("le propriétaire analyse tout son personnel ; le gérant seulement ses centres", async () => {
    const w = await world();
    const mgr = viewer(w, "MANAGER", [String(w.tunis._id)]);
    assert.equal((await analyzeStaffPerformance(viewer(w, "OWNER"), String(w.staffS._id), { now: NOW, ask })).ok, true);
    assert.equal((await analyzeStaffPerformance(mgr, String(w.staffT._id), { now: NOW, ask })).ok, true);
    const denied = await analyzeStaffPerformance(mgr, String(w.staffS._id), { now: NOW, ask });
    assert.deepEqual(denied, { ok: false, message: "Employé introuvable." });
  });

  it("refuse STAFF, CLIENT, un gérant (non évalué), un identifiant invalide et une autre organisation", async () => {
    const w = await world();
    for (const role of ["STAFF", "CLIENT"] as Role[]) {
      assert.equal((await analyzeStaffPerformance(viewer(w, role, [String(w.tunis._id)]), String(w.staffT._id), { now: NOW, ask })).ok, false);
    }
    const owner = viewer(w, "OWNER");
    assert.equal((await analyzeStaffPerformance(owner, String(w.manager._id), { now: NOW, ask })).ok, false);
    assert.equal((await analyzeStaffPerformance(owner, "pas-un-id", { now: NOW, ask })).ok, false);
    assert.equal((await analyzeStaffPerformance(owner, { $ne: null }, { now: NOW, ask })).ok, false);
    const other = await createOrg("Autre");
    const otherOwner = viewer(w, "OWNER", [], other);
    otherOwner.organization!.centers = [];
    assert.equal((await analyzeStaffPerformance(otherOwner, String(w.staffT._id), { now: NOW, ask })).ok, false);
  });

  it("calcule les indicateurs à partir des rendez-vous de CET employé uniquement ; le motif d'absence n'est pas envoyé", async () => {
    const w = await world();
    const mk = (staffId: unknown, n: number, status: "COMPLETED" | "NO_SHOW") =>
      insertBooking({ organizationId: w.org._id, centerId: w.tunis._id, staffId: staffId as string, customerId: w.customer._id, start: day(n), minutes: 60, status });
    await mk(w.staffT._id, 1, "COMPLETED");
    await mk(w.staffT._id, 2, "NO_SHOW");
    await mk(w.staffS._id, 3, "COMPLETED");
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.staffT._id, kind: "ABSENCE", start: day(6, 0), end: day(5, 0), allDay: true, reason: "SECRET-MEDICAL" });
    let prompt = "";
    const r = await analyzeStaffPerformance(viewer(w, "OWNER"), String(w.staffT._id), { now: NOW, ask: async (p) => { prompt = p; return goodJson(); } });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.report.indicators.completed, 1);
      assert.equal(r.report.indicators.noShow, 1);
    }
    assert.ok(!prompt.includes("SECRET-MEDICAL") && !prompt.includes("Alice"));
  });

  it("l'action vérifie le rôle et journalise sans note ni indicateur (structurel)", () => {
    const src = readFileSync(join(process.cwd(), "app/actions/team.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function analyzeStaffPerformanceAction"));
    assert.ok(body.indexOf('requireRole("OWNER", "MANAGER")') > -1 && body.indexOf("requireRole") < body.indexOf("analyzeStaffPerformance("));
    assert.ok(body.includes('"STAFF_PERFORMANCE_ANALYZED"'));
    assert.ok(!/detail:[^\n]*(overall|score|indicators)/.test(body));
  });
});
