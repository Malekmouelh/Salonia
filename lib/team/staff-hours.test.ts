// F4 (étape 4) — Enregistrement des horaires de travail individuels : permissions, cible, validation, écriture
// sans effet de bord et non-régression de la réservation. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { getDaySlots, isSlotAvailable } from "@/lib/booking/availability";
import { MONDAY, createCenter, createCustomer, createOrg, createUser, insertBooking, resetTestDb, startTestDb, at, type TestDb } from "@/lib/booking/test-support";
import { fromLocal } from "@/lib/booking/time";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import { Center, User } from "@/lib/models/core";
import { saveStaffHours, type SaveStaffHoursResult } from "./service";

let db: TestDb;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  mock.restoreAll();
  await resetTestDb(db);
});

type World = Awaited<ReturnType<typeof world>>;
async function world() {
  const org = await createOrg("Salon Yasmine");
  const tunis = await createCenter(org._id, "Tunis");
  const sousse = await createCenter(org._id, "Sousse");
  const alice = await createUser(org._id, [tunis._id], "Alice"); // Tunis seul
  const bob = await createUser(org._id, [sousse._id], "Bob"); // Sousse seul
  const carla = await createUser(org._id, [tunis._id, sousse._id], "Carla"); // partagée
  const centers = [
    { id: String(tunis._id), name: "Tunis", governorate: "TUNIS" as const },
    { id: String(sousse._id), name: "Sousse", governorate: "SOUSSE" as const },
  ];
  return { org, tunis, sousse, alice, bob, carla, centers, tunisId: centers[0].id, sousseId: centers[1].id };
}
function viewer(w: World, role: Role, centerIds: string[], organization = true): CurrentUser {
  return {
    id: "000000000000000000000001",
    firstName: "Acteur",
    lastName: "Test",
    email: null,
    phone: null,
    role,
    lastLoginAt: null,
    centerIds,
    organization: organization ? { id: String(w.org._id), name: "Salon Yasmine", slug: w.org.slug, centers: w.centers } : null,
  };
}
const owner = (w: World) => viewer(w, "OWNER", []);
const manager = (w: World, ...ids: string[]) => viewer(w, "MANAGER", ids);
const NOT_FOUND = "Employé introuvable.";

const failed = (r: SaveStaffHoursResult) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  return r as Extract<SaveStaffHoursResult, { ok: false }>;
};
const saved = (r: SaveStaffHoursResult) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<SaveStaffHoursResult, { ok: true }>;
};
const hoursOf = async (id: unknown) => (await User.findById(id).lean())?.workingHours;

