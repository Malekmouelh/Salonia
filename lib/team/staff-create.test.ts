// F4 (étape 3) — Création d'un compte STAFF : validation, autorisation, centres, unicité, concurrence
// et protection contre l'escalade de privilèges. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { getPractitioners } from "@/lib/booking/availability";
import { createCenter, createOrg, createUser, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import type { CurrentUser } from "@/lib/dal";
import { getTeamRoster } from "@/lib/data/team";
import type { Role } from "@/lib/enums";
import { User } from "@/lib/models/core";
import { createStaffAccount, duplicateFields, type CreateStaffResult } from "./service";

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
  await User.syncIndexes(); // la base est vidée entre les tests : on recrée les index uniques (e-mail, téléphone)
});

const PASSWORD = "Temp1234";

type World = Awaited<ReturnType<typeof world>>;
async function world() {
  const org = await createOrg("Salon Yasmine");
  const tunis = await createCenter(org._id, "Tunis");
  const sousse = await createCenter(org._id, "Sousse");
  const centers = [
    { id: String(tunis._id), name: "Tunis", governorate: "TUNIS" as const },
    { id: String(sousse._id), name: "Sousse", governorate: "SOUSSE" as const },
  ];
  return { org, tunis, sousse, centers, tunisId: centers[0].id, sousseId: centers[1].id };
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

const input = (w: World, extra: Record<string, unknown> = {}) => ({
  firstName: "Sara",
  lastName: "Ben Ali",
  email: "sara@test.tn",
  phone: "",
  password: PASSWORD,
  centerIds: [w.tunisId],
  ...extra,
});

const failed = (r: CreateStaffResult) => {
  assert.equal(r.ok, false);
  return r as Extract<CreateStaffResult, { ok: false }>;
};
const created = (r: CreateStaffResult) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r as Extract<CreateStaffResult, { ok: true }>;
};
const staffCount = () => User.countDocuments({ role: "STAFF" });

describe("createStaffAccount : création", () => {
  it("crée un compte STAFF dans l'organisation de l'acteur, avec les champs normalisés", async () => {
    const w = await world();
    const r = created(
      await createStaffAccount(
        owner(w),
        input(w, { email: " Sara@Test.TN ", phone: "+216 22 345 678", jobTitle: " Coloriste ", skills: ["Coloriste", "coloriste", "Brushing"], centerIds: [w.tunisId, w.sousseId] }),
      ),
    );
    const user = await User.findById(r.staff.id).lean();
    assert.equal(user?.role, "STAFF");
    assert.equal(String(user?.organizationId), String(w.org._id));
    assert.equal(user?.email, "sara@test.tn");
    assert.equal(user?.phone, "22345678");
    assert.equal(user?.jobTitle, "Coloriste");
    assert.deepEqual(user?.skills, ["Coloriste", "Brushing"]);
    assert.deepEqual((user?.centerIds ?? []).map(String).sort(), [w.tunisId, w.sousseId].sort());
    assert.equal(user?.workingHours, null);
    assert.equal(user?.lastLoginAt, undefined);
    assert.deepEqual(r.staff, { id: String(user?._id), firstName: "Sara", lastName: "Ben Ali" });
  });

  it("accepte un seul identifiant, sans écrire de valeur vide en base (index uniques « sparse »)", async () => {
    const w = await world();
    const a = created(await createStaffAccount(owner(w), input(w, { email: "a@test.tn", phone: "" })));
    const b = created(await createStaffAccount(owner(w), input(w, { email: "", phone: "22 111 222" })));
    const c = created(await createStaffAccount(owner(w), input(w, { email: "c@test.tn", phone: undefined })));
    const rawA = await User.collection.findOne({ _id: new Types.ObjectId(a.staff.id) });
    const rawB = await User.collection.findOne({ _id: new Types.ObjectId(b.staff.id) });
    assert.ok(rawA && !("phone" in rawA));
    assert.ok(rawB && !("email" in rawB));
    assert.ok(c.staff.id);
  });

  it("stocke un hash bcrypt de coût 12, jamais le mot de passe", async () => {
    const w = await world();
    const r = created(await createStaffAccount(owner(w), input(w)));
    const user = await User.findById(r.staff.id).lean();
    assert.notEqual(user?.passwordHash, PASSWORD);
    assert.ok(!user?.passwordHash.includes(PASSWORD));
    assert.equal(bcrypt.getRounds(user!.passwordHash), 12);
    assert.equal(await bcrypt.compare(PASSWORD, user!.passwordHash), true);
    assert.equal(await bcrypt.compare("autre-mot-de-passe1", user!.passwordHash), false);
  });

  it("ne renvoie jamais le mot de passe ni le hash, en cas de succès comme d'échec", async () => {
    const w = await world();
    const ok = await createStaffAccount(owner(w), input(w));
    const dup = await createStaffAccount(owner(w), input(w)); // doublon
    const invalid = await createStaffAccount(owner(w), input(w, { email: "x", password: "SecretSansChiffre" }));
    const denied = await createStaffAccount(viewer(w, "STAFF", [w.tunisId]), input(w, { email: "z@test.tn" }));
    const hash = (await User.findOne({ email: "sara@test.tn" }).lean())!.passwordHash;
    for (const result of [ok, dup, invalid, denied]) {
      const text = JSON.stringify(result);
      assert.ok(!text.includes(PASSWORD) && !text.includes("SecretSansChiffre") && !text.includes(hash) && !text.includes("passwordHash"));
    }
  });

  it("le compte est retrouvé par e-mail comme par téléphone et accepte le mot de passe fourni", async () => {
    const w = await world();
    created(await createStaffAccount(owner(w), input(w, { phone: "22 345 678" })));
    for (const query of [{ email: "sara@test.tn" }, { phone: "22345678" }]) {
      const user = await User.findOne(query).lean();
      assert.equal(await bcrypt.compare(PASSWORD, user!.passwordHash), true);
    }
  });

  it("[existant] le nouveau membre devient aussitôt praticien du centre, donc réservable en ligne", async () => {
    // Comportement actuel de la réservation (getPractitioners), volontairement inchangé par F4.
    const w = await world();
    const r = created(await createStaffAccount(manager(w, w.tunisId), input(w)));
    assert.deepEqual((await getPractitioners(String(w.org._id), w.tunisId)).map((p) => p.id), [r.staff.id]);
    assert.equal((await getPractitioners(String(w.org._id), w.sousseId)).length, 0);
  });

  it("apparaît dans la liste de l'équipe du propriétaire et du gérant du centre, pas d'un gérant d'un autre centre", async () => {
    const w = await world();
    created(await createStaffAccount(owner(w), input(w)));
    assert.deepEqual((await getTeamRoster(owner(w))).members.map((m) => m.firstName), ["Sara"]);
    assert.deepEqual((await getTeamRoster(manager(w, w.tunisId))).members.map((m) => m.firstName), ["Sara"]);
    assert.deepEqual((await getTeamRoster(manager(w, w.sousseId))).members, []);
  });
});

