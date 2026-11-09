// F4 — Gérants : affectation aux centres, modification et désactivation par le propriétaire (droits, centres, session).
// Base MongoDB éphémère en mémoire. Les gardes sur les actions et sur la connexion sont des tests STRUCTURELS (lecture du
// code source : les actions et next-auth ne s'exécutent pas hors d'une requête Next.js). Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { getPractitioners } from "@/lib/booking/availability";
import { createCenter, createOrg, createUser, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { CurrentUser } from "@/lib/dal";
import { getTeamRoster } from "@/lib/data/team";
import type { Role } from "@/lib/enums";
import { User } from "@/lib/models/core";
import { deactivateManager, updateManager, type DeactivateManagerResult, type UpdateManagerResult } from "./service";

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
async function world() {
  const org = await createOrg("Salon Yasmine");
  const tunis = await createCenter(org._id, "Tunis");
  const sousse = await createCenter(org._id, "Sousse");
  const sfax = await createCenter(org._id, "Sfax");
  const centers = [tunis, sousse, sfax].map((c) => ({ id: String(c._id), name: c.name, governorate: "TUNIS" as const }));
  const manager = await createUser(org._id, [tunis._id], "Mounir", "MANAGER");
  const otherManager = await createUser(org._id, [sousse._id], "Nadia", "MANAGER");
  const staff = await createUser(org._id, [tunis._id], "Alice", "STAFF");
  return { org, tunis, sousse, sfax, centers, manager, otherManager, staff, ids: centers.map((c) => c.id) };
}

function viewer(w: World, role: Role, centerIds: string[] = []): CurrentUser {
  return {
    id: "000000000000000000000001",
    firstName: "Acteur",
    lastName: "Test",
    email: null,
    phone: null,
    role,
    lastLoginAt: null,
    centerIds,
    organization: { id: String(w.org._id), name: "Salon Yasmine", slug: w.org.slug, centers: w.centers },
  };
}
const owner = (w: World) => viewer(w, "OWNER");

const failedUpdate = (r: UpdateManagerResult) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  return r as Extract<UpdateManagerResult, { ok: false }>;
};
const okUpdate = (r: UpdateManagerResult) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<UpdateManagerResult, { ok: true }>;
};
const input = (w: World, extra: Record<string, unknown> = {}) => ({ firstName: "Mounir", lastName: "Test", centerIds: [w.ids[0]], ...extra });
const centersOf = async (id: unknown) => ((await User.findById(id).lean())?.centerIds ?? []).map(String).sort();