describe("saveStaffHours : enregistrement", () => {
  it("enregistre les trois états : plage, repos et jours absents (comme le centre)", async () => {
    const w = await world();
    const r = saved(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "9:00-17:00", mardi: null, jeudi: "13:30-19:00" }));
    assert.equal(r.changed, true);
    assert.deepEqual(await hoursOf(w.alice._id), { lundi: "09:00-17:00", mardi: null, jeudi: "13:30-19:00" });
  });

  it("remplace l'objet complet : un jour remis « comme le centre » disparaît", async () => {
    const w = await world();
    await saveStaffHours(owner(w), String(w.alice._id), { lundi: "09:00-17:00", mardi: null, mercredi: "10:00-12:00" });
    saved(await saveStaffHours(owner(w), String(w.alice._id), { mercredi: "10:00-12:00" }));
    assert.deepEqual(await hoursOf(w.alice._id), { mercredi: "10:00-12:00" });
    const raw = await User.collection.findOne({ _id: w.alice._id });
    assert.ok(raw && !("lundi" in (raw.workingHours as object)) && !("mardi" in (raw.workingHours as object)));
  });

  it("null et objet vide remettent tous les jours « comme le centre » (null en base)", async () => {
    const w = await world();
    await saveStaffHours(owner(w), String(w.alice._id), { lundi: "09:00-17:00" });
    saved(await saveStaffHours(owner(w), String(w.alice._id), null));
    assert.equal(await hoursOf(w.alice._id), null);
    await saveStaffHours(owner(w), String(w.alice._id), { lundi: "09:00-17:00" });
    saved(await saveStaffHours(owner(w), String(w.alice._id), {}));
    assert.equal(await hoursOf(w.alice._id), null);
  });

  it("sans changement réel : aucune écriture (updatedAt inchangé) et changed = false", async () => {
    const w = await world();
    saved(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "09:00-17:00", mardi: null }));
    const before = (await User.findById(w.alice._id).lean())!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    for (const same of [{ lundi: "09:00-17:00", mardi: null }, { mardi: null, lundi: " 9:00-17:00 " }]) {
      assert.equal(saved(await saveStaffHours(owner(w), String(w.alice._id), same)).changed, false);
    }
    assert.deepEqual((await User.findById(w.alice._id).lean())!.updatedAt, before);
    // Même chose pour un compte sans horaires : null sur null ne change rien.
    assert.equal(saved(await saveStaffHours(owner(w), String(w.bob._id), null)).changed, false);
    assert.equal(saved(await saveStaffHours(owner(w), String(w.bob._id), {})).changed, false);
    assert.equal((await User.findById(w.bob._id).lean())!.updatedAt.getTime(), w.bob.updatedAt.getTime());
  });

  it("nettoie une ancienne valeur invalide en base quand on enregistre", async () => {
    const w = await world();
    await User.collection.updateOne({ _id: w.alice._id }, { $set: { workingHours: { lundi: "n'importe quoi" } } });
    assert.equal(saved(await saveStaffHours(owner(w), String(w.alice._id), null)).changed, true);
    assert.equal(await hoursOf(w.alice._id), null);
  });

  it("ne modifie aucun autre champ de l'employé, ni les horaires des centres", async () => {
    const w = await world();
    await User.updateOne({ _id: w.alice._id }, { jobTitle: "Coloriste", skills: ["Coloriste"] });
    const centerHours = { lundi: "08:00-20:00", dimanche: null };
    await Center.updateOne({ _id: w.tunis._id }, { openingHours: centerHours });
    const beforeUser = await User.findById(w.alice._id).lean();
    const beforeCenter = await Center.findById(w.tunis._id).lean();
    const otherBefore = await User.findById(w.bob._id).lean();

    saved(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "09:00-17:00" }));

    const after = await User.findById(w.alice._id).lean();
    const { workingHours: a1, updatedAt: u1, ...restBefore } = beforeUser!;
    const { workingHours: a2, updatedAt: u2, ...restAfter } = after!;
    assert.deepEqual(restAfter, restBefore); // rôle, organisation, centres, hash, poste, compétences… identiques
    assert.ok(a1 === null && a2 && u1 && u2);
    assert.deepEqual(await Center.findById(w.tunis._id).lean(), beforeCenter);
    assert.deepEqual((await Center.findById(w.tunis._id).lean())?.openingHours, centerHours);
    assert.deepEqual(await User.findById(w.bob._id).lean(), otherBefore); // les autres employés non plus
  });
});

describe("saveStaffHours : validation", () => {
  it("refuse une plage qui passe minuit, avec l'erreur sur le jour concerné, sans rien écrire", async () => {
    const w = await world();
    const r = failed(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "22:00-02:00" }));
    assert.deepEqual(r.errors, { "workingHours.lundi": ["L'heure de fin doit être après l'heure de début."] });
    assert.equal(await hoursOf(w.alice._id), null);
  });

  it("signale tous les jours fautifs à la fois et refuse une plage vide, 24:00 ou un jour inconnu", async () => {
    const w = await world();
    const r = failed(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "", mardi: "09:00-24:00", mercredi: "09:00-09:00", jeudi: "09:00-17:00" }));
    assert.deepEqual(Object.keys(r.errors ?? {}).sort(), ["workingHours.lundi", "workingHours.mardi", "workingHours.mercredi"]);
    const unknown = failed(await saveStaffHours(owner(w), String(w.alice._id), { funday: "09:00-17:00" }));
    assert.ok(unknown.errors && Object.keys(unknown.errors).length > 0);
    assert.equal(await hoursOf(w.alice._id), null); // rien d'enregistré, même pour le jour valide
  });

  it("refuse une valeur qui n'est pas un objet ou null", async () => {
    const w = await world();
    for (const bad of ["texte", 42, [], undefined]) {
      const r = failed(await saveStaffHours(owner(w), String(w.alice._id), bad));
      assert.ok(r.errors || r.message, String(bad));
    }
    assert.equal(await hoursOf(w.alice._id), null);
  });

  it("n'accepte aucune durée minimale : une plage de 15 minutes est valide", async () => {
    const w = await world();
    saved(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "09:00-09:15" }));
    assert.deepEqual(await hoursOf(w.alice._id), { lundi: "09:00-09:15" });
  });
});