describe("createStaffAccount : validation", () => {
  it("signale chaque champ invalide sans rien créer", async () => {
    const w = await world();
    const r = failed(await createStaffAccount(owner(w), input(w, { firstName: "S", lastName: "", email: "x", phone: "12", password: "abc", centerIds: [] })));
    assert.deepEqual(Object.keys(r.errors ?? {}).sort(), ["centerIds", "email", "firstName", "lastName", "password", "phone"]);
    assert.equal(await staffCount(), 0);
  });

  it("refuse l'absence d'e-mail et de téléphone", async () => {
    const w = await world();
    const r = failed(await createStaffAccount(owner(w), input(w, { email: "", phone: "" })));
    assert.deepEqual(r.errors?.email, ["Renseignez un e-mail ou un numéro de téléphone."]);
  });

  it("refuse un mot de passe de plus de 72 octets UTF-8", async () => {
    const w = await world();
    failed(await createStaffAccount(owner(w), input(w, { password: "a1" + "x".repeat(71) })));
    failed(await createStaffAccount(owner(w), input(w, { password: "1a" + "é".repeat(36) })));
    created(await createStaffAccount(owner(w), input(w, { password: "a1" + "x".repeat(70) })));
  });

  it("refuse une entrée qui n'est pas un objet", async () => {
    const w = await world();
    for (const bad of [null, undefined, "texte", 42, []]) {
      const r = failed(await createStaffAccount(owner(w), bad));
      assert.ok(r.message || r.errors, String(bad));
    }
    assert.equal(await staffCount(), 0);
  });
});

