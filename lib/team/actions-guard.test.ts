// F4 (étape 5c) — Garde-fous sur les Server Actions d'équipe. Test STRUCTUREL : il lit le code source de
// app/actions/team.ts (les actions ne peuvent pas être appelées hors d'une requête Next.js : cookies, session).
// Il complète les tests du service, qui portent sur le comportement réel. Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(join(process.cwd(), "app/actions/team.ts"), "utf8");

// Corps de chaque fonction exportée.
function functionBodies() {
  const bodies = new Map<string, string>();
  const re = /export async function (\w+)\([^)]*\)[^{]*\{/g;
  const starts = [...source.matchAll(re)].map((m) => ({ name: m[1], at: m.index! }));
  starts.forEach((s, i) => bodies.set(s.name, source.slice(s.at, starts[i + 1]?.at ?? source.length)));
  return bodies;
}
const bodies = functionBodies();
const TIMEOFF_ACTIONS = ["createStaffTimeOffAction", "updateStaffTimeOffAction", "deleteStaffTimeOffAction", "listStaffTimeOffAction"];

describe("actions d'absences : structure du code", () => {
  it("les quatre actions existent et sont exportées", () => {
    for (const name of TIMEOFF_ACTIONS) assert.ok(bodies.has(name), name);
  });

  it("chaque action commence par requireRole('OWNER', 'MANAGER') avant tout accès au service", () => {
    for (const name of TIMEOFF_ACTIONS) {
      const body = bodies.get(name)!;
      const role = body.indexOf('requireRole("OWNER", "MANAGER")');
      const service = body.search(/(create|update|delete|list)StaffTimeOff\(/);
      assert.ok(role >= 0, `${name} : requireRole manquant`);
      assert.ok(service > role, `${name} : le service est appelé avant la vérification du rôle`);
    }
  });

  it("l'audit utilise exactement les trois événements prévus, avec un détail construit sans motif", () => {
    const calls = [...source.matchAll(/logEvent\("(STAFF_TIMEOFF_[A-Z]+)",[\s\S]*?\);/g)];
    assert.deepEqual(calls.map((c) => c[1]).sort(), ["STAFF_TIMEOFF_CREATED", "STAFF_TIMEOFF_DELETED", "STAFF_TIMEOFF_UPDATED"]);
    for (const call of calls) {
      assert.match(call[0], /detail: timeOffAuditDetail\(/, call[1]);
      assert.doesNotMatch(call[0], /reason|motif/i, call[1]);
    }
  });

  it("aucun appel d'audit de l'ensemble du fichier ne mentionne un motif", () => {
    for (const call of source.matchAll(/logEvent\([\s\S]*?\);/g)) assert.doesNotMatch(call[0], /reason|motif/i, call[0]);
  });

  it("la modification sans changement ne journalise ni n'invalide rien : le retour précède l'audit", () => {
    const body = bodies.get("updateStaffTimeOffAction")!;
    const early = body.indexOf("if (!result.changed) return");
    assert.ok(early >= 0);
    assert.ok(early < body.indexOf("logEvent("));
    assert.ok(early < body.indexOf("revalidatePath("));
  });

  it("l'audit n'est écrit qu'après un succès du service, et la lecture n'écrit rien", () => {
    for (const name of ["createStaffTimeOffAction", "updateStaffTimeOffAction", "deleteStaffTimeOffAction"]) {
      const body = bodies.get(name)!;
      assert.ok(body.indexOf("if (!result.ok) return result;") < body.indexOf("logEvent("), name);
    }
    const list = bodies.get("listStaffTimeOffAction")!;
    assert.doesNotMatch(list, /logEvent|revalidatePath|updateTag/);
  });

  it("les actions ne lisent jamais le corps du formulaire pour l'organisation ou l'auteur : elles utilisent la session", () => {
    for (const name of TIMEOFF_ACTIONS) {
      const body = bodies.get(name)!;
      assert.match(body, /user\.organization/);
      assert.doesNotMatch(body, /organizationId:\s*(raw|input)/);
    }
  });
});