describe("updateManager : affectation aux centres et modification", () => {
  it("affecte un gérant à plusieurs centres de l'organisation", async () => {
    const w = await world();
    const r = okUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [w.ids[0], w.ids[1], w.ids[2]] })));
    assert.equal(r.changed, true);
    assert.deepEqual(await centersOf(w.manager._id), [...w.ids].sort());
  });

  it("remplace les centres (un seul centre, un autre centre) et le nom", async () => {
    const w = await world();
    okUpdate(await updateManager(owner(w), String(w.manager._id), { firstName: " Karim ", lastName: "Ben Salah", centerIds: [w.ids[2]] }));
    const user = await User.findById(w.manager._id).lean();
    assert.equal(user?.firstName, "Karim");
    assert.equal(user?.lastName, "Ben Salah");
    assert.deepEqual((user?.centerIds ?? []).map(String), [w.ids[2]]);
  });

  it("ne touche à aucun autre champ : rôle, organisation, identifiants, mot de passe, poste", async () => {
    const w = await world();
    await User.updateOne({ _id: w.manager._id }, { jobTitle: "Gérant(e) de centre", phone: "22111222" });
    const before = await User.findById(w.manager._id).lean();
    okUpdate(
      await updateManager(
        owner(w),
        String(w.manager._id),
        input(w, { centerIds: [w.ids[1]], role: "OWNER", organizationId: String(new Types.ObjectId()), email: "x@x.tn", passwordHash: "forgé", jobTitle: "PDG", deactivatedAt: "2020-01-01" }),
      ),
    );
    const after = await User.findById(w.manager._id).lean();
    for (const key of ["role", "organizationId", "email", "phone", "passwordHash", "jobTitle"] as const) {
      assert.deepEqual(after?.[key], before?.[key], key);
    }
    assert.equal(after?.deactivatedAt, undefined);
  });

  it("sans changement : aucune écriture (updatedAt inchangé)", async () => {
    const w = await world();
    const before = await User.findById(w.manager._id).lean();
    const r = okUpdate(await updateManager(owner(w), String(w.manager._id), { firstName: "Mounir", lastName: "Test", centerIds: [w.ids[0]] }));
    assert.equal(r.changed, false);
    assert.equal((await User.findById(w.manager._id).lean())?.updatedAt?.getTime(), before?.updatedAt?.getTime());
    // L'ordre des centres ne compte pas.
    await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [w.ids[1], w.ids[0]] }));
    const same = okUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [w.ids[0], w.ids[1]] })));
    assert.equal(same.changed, false);
  });

  it("exige au moins un centre, bien formé, de l'organisation ; rien n'est modifié en cas de refus", async () => {
    const w = await world();
    const foreignOrg = await createOrg("Autre salon");
    const foreign = await createCenter(foreignOrg._id, "Étranger");
    const none = failedUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [] })));
    assert.deepEqual(none.errors?.centerIds, ["Choisissez au moins un centre."]);
    assert.ok(failedUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: ["pas-un-id"] }))).errors?.centerIds);
    const mixed = failedUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [w.ids[0], String(foreign._id)] })));
    assert.deepEqual(mixed.errors, { centerIds: ["Centre invalide ou non autorisé."] });
    assert.deepEqual(failedUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [String(new Types.ObjectId())] }))).errors, {
      centerIds: ["Centre invalide ou non autorisé."],
    });
    assert.deepEqual(await centersOf(w.manager._id), [w.ids[0]]);
  });

  it("valide le nom", async () => {
    const w = await world();
    const r = failedUpdate(await updateManager(owner(w), String(w.manager._id), input(w, { firstName: "A", lastName: "" })));
    assert.deepEqual(Object.keys(r.errors ?? {}).sort(), ["firstName", "lastName"]);
  });
});

describe("updateManager et deactivateManager : droits et cibles", () => {
  it("refuse tout acteur autre que le propriétaire, sans rien modifier", async () => {
    const w = await world();
    const target = String(w.otherManager._id);
    const actors = [viewer(w, "MANAGER", [w.ids[0], w.ids[1]]), viewer(w, "STAFF", [w.ids[1]]), viewer(w, "CLIENT"), viewer(w, "SUPER_ADMIN")];
    for (const actor of actors) {
      assert.deepEqual(await updateManager(actor, target, input(w, { centerIds: [w.ids[0]] })), { ok: false, message: "Accès refusé." }, actor.role);
      assert.deepEqual(await deactivateManager(actor, target), { ok: false, message: "Accès refusé." }, actor.role);
    }
    const noOrg = { ...owner(w), organization: null };
    assert.equal((await updateManager(noOrg, target, input(w))).ok, false);
    assert.equal((await deactivateManager(noOrg, target)).ok, false);
    assert.deepEqual(await centersOf(target), [w.ids[1]]);
    assert.equal((await User.findById(target).lean())?.deactivatedAt, undefined);
  });

  it("un gérant ne peut pas se modifier ni se désactiver lui-même", async () => {
    const w = await world();
    const self = viewer(w, "MANAGER", [w.ids[0]]);
    assert.equal((await updateManager(self, String(w.manager._id), input(w, { centerIds: w.ids }))).ok, false);
    assert.equal((await deactivateManager(self, String(w.manager._id))).ok, false);
    assert.deepEqual(await centersOf(w.manager._id), [w.ids[0]]);
  });

  it("même réponse « Gérant introuvable. » pour une cible invalide, inconnue, d'une autre organisation, non gérante ou déjà désactivée", async () => {
    const w = await world();
    const foreignOrg = await createOrg("Autre salon");
    const foreignManager = await createUser(foreignOrg._id, [], "Étranger", "MANAGER");
    const owner2 = await createUser(w.org._id, [w.tunis._id], "Patron", "OWNER");
    await deactivateManager(owner(w), String(w.otherManager._id));
    const targets: unknown[] = [undefined, null, 42, "", "pas-un-id", String(new Types.ObjectId()), String(foreignManager._id), String(w.staff._id), String(owner2._id), String(w.otherManager._id)];
    for (const target of targets) {
      assert.deepEqual(await updateManager(owner(w), target, input(w)), { ok: false, message: "Gérant introuvable." }, String(target));
      assert.deepEqual(await deactivateManager(owner(w), target), { ok: false, message: "Gérant introuvable." }, String(target));
    }
    // Les comptes visés n'ont pas été touchés.
    assert.equal((await User.findById(w.staff._id).lean())?.deactivatedAt, undefined);
    assert.equal((await User.findById(foreignManager._id).lean())?.deactivatedAt, undefined);
    assert.deepEqual(await centersOf(w.staff._id), [w.ids[0]]);
  });
});