describe("createStaffAccount : autorisation et centres", () => {
  it("refuse tout rôle autre que propriétaire et gérant, et un acteur sans organisation", async () => {
    const w = await world();
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) {
      const r = failed(await createStaffAccount(viewer(w, role, [w.tunisId]), input(w)));
      assert.equal(r.message, "Accès refusé.", role);
    }
    assert.equal(failed(await createStaffAccount(viewer(w, "OWNER", [], false), input(w))).message, "Accès refusé.");
    assert.equal(await staffCount(), 0);
  });

  it("un gérant sans centre ne peut rien créer", async () => {
    const w = await world();
    assert.equal(failed(await createStaffAccount(manager(w), input(w))).message, "Accès refusé.");
  });

  it("le gérant peut affecter à ses centres, mais pas à un autre centre de l'organisation", async () => {
    const w = await world();
    created(await createStaffAccount(manager(w, w.tunisId), input(w, { email: "a@test.tn", centerIds: [w.tunisId] })));
    const r = failed(await createStaffAccount(manager(w, w.tunisId), input(w, { email: "b@test.tn", centerIds: [w.sousseId] })));
    assert.deepEqual(r.errors?.centerIds, ["Centre invalide ou non autorisé."]);
    assert.equal(await User.countDocuments({ email: "b@test.tn" }), 0);
  });

  it("un seul centre hors périmètre annule toute la création (pas d'affectation partielle)", async () => {
    const w = await world();
    failed(await createStaffAccount(manager(w, w.tunisId), input(w, { centerIds: [w.tunisId, w.sousseId] })));
    assert.equal(await staffCount(), 0);
  });

  it("le propriétaire peut affecter à n'importe quel centre de son organisation", async () => {
    const w = await world();
    const r = created(await createStaffAccount(owner(w), input(w, { centerIds: [w.tunisId, w.sousseId] })));
    assert.equal((await User.findById(r.staff.id).lean())?.centerIds.length, 2);
  });

  it("refuse un centre d'une autre organisation ou inexistant, même pour le propriétaire", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const foreign = await createCenter(other._id, "Étranger");
    for (const id of [String(foreign._id), "64b7f0c2a1b2c3d4e5f60718"]) {
      const r = failed(await createStaffAccount(owner(w), input(w, { centerIds: [id] })));
      assert.deepEqual(r.errors?.centerIds, ["Centre invalide ou non autorisé."]);
    }
    assert.equal(await staffCount(), 0);
  });
});

describe("createStaffAccount : escalade de privilèges", () => {
  it("ignore le rôle, l'organisation, le hash et l'identifiant fournis par le formulaire", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const forgedId = "64b7f0c2a1b2c3d4e5f60718";
    const r = created(
      await createStaffAccount(
        manager(w, w.tunisId),
        input(w, { role: "OWNER", organizationId: String(other._id), passwordHash: "forgé", _id: forgedId, lastLoginAt: "2020-01-01", centerIds: [w.tunisId] }),
      ),
    );
    const user = await User.findById(r.staff.id).lean();
    assert.equal(user?.role, "STAFF");
    assert.equal(String(user?.organizationId), String(w.org._id));
    assert.notEqual(String(user?._id), forgedId);
    assert.notEqual(user?.passwordHash, "forgé");
    assert.equal(await bcrypt.compare(PASSWORD, user!.passwordHash), true);
    assert.equal(user?.lastLoginAt, undefined);
  });

  it("un gérant ou un propriétaire ne crée jamais de gérant ni de propriétaire, même en le demandant", async () => {
    const w = await world();
    created(await createStaffAccount(manager(w, w.tunisId), input(w, { role: "MANAGER" })));
    created(await createStaffAccount(owner(w), input(w, { email: "b@test.tn", role: "OWNER" })));
    assert.equal(await User.countDocuments({ role: { $in: ["OWNER", "MANAGER"] } }), 0);
    assert.equal(await staffCount(), 2);
  });
});

