// F4 (étape 2) — Liste de l'équipe en lecture seule : rôles autorisés, périmètre des centres,
// isolation des organisations et comptes anciens. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Types } from "mongoose";
import { createCenter, createOrg, createUser, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import { getTeamRoster } from "@/lib/data/team";
import { User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { fromLocal } from "@/lib/booking/time";

let db: TestDb;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  await resetTestDb(db);
});

type World = Awaited<ReturnType<typeof world>>;

// Un salon de deux centres (Tunis, Sousse) avec du personnel, un gérant par centre et un propriétaire.
async function world() {
  const org = await createOrg("Salon Yasmine");
  const tunis = await createCenter(org._id, "Tunis");
  const sousse = await createCenter(org._id, "Sousse");
  const alice = await createUser(org._id, [tunis._id], "Alice");
  const bob = await createUser(org._id, [sousse._id], "Bob");
  const carla = await createUser(org._id, [tunis._id, sousse._id], "Carla"); // affectée aux deux centres
  const managerTunis = await createUser(org._id, [tunis._id], "Gérant Tunis", "MANAGER");
  const owner = await createUser(org._id, [tunis._id, sousse._id], "Propriétaire", "OWNER");
  const centers = [
    { id: String(tunis._id), name: "Tunis", governorate: "TUNIS" as const },
    { id: String(sousse._id), name: "Sousse", governorate: "SOUSSE" as const },
  ];
  return { org, tunis, sousse, alice, bob, carla, managerTunis, owner, centers };
}

// Utilisateur connecté tel que le fournit lib/dal.ts (getCurrentUser).
function viewer(w: World, role: Role, centerIds: string[], withOrganization = true): CurrentUser {
  return {
    id: "000000000000000000000001",
    firstName: "Test",
    lastName: "Utilisateur",
    email: null,
    phone: null,
    role,
    lastLoginAt: null,
    centerIds,
    organization: withOrganization ? { id: String(w.org._id), name: "Salon Yasmine", slug: w.org.slug, centers: w.centers } : null,
  };
}

const names = (r: Awaited<ReturnType<typeof getTeamRoster>>) => r.members.map((m) => m.firstName);

describe("getTeamRoster : rôles autorisés", () => {
  it("le propriétaire voit tout le personnel (STAFF) de l'organisation, triés par prénom", async () => {
    const w = await world();
    const r = await getTeamRoster(viewer(w, "OWNER", w.centers.map((c) => c.id)));
    assert.deepEqual(names(r), ["Alice", "Bob", "Carla"]); // ni gérant ni propriétaire
    assert.deepEqual(r.centers.map((c) => c.name), ["Tunis", "Sousse"]);
    assert.equal(r.selectedCenterId, null);
  });

  it("le propriétaire voit les centres de l'organisation même sans affectation personnelle", async () => {
    const w = await world();
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(names(r), ["Alice", "Bob", "Carla"]);
  });

  it("le gérant ne voit que le personnel affecté à ses centres", async () => {
    const w = await world();
    const r = await getTeamRoster(viewer(w, "MANAGER", [String(w.tunis._id)]));
    assert.deepEqual(names(r), ["Alice", "Carla"]); // Bob (Sousse seulement) est exclu
    assert.deepEqual(r.centers.map((c) => c.name), ["Tunis"]);
  });

  it("n'affiche à un gérant que ses propres centres, même pour un employé affecté à deux centres", async () => {
    const w = await world();
    const r = await getTeamRoster(viewer(w, "MANAGER", [String(w.tunis._id)]));
    const carla = r.members.find((m) => m.firstName === "Carla");
    assert.deepEqual(carla?.centers.map((c) => c.name), ["Tunis"]);
    const full = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(full.members.find((m) => m.firstName === "Carla")?.centers.map((c) => c.name), ["Tunis", "Sousse"]);
  });

  it("un gérant sans centre ne voit personne", async () => {
    const w = await world();
    const r = await getTeamRoster(viewer(w, "MANAGER", []));
    assert.deepEqual(r, { centers: [], selectedCenterId: null, members: [] });
  });

  it("refuse les autres rôles (STAFF, CLIENT, SUPER_ADMIN), même affectés à un centre", async () => {
    const w = await world();
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) {
      const r = await getTeamRoster(viewer(w, role, w.centers.map((c) => c.id)));
      assert.deepEqual(r, { centers: [], selectedCenterId: null, members: [] }, role);
    }
  });

  it("ne renvoie rien sans organisation", async () => {
    const w = await world();
    assert.deepEqual(await getTeamRoster(viewer(w, "OWNER", [], false)), { centers: [], selectedCenterId: null, members: [] });
  });
});