describe("deactivateManager : désactivation", () => {
  it("désactive sans rien supprimer : le compte, ses données et ses centres restent en base", async () => {
    const w = await world();
    const now = new Date("2030-05-01T10:00:00Z");
    const r = (await deactivateManager(owner(w), String(w.manager._id), now)) as Extract<DeactivateManagerResult, { ok: true }>;
    assert.equal(r.ok, true);
    assert.deepEqual(r.manager, { id: String(w.manager._id), firstName: "Mounir", lastName: "Test" });
    const user = await User.findById(w.manager._id).lean();
    assert.equal(user?.deactivatedAt?.getTime(), now.getTime());
    assert.equal(user?.role, "MANAGER");
    assert.deepEqual(await centersOf(w.manager._id), [w.ids[0]]);
    assert.equal(await User.countDocuments(), 3);
  });

  it("un second appel est refusé (déjà désactivé) et ne change pas la date", async () => {
    const w = await world();
    const first = new Date("2030-05-01T10:00:00Z");
    await deactivateManager(owner(w), String(w.manager._id), first);
    assert.equal((await deactivateManager(owner(w), String(w.manager._id), new Date("2031-01-01T00:00:00Z"))).ok, false);
    assert.equal((await User.findById(w.manager._id).lean())?.deactivatedAt?.getTime(), first.getTime());
  });

  it("le gérant désactivé disparaît de la liste du propriétaire comme de celle des autres gérants", async () => {
    const w = await world();
    const second = await createUser(w.org._id, [w.tunis._id], "Salma", "MANAGER");
    await deactivateManager(owner(w), String(w.manager._id));
    const names = (v: CurrentUser) => getTeamRoster(v).then((r) => r.members.map((m) => m.firstName));
    assert.deepEqual(await names(owner(w)), ["Alice", "Nadia", "Salma"]);
    assert.deepEqual(await names(viewer(w, "MANAGER", [w.ids[0]])), ["Alice", "Salma"]);
    assert.equal(String(second._id).length, 24);
  });

  it("ne modifie aucun autre compte et n'affecte pas les praticiens réservables", async () => {
    const w = await world();
    await deactivateManager(owner(w), String(w.manager._id));
    assert.equal(await User.countDocuments({ deactivatedAt: { $ne: null } }), 1);
    assert.deepEqual((await getPractitioners(String(w.org._id), w.ids[0])).map((p) => p.id), [String(w.staff._id)]);
  });

  it("un gérant désactivé ne peut plus être modifié, mais le propriétaire peut réaffecter les autres", async () => {
    const w = await world();
    await deactivateManager(owner(w), String(w.manager._id));
    assert.equal((await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: w.ids }))).ok, false);
    okUpdate(await updateManager(owner(w), String(w.otherManager._id), { firstName: "Nadia", lastName: "Test", centerIds: [w.ids[1], w.ids[2]] }));
    assert.deepEqual(await centersOf(w.otherManager._id), [w.ids[1], w.ids[2]].sort());
  });
});