describe("saveStaffHours : permissions et cible", () => {
  it("refuse tout rôle autre que propriétaire et gérant, et un acteur sans organisation", async () => {
    const w = await world();
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) {
      assert.equal(failed(await saveStaffHours(viewer(w, role, [w.tunisId]), String(w.alice._id), { lundi: "09:00-17:00" })).message, "Accès refusé.", role);
    }
    assert.equal(failed(await saveStaffHours(viewer(w, "OWNER", [], false), String(w.alice._id), null)).message, "Accès refusé.");
    assert.equal(failed(await saveStaffHours(manager(w), String(w.alice._id), null)).message, "Accès refusé."); // gérant sans centre
    assert.equal(await hoursOf(w.alice._id), null);
  });

  it("le propriétaire modifie les horaires de tout employé de son organisation, y compris multi-centres", async () => {
    const w = await world();
    for (const staff of [w.alice, w.bob, w.carla]) saved(await saveStaffHours(owner(w), String(staff._id), { lundi: "09:00-17:00" }));
    assert.deepEqual(await hoursOf(w.carla._id), { lundi: "09:00-17:00" });
  });

  it("le gérant modifie un employé dont tous les centres sont dans son périmètre", async () => {
    const w = await world();
    saved(await saveStaffHours(manager(w, w.tunisId), String(w.alice._id), { lundi: "09:00-17:00" }));
    saved(await saveStaffHours(manager(w, w.tunisId, w.sousseId), String(w.carla._id), { mardi: null })); // partagée mais entièrement à lui
  });

  it("D1 : le gérant ne modifie pas un employé partagé avec un centre qu'il ne gère pas", async () => {
    const w = await world();
    const r = failed(await saveStaffHours(manager(w, w.tunisId), String(w.carla._id), { lundi: "09:00-17:00" }));
    assert.equal(r.message, NOT_FOUND);
    assert.equal(await hoursOf(w.carla._id), null);
    // Le propriétaire, lui, le peut.
    saved(await saveStaffHours(owner(w), String(w.carla._id), { lundi: "09:00-17:00" }));
  });

  it("le gérant ne modifie pas un employé d'un autre centre", async () => {
    const w = await world();
    assert.equal(failed(await saveStaffHours(manager(w, w.tunisId), String(w.bob._id), null)).message, NOT_FOUND);
    assert.equal(failed(await saveStaffHours(manager(w, w.tunisId), String(w.bob._id), { lundi: "09:00-17:00" })).message, NOT_FOUND);
    assert.equal(await hoursOf(w.bob._id), null);
  });

  it("refuse un employé d'une autre organisation, même affecté à un centre de la nôtre", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const foreignCenter = await createCenter(other._id, "Étranger");
    const foreign = await createUser(other._id, [foreignCenter._id], "Intrus");
    const inconsistent = await createUser(other._id, [w.tunis._id], "Incohérent");
    for (const staff of [foreign, inconsistent]) {
      assert.equal(failed(await saveStaffHours(owner(w), String(staff._id), { lundi: "09:00-17:00" })).message, NOT_FOUND);
      assert.equal(await hoursOf(staff._id), null);
    }
  });

  it("refuse une cible qui n'est pas un STAFF : gérant, propriétaire, client", async () => {
    const w = await world();
    const managerUser = await createUser(w.org._id, [w.tunis._id], "Gérant", "MANAGER");
    const ownerUser = await createUser(w.org._id, [w.tunis._id], "Patron", "OWNER");
    await User.collection.insertOne({ firstName: "Cli", lastName: "Ent", email: "c@test.tn", passwordHash: "x", role: "CLIENT", organizationId: w.org._id, centerIds: [w.tunis._id] });
    const client = await User.findOne({ role: "CLIENT" });
    for (const target of [managerUser, ownerUser, client!]) {
      assert.equal(failed(await saveStaffHours(owner(w), String(target._id), { lundi: "09:00-17:00" })).message, NOT_FOUND);
    }
    assert.equal(await User.countDocuments({ workingHours: { $ne: null } }), 0);
  });

  it("refuse un identifiant invalide ou inexistant, avec le même message", async () => {
    const w = await world();
    for (const id of ["pas-un-id", "", undefined, null, 42, "64b7f0c2a1b2c3d4e5f60718", { $ne: null }]) {
      assert.equal(failed(await saveStaffHours(owner(w), id, { lundi: "09:00-17:00" })).message, NOT_FOUND, JSON.stringify(id));
    }
    assert.equal(await User.countDocuments({ workingHours: { $ne: null } }), 0);
  });

  it("la même réponse pour un employé inaccessible et un employé inexistant (pas de fuite d'information)", async () => {
    const w = await world();
    const unknown = await saveStaffHours(manager(w, w.tunisId), "64b7f0c2a1b2c3d4e5f60718", null);
    const forbidden = await saveStaffHours(manager(w, w.tunisId), String(w.bob._id), null);
    assert.deepEqual(unknown, forbidden);
  });
});

