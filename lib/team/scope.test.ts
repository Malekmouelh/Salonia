// F4 (étape 3) — Périmètre des centres pour la gestion de l'équipe. Tests purs, sans base. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import { canEditStaffHours, teamCenters } from "./scope";

const centers = [
  { id: "c1", name: "Tunis", governorate: "TUNIS" as const },
  { id: "c2", name: "Sousse", governorate: "SOUSSE" as const },
  { id: "c3", name: "Djerba", governorate: "MEDENINE" as const },
];
const user = (role: Role, centerIds: string[], withOrg = true): Pick<CurrentUser, "role" | "organization" | "centerIds"> => ({
  role,
  centerIds,
  organization: withOrg ? { id: "o1", name: "Salon", slug: "salon", centers } : null,
});

describe("teamCenters", () => {
  it("le propriétaire a tous les centres de l'organisation, affecté ou non", () => {
    assert.deepEqual(teamCenters(user("OWNER", [])).map((c) => c.id), ["c1", "c2", "c3"]);
    assert.deepEqual(teamCenters(user("OWNER", ["c1"])).map((c) => c.id), ["c1", "c2", "c3"]);
  });

  it("le gérant n'a que ses centres d'affectation, dans l'ordre de l'organisation", () => {
    assert.deepEqual(teamCenters(user("MANAGER", ["c3", "c1"])).map((c) => c.id), ["c1", "c3"]);
  });

  it("ignore un centre d'affectation qui n'appartient pas à l'organisation", () => {
    assert.deepEqual(teamCenters(user("MANAGER", ["c2", "autre-organisation"])).map((c) => c.id), ["c2"]);
  });

  it("un gérant sans centre n'a aucun périmètre", () => {
    assert.deepEqual(teamCenters(user("MANAGER", [])), []);
  });

  it("les autres rôles n'ont aucun périmètre, même affectés à des centres", () => {
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) assert.deepEqual(teamCenters(user(role, ["c1", "c2"])), [], role);
  });

  it("sans organisation, aucun périmètre", () => {
    assert.deepEqual(teamCenters(user("OWNER", ["c1"], false)), []);
  });

  it("ne renvoie que l'identifiant et le nom du centre", () => {
    assert.deepEqual(teamCenters(user("OWNER", []))[0], { id: "c1", name: "Tunis" });
  });
});

describe("canEditStaffHours (règle des centres partagés)", () => {
  it("le propriétaire modifie tout employé affecté à au moins un centre de l'organisation", () => {
    assert.equal(canEditStaffHours(user("OWNER", []), ["c1"]), true);
    assert.equal(canEditStaffHours(user("OWNER", []), ["c1", "c2", "c3"]), true);
    assert.equal(canEditStaffHours(user("OWNER", []), ["c1", "centre-inconnu"]), true);
  });

  it("le propriétaire ne modifie pas un employé sans aucun centre de son organisation", () => {
    assert.equal(canEditStaffHours(user("OWNER", []), []), false);
    assert.equal(canEditStaffHours(user("OWNER", []), ["autre-organisation"]), false);
  });

  it("le gérant modifie un employé dont tous les centres sont dans son périmètre", () => {
    assert.equal(canEditStaffHours(user("MANAGER", ["c1", "c2"]), ["c1"]), true);
    assert.equal(canEditStaffHours(user("MANAGER", ["c1", "c2"]), ["c1", "c2"]), true);
  });

  it("le gérant ne modifie pas un employé partagé avec un centre qu'il ne gère pas", () => {
    assert.equal(canEditStaffHours(user("MANAGER", ["c1"]), ["c1", "c2"]), false);
    assert.equal(canEditStaffHours(user("MANAGER", ["c1"]), ["c1", "centre-inconnu"]), false);
  });

  it("le gérant ne modifie pas un employé d'un autre centre ni sans centre", () => {
    assert.equal(canEditStaffHours(user("MANAGER", ["c1"]), ["c2"]), false);
    assert.equal(canEditStaffHours(user("MANAGER", ["c1"]), []), false);
    assert.equal(canEditStaffHours(user("MANAGER", []), ["c1"]), false);
  });

  it("les autres rôles et un acteur sans organisation ne modifient rien", () => {
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) assert.equal(canEditStaffHours(user(role, ["c1"]), ["c1"]), false, role);
    assert.equal(canEditStaffHours(user("OWNER", [], false), ["c1"]), false);
  });
});