describe("createStaffAccount : unicité et concurrence", () => {
  it("refuse un e-mail déjà utilisé, sans tenir compte de la casse, avec un message précis", async () => {
    const w = await world();
    created(await createStaffAccount(owner(w), input(w)));
    const r = failed(await createStaffAccount(owner(w), input(w, { email: "SARA@test.tn" })));
    assert.deepEqual(r.errors, { email: ["Cet e-mail est déjà utilisé."] });
    assert.equal(await User.countDocuments({ email: "sara@test.tn" }), 1);
  });

  it("refuse un téléphone déjà utilisé, avec ou sans l'indicatif +216", async () => {
    const w = await world();
    created(await createStaffAccount(owner(w), input(w, { email: "", phone: "22 345 678" })));
    for (const phone of ["22345678", "+21622345678", "0021622 345 678"]) {
      const r = failed(await createStaffAccount(owner(w), input(w, { email: "", phone })));
      assert.deepEqual(r.errors, { phone: ["Ce numéro est déjà utilisé."] }, phone);
    }
  });

  it("signale les deux champs quand les deux sont déjà pris", async () => {
    const w = await world();
    created(await createStaffAccount(owner(w), input(w, { phone: "22 345 678" })));
    const r = failed(await createStaffAccount(owner(w), input(w, { phone: "22345678" })));
    assert.deepEqual(Object.keys(r.errors ?? {}).sort(), ["email", "phone"]);
  });

  it("l'unicité est globale : un compte client ou d'une autre organisation bloque aussi", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const otherCenter = await createCenter(other._id);
    await createUser(other._id, [otherCenter._id], "Existant");
    await User.collection.insertOne({ firstName: "Cli", lastName: "Ent", email: "client@test.tn", phone: "55123456", passwordHash: "x", role: "CLIENT", organizationId: null, centerIds: [] });
    failed(await createStaffAccount(owner(w), input(w, { email: "client@test.tn" })));
    failed(await createStaffAccount(owner(w), input(w, { email: "", phone: "55123456" })));
    const foreign = (await User.findOne({ firstName: "Existant" }).lean())!.email!;
    failed(await createStaffAccount(owner(w), input(w, { email: foreign })));
  });

  it("des créations simultanées avec le même e-mail : une seule réussit, les autres reçoivent une erreur de champ", async () => {
    const w = await world();
    const results = await Promise.all(Array.from({ length: 6 }, () => createStaffAccount(owner(w), input(w))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    for (const r of results.filter((x) => !x.ok)) assert.deepEqual((r as { errors?: unknown }).errors, { email: ["Cet e-mail est déjà utilisé."] });
    assert.equal(await User.countDocuments({ email: "sara@test.tn" }), 1);
  });

  it("des créations simultanées avec le même téléphone : une seule réussit", async () => {
    const w = await world();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => createStaffAccount(owner(w), input(w, { email: `n${i}@test.tn`, phone: "22 345 678" }))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    for (const r of results.filter((x) => !x.ok)) assert.deepEqual((r as { errors?: unknown }).errors, { phone: ["Ce numéro est déjà utilisé."] });
    assert.equal(await User.countDocuments({ phone: "22345678" }), 1);
  });

  it("transforme l'erreur d'index unique de MongoDB en erreur de champ quand la pré-vérification ne voit pas le doublon", async () => {
    const w = await world();
    created(await createStaffAccount(owner(w), input(w)));
    // On aveugle la pré-vérification : c'est alors l'index unique qui refuse la création (cas d'une course).
    mock.method(User, "find", () => ({ select: () => ({ lean: async () => [] }) }) as never);
    const r = failed(await createStaffAccount(owner(w), input(w)));
    assert.deepEqual(r.errors, { email: ["Cet e-mail est déjà utilisé."] });
    mock.restoreAll();
    assert.equal(await User.countDocuments({ email: "sara@test.tn" }), 1);
  });

  it("duplicateFields reconnaît les doublons d'e-mail et de téléphone, et ignore les autres erreurs", () => {
    assert.deepEqual(duplicateFields({ code: 11000, keyPattern: { email: 1 } }), ["email"]);
    assert.deepEqual(duplicateFields({ code: 11000, keyPattern: { phone: 1 } }), ["phone"]);
    assert.deepEqual(duplicateFields({ code: 11000, keyPattern: { phone: 1, email: 1 } }), ["email", "phone"]);
    assert.deepEqual(duplicateFields({ code: 11000, message: "E11000 duplicate key error index: email_1 dup key" }), ["email"]);
    assert.equal(duplicateFields({ code: 12345 }), null);
    assert.equal(duplicateFields(new Error("autre")), null);
    assert.equal(duplicateFields(null), null);
  });
});

describe("createStaffAccount : erreurs techniques", () => {
  it("répond par un message générique sans exposer l'entrée, et journalise sans le mot de passe", async () => {
    const w = await world();
    mock.method(User, "find", () => {
      throw Object.assign(new Error(`échec avec ${PASSWORD}`), { name: "MongoNetworkError", code: 6 });
    });
    const logged: unknown[][] = [];
    mock.method(console, "error", (...args: unknown[]) => void logged.push(args));
    const r = failed(await createStaffAccount(owner(w), input(w)));
    assert.deepEqual(r, { ok: false, message: "Impossible de créer le compte. Réessayez." });
    assert.ok(logged.length > 0);
    assert.ok(!JSON.stringify(logged).includes(PASSWORD));
  });
});