describe("getTeamRoster : filtre par centre", () => {
  it("limite la liste au centre demandé", async () => {
    const w = await world();
    const owner = viewer(w, "OWNER", []);
    const sousse = await getTeamRoster(owner, { centerId: String(w.sousse._id) });
    assert.deepEqual(names(sousse), ["Bob", "Carla"]);
    assert.equal(sousse.selectedCenterId, String(w.sousse._id));
  });

  it("ignore un centre inconnu, d'une autre organisation ou hors du périmètre du gérant", async () => {
    const w = await world();
    const manager = viewer(w, "MANAGER", [String(w.tunis._id)]);
    const outOfScope = await getTeamRoster(manager, { centerId: String(w.sousse._id) });
    assert.equal(outOfScope.selectedCenterId, null);
    assert.deepEqual(names(outOfScope), ["Alice", "Carla"]); // retombe sur son périmètre, sans révéler Bob

    const otherOrg = await createOrg("Autre salon");
    const foreign = await createCenter(otherOrg._id, "Étranger");
    const unknown = await getTeamRoster(viewer(w, "OWNER", []), { centerId: String(foreign._id) });
    assert.equal(unknown.selectedCenterId, null);
    assert.deepEqual(names(unknown), ["Alice", "Bob", "Carla"]);
    const garbage = await getTeamRoster(viewer(w, "OWNER", []), { centerId: "pas-un-id" });
    assert.equal(garbage.selectedCenterId, null);
  });
});

describe("getTeamRoster : isolation des organisations", () => {
  it("n'inclut jamais le personnel d'une autre organisation", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const otherCenter = await createCenter(other._id, "Ailleurs");
    await createUser(other._id, [otherCenter._id], "Intrus");
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.ok(!names(r).includes("Intrus"));
  });

  it("exclut un employé d'une autre organisation même rattaché à un centre de celle-ci", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    await createUser(other._id, [w.tunis._id], "Incohérent"); // donnée incohérente : mauvais organizationId
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.ok(!names(r).includes("Incohérent"));
  });
});