describe("saveStaffHours : erreurs techniques", () => {
  it("répond par un message générique sans exposer d'information", async () => {
    const w = await world();
    mock.method(User, "findOne", () => {
      throw Object.assign(new Error("détail interne"), { name: "MongoNetworkError", code: 6 });
    });
    mock.method(console, "error", () => {});
    assert.deepEqual(await saveStaffHours(owner(w), String(w.alice._id), null), { ok: false, message: "Impossible d'enregistrer les horaires. Réessayez." });
  });
});

describe("non-régression de la réservation (l'intégration des horaires individuels est prévue en phase 2)", () => {
  it("[existant] les horaires individuels n'ont aucun effet sur les créneaux ni sur la disponibilité", async () => {
    const w = await world();
    const customer = await createCustomer(w.org._id);
    await insertBooking({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.alice._id, customerId: customer._id, start: at(10), minutes: 60 });
    const early = fromLocal(2029, 1, 1);
    const snapshot = async () => ({
      slots: await getDaySlots({ organizationId: String(w.org._id), centerId: w.tunisId, day: MONDAY, durationMinutes: 60, now: early }),
      free: await isSlotAvailable({ organizationId: String(w.org._id), centerId: w.tunisId, staffId: String(w.alice._id), start: at(7), durationMinutes: 60, ignoreOpeningHours: true }),
      ok9: await isSlotAvailable({ organizationId: String(w.org._id), centerId: w.tunisId, staffId: String(w.alice._id), start: at(9), durationMinutes: 60 }),
    });
    const before = await snapshot();

    // Alice « ne travaille pas » le lundi, ou seulement de 14 h à 15 h : la réservation ne le sait pas encore.
    saved(await saveStaffHours(owner(w), String(w.alice._id), { lundi: null }));
    assert.deepEqual(await snapshot(), before);
    saved(await saveStaffHours(owner(w), String(w.alice._id), { lundi: "14:00-15:00" }));
    assert.deepEqual(await snapshot(), before);
    assert.ok(before.slots.some((s) => s.start === at(9).toISOString() && s.staffIds.includes(String(w.alice._id))));
  });
});