describe("liste de l'équipe : droit de gérer un compte (canManageAccount)", () => {
  it("seul le propriétaire peut gérer un gérant ; jamais le personnel, jamais pour un gérant ou un autre rôle", async () => {
    const w = await world();
    const flags = async (v: CurrentUser) => (await getTeamRoster(v)).members.map((m) => [m.firstName, m.canManageAccount]);
    assert.deepEqual(await flags(owner(w)), [["Alice", false], ["Mounir", true], ["Nadia", true]]);
    assert.deepEqual(await flags(viewer(w, "MANAGER", [w.ids[0]])), [["Alice", false], ["Mounir", false]]);
    assert.deepEqual(await flags(viewer(w, "STAFF", [w.ids[0]])), []);
  });

  it("l'affectation d'un gérant à un nouveau centre le fait apparaître dans la liste de ce centre seulement", async () => {
    const w = await world();
    const inSfax = async () => (await getTeamRoster(owner(w), { centerId: w.ids[2] })).members.map((m) => m.firstName);
    assert.deepEqual(await inSfax(), []);
    await updateManager(owner(w), String(w.manager._id), input(w, { centerIds: [w.ids[0], w.ids[2]] }));
    assert.deepEqual(await inSfax(), ["Mounir"]);
    assert.deepEqual((await getTeamRoster(viewer(w, "MANAGER", [w.ids[2]]))).members.map((m) => m.firstName), ["Mounir"]);
  });
});

describe("garde-fous structurels : actions, session, connexion, audit", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const actions = read("app/actions/team.ts");
  const body = (name: string) => {
    const at = actions.indexOf(`export async function ${name}(`);
    assert.ok(at >= 0, name);
    const next = actions.indexOf("\nexport async function ", at + 10);
    return actions.slice(at, next < 0 ? undefined : next);
  };

  it("les deux actions exigent requireRole('OWNER') avant tout appel au service", () => {
    for (const [name, service] of [["updateManagerAction", "updateManager("], ["deactivateManagerAction", "deactivateManager("]] as const) {
      const b = body(name);
      const role = b.indexOf('requireRole("OWNER")');
      assert.ok(role >= 0, `${name} : requireRole('OWNER') manquant`);
      assert.ok(b.indexOf(service) > role, `${name} : le service est appelé avant la vérification du rôle`);
    }
  });

  it("l'audit utilise STAFF_UPDATED et STAFF_DEACTIVATED, sans mot de passe ni hash, et pas quand rien ne change", () => {
    const update = body("updateManagerAction");
    assert.match(update, /logEvent\("STAFF_UPDATED"/);
    assert.ok(update.indexOf("!result.changed") < update.indexOf("logEvent("), "la modification sans changement ne doit pas journaliser");
    assert.match(body("deactivateManagerAction"), /logEvent\("STAFF_DEACTIVATED"/);
    for (const name of ["updateManagerAction", "deactivateManagerAction"]) assert.doesNotMatch(body(name), /password|passwordHash|hash/i, name);
  });

  it("la session et la connexion refusent un compte désactivé", () => {
    assert.match(read("lib/dal.ts"), /!user \|\| user\.deactivatedAt\) redirect\("\/api\/auth\/expired"\)/);
    const auth = read("auth.ts");
    assert.match(auth, /user\.deactivatedAt\) return null/); // mot de passe
    assert.match(auth, /deactivatedAt\?: Date \| null \}\)\.deactivatedAt\) return null/); // MetaMask
  });

  it("les nouveaux événements existent dans l'énumération et dans le journal de sécurité", () => {
    for (const type of ["STAFF_UPDATED", "STAFF_DEACTIVATED"]) {
      assert.match(read("lib/enums.ts"), new RegExp(`"${type}"`));
      assert.match(read("components/dashboard/security-log.tsx"), new RegExp(`${type}:`));
    }
  });
});