describe("getTeamRoster : champs facultatifs et comptes anciens", () => {
  async function legacy(w: World, extra: Record<string, unknown> = {}) {
    await User.collection.insertOne({
      organizationId: w.org._id,
      firstName: "Ancienne",
      lastName: "Fiche",
      email: "ancienne@test.local",
      passwordHash: "not-a-real-hash",
      role: "STAFF",
      centerIds: [w.tunis._id],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
  }
  const find = (r: Awaited<ReturnType<typeof getTeamRoster>>, firstName: string) => r.members.find((m) => m.firstName === firstName)!;

  it("affiche un ancien compte sans poste, compétences ni horaires", async () => {
    const w = await world();
    await legacy(w);
    const m = find(await getTeamRoster(viewer(w, "OWNER", [])), "Ancienne");
    assert.equal(m.jobTitle, null);
    assert.deepEqual(m.skills, []);
    assert.equal(m.hasCustomHours, false);
    assert.deepEqual(m.centers, [{ id: String(w.tunis._id), name: "Tunis" }]);
  });

  it("affiche poste, compétences et horaires personnalisés quand ils existent", async () => {
    const w = await world();
    await User.updateOne(
      { _id: w.alice._id },
      { jobTitle: " Coloriste ", skills: ["Coloriste", " ", "Brushing"], workingHours: { lundi: "09:00-17:00", mardi: null } },
    );
    const m = find(await getTeamRoster(viewer(w, "OWNER", [])), "Alice");
    assert.equal(m.jobTitle, "Coloriste");
    assert.deepEqual(m.skills, ["Coloriste", "Brushing"]); // valeur vide ignorée
    assert.equal(m.hasCustomHours, true);
  });

  it("traite workingHours null, vide ou invalide comme « suit le centre »", async () => {
    const w = await world();
    await User.updateOne({ _id: w.alice._id }, { workingHours: null });
    await User.updateOne({ _id: w.bob._id }, { workingHours: {} });
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.equal(find(r, "Alice").hasCustomHours, false);
    assert.equal(find(r, "Bob").hasCustomHours, false);
    await legacy(w, { firstName: "Texte", email: "texte@test.local", workingHours: "9h-17h" });
    assert.equal(find(await getTeamRoster(viewer(w, "OWNER", [])), "Texte").hasCustomHours, false);
  });

  it("expose les horaires individuels en lecture indulgente : valeurs invalides ignorées, hasCustomHours cohérent", async () => {
    const w = await world();
    await User.updateOne({ _id: w.alice._id }, { workingHours: { lundi: " 9:00-17:00 ", mardi: null, mercredi: "n'importe quoi" } });
    await User.updateOne({ _id: w.bob._id }, { workingHours: { lundi: "garbage" } });
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(find(r, "Alice").workingHours, { lundi: "09:00-17:00", mardi: null });
    assert.equal(find(r, "Alice").hasCustomHours, true);
    assert.equal(find(r, "Bob").workingHours, null); // rien de valide : suit le centre
    assert.equal(find(r, "Bob").hasCustomHours, false);
    assert.equal(find(r, "Carla").workingHours, null);
  });

  it("canEditHours : le propriétaire toujours, le gérant seulement si tous les centres de l'employé sont les siens", async () => {
    const w = await world();
    const asOwner = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(asOwner.members.map((m) => [m.firstName, m.canEditHours]), [["Alice", true], ["Bob", true], ["Carla", true]]);
    // Gérant de Tunis : Alice (Tunis seul) modifiable ; Carla (Tunis + Sousse) partagée, donc non modifiable.
    const asManager = await getTeamRoster(viewer(w, "MANAGER", [String(w.tunis._id)]));
    assert.deepEqual(asManager.members.map((m) => [m.firstName, m.canEditHours]), [["Alice", true], ["Carla", false]]);
    // Gérant des deux centres : Carla est entièrement dans son périmètre.
    const both = await getTeamRoster(viewer(w, "MANAGER", w.centers.map((c) => c.id)));
    assert.equal(find(both, "Carla").canEditHours, true);
  });

  it("trie par prénom en ignorant les accents (Alice, Émilie, Zoé)", async () => {
    const w = await world();
    await createUser(w.org._id, [w.tunis._id], "Zoé");
    await createUser(w.org._id, [w.tunis._id], "Émilie");
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(names(r), ["Alice", "Bob", "Carla", "Émilie", "Zoé"]);
  });

  it("renvoie une liste vide, avec les centres, quand il n'y a aucun personnel", async () => {
    const org = await createOrg();
    const c = await createCenter(org._id, "Seul");
    const w = { org, centers: [{ id: String(c._id), name: "Seul", governorate: "TUNIS" as const }] } as unknown as World;
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(r.members, []);
    assert.deepEqual(r.centers.map((x) => x.name), ["Seul"]);
  });

  it("n'expose que les champs nécessaires à l'affichage (ni e-mail, ni téléphone, ni mot de passe)", async () => {
    const w = await world();
    const r = await getTeamRoster(viewer(w, "OWNER", []));
    assert.deepEqual(Object.keys(r.members[0]).sort(), ["canEditHours", "centers", "firstName", "hasCustomHours", "id", "jobTitle", "lastName", "skills", "timeOff", "workingHours"]);
  });
});

describe("getTeamRoster : résumé des absences (en cours / prochaine), sans motif", () => {
  const NOW = fromLocal(2030, 1, 7, 10, 0);
  const SECRET = "Traitement médical confidentiel";
  const add = (w: World, staff: { _id: Types.ObjectId }, kind: "LEAVE" | "ABSENCE", start: Date, end: Date, extra: { reason?: string } = {}) =>
    StaffTimeOff.create({ organizationId: w.org._id, userId: staff._id, kind, start, end, allDay: true, ...extra });
  const summaryOf = (r: Awaited<ReturnType<typeof getTeamRoster>>, name: string) => r.members.find((m) => m.firstName === name)!.timeOff;

  it("sans absence : rien en cours, rien à venir", async () => {
    const w = await world();
    for (const m of (await getTeamRoster(viewer(w, "OWNER", []), { now: NOW })).members) assert.deepEqual(m.timeOff, { current: null, next: null }, m.firstName);
  });

  it("affiche l'absence en cours et la prochaine de chaque employé", async () => {
    const w = await world();
    await add(w, w.alice, "LEAVE", fromLocal(2030, 1, 6), fromLocal(2030, 1, 9), { reason: SECRET });
    await add(w, w.alice, "ABSENCE", fromLocal(2030, 1, 15), fromLocal(2030, 1, 16));
    await add(w, w.bob, "LEAVE", fromLocal(2030, 2, 1), fromLocal(2030, 2, 5));
    const r = await getTeamRoster(viewer(w, "OWNER", []), { now: NOW });
    assert.deepEqual(summaryOf(r, "Alice"), {
      current: { kind: "LEAVE", start: fromLocal(2030, 1, 6).toISOString(), end: fromLocal(2030, 1, 9).toISOString(), allDay: true },
      next: { kind: "ABSENCE", start: fromLocal(2030, 1, 15).toISOString(), end: fromLocal(2030, 1, 16).toISOString(), allDay: true },
    });
    assert.equal(summaryOf(r, "Bob").current, null);
    assert.equal(summaryOf(r, "Bob").next?.kind, "LEAVE");
    assert.deepEqual(summaryOf(r, "Carla"), { current: null, next: null });
  });

  it("ignore les absences terminées ; la fin est exclue et le début inclus", async () => {
    const w = await world();
    await add(w, w.alice, "LEAVE", fromLocal(2030, 1, 1), fromLocal(2030, 1, 3)); // terminée
    await add(w, w.bob, "LEAVE", fromLocal(2030, 1, 5), NOW); // finit pile maintenant : terminée
    await add(w, w.carla, "ABSENCE", NOW, fromLocal(2030, 1, 9)); // commence pile maintenant : en cours
    const r = await getTeamRoster(viewer(w, "OWNER", []), { now: NOW });
    assert.deepEqual(summaryOf(r, "Alice"), { current: null, next: null });
    assert.deepEqual(summaryOf(r, "Bob"), { current: null, next: null });
    assert.equal(summaryOf(r, "Carla").current?.kind, "ABSENCE");
  });

  it("n'expose jamais le motif : ni dans le résumé, ni ailleurs dans la liste de l'équipe", async () => {
    const w = await world();
    await add(w, w.alice, "ABSENCE", fromLocal(2030, 1, 6), fromLocal(2030, 1, 9), { reason: SECRET });
    const r = await getTeamRoster(viewer(w, "OWNER", []), { now: NOW });
    const text = JSON.stringify(r);
    assert.ok(!text.includes("médical") && !text.includes("confidentiel") && !text.includes("reason") && !text.includes(SECRET));
    assert.deepEqual(Object.keys(summaryOf(r, "Alice").current!).sort(), ["allDay", "end", "kind", "start"]);
  });

  it("ne montre que les absences de l'organisation et des employés visibles (gérant limité à son centre)", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    await StaffTimeOff.create({ organizationId: other._id, userId: w.alice._id, kind: "LEAVE", start: fromLocal(2030, 1, 6), end: fromLocal(2030, 1, 9), allDay: true }); // incohérente : autre organisation
    await add(w, w.bob, "LEAVE", fromLocal(2030, 1, 6), fromLocal(2030, 1, 9)); // Bob : Sousse, invisible du gérant de Tunis
    const manager = await getTeamRoster(viewer(w, "MANAGER", [String(w.tunis._id)]), { now: NOW });
    assert.deepEqual(manager.members.map((m) => m.firstName), ["Alice", "Carla"]);
    assert.deepEqual(summaryOf(manager, "Alice"), { current: null, next: null });
    assert.ok(!JSON.stringify(manager).includes(String(w.bob._id)));
  });

  it("les rôles non autorisés ne voient rien, absences comprises", async () => {
    const w = await world();
    await add(w, w.alice, "LEAVE", fromLocal(2030, 1, 6), fromLocal(2030, 1, 9));
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) {
      assert.deepEqual(await getTeamRoster(viewer(w, role, w.centers.map((c) => c.id)), { now: NOW }), { centers: [], selectedCenterId: null, members: [] }, role);
    }
  });
});
