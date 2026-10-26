// F4 (étape 1) — Champs de fiche employé sur User : compatibilité avec les comptes existants,
// enregistrement et suggestions de compétences. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getPractitioners } from "@/lib/booking/availability";
import { createCenter, createOrg, createService, createUser, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { getSkillSuggestions } from "@/lib/data/team";
import { Service } from "@/lib/models/catalog";
import { User } from "@/lib/models/core";
import { StaffProfileFieldsSchema } from "./schemas";

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

// Compte tel qu'il existait avant F4 : inséré directement, sans les nouveaux champs.
async function legacyStaff() {
  const org = await createOrg();
  const center = await createCenter(org._id);
  const { insertedId } = await User.collection.insertOne({
    organizationId: org._id,
    firstName: "Ancienne",
    lastName: "Fiche",
    email: "ancienne@test.local",
    passwordHash: "not-a-real-hash",
    role: "STAFF",
    centerIds: [center._id],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { org, center, id: insertedId };
}

describe("compatibilité des comptes existants", () => {
  it("charge un compte sans les nouveaux champs avec des valeurs neutres", async () => {
    const { id } = await legacyStaff();
    const user = await User.findById(id);
    assert.ok(user);
    assert.equal(user.jobTitle, undefined);
    assert.deepEqual([...user.skills], []);
    assert.equal(user.workingHours, null);
    assert.equal(user.firstName, "Ancienne"); // les champs existants sont intacts
  });

  it("[existant] en lecture « lean », les champs absents restent undefined : le code appelant doit prévoir un repli", async () => {
    const { id } = await legacyStaff();
    const user = await User.findById(id).lean();
    assert.equal(user?.jobTitle, undefined);
    assert.equal(user?.skills, undefined);
    assert.equal(user?.workingHours, undefined);
  });

  it("n'écrit pas les nouveaux champs en base quand on enregistre un autre champ", async () => {
    const { id } = await legacyStaff();
    await User.updateOne({ _id: id }, { lastLoginAt: new Date() });
    const raw = await User.collection.findOne({ _id: id });
    assert.ok(raw && !("jobTitle" in raw) && !("workingHours" in raw));
  });

  it("garde le compte dans la liste des praticiens (getPractitioners)", async () => {
    const { org, center } = await legacyStaff();
    const list = await getPractitioners(String(org._id), String(center._id));
    assert.deepEqual(list.map((p) => p.firstName), ["Ancienne"]);
  });

  it("un compte créé sans les champs (createUser des tests existants) reste valide", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const user = await createUser(org._id, [center._id], "Simple");
    assert.deepEqual([...user.skills], []);
    assert.equal(user.workingHours, null);
    assert.equal(user.jobTitle, undefined);
  });
});

describe("enregistrement de la fiche employé", () => {
  it("enregistre et relit poste, compétences et horaires validés par le schéma", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const user = await createUser(org._id, [center._id], "Nadia");
    const fields = StaffProfileFieldsSchema.parse({
      jobTitle: " Coloriste ",
      skills: ["Coloriste", "coloriste", "Brushing"],
      workingHours: { lundi: "9:00-17:00", mardi: null },
    });
    await User.updateOne({ _id: user._id }, fields);

    const saved = await User.findById(user._id).lean();
    assert.equal(saved?.jobTitle, "Coloriste");
    assert.deepEqual(saved?.skills, ["Coloriste", "Brushing"]);
    assert.deepEqual(saved?.workingHours, { lundi: "09:00-17:00", mardi: null });
  });

  it("remet les horaires à « suit le centre » avec null et vide les compétences avec []", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const user = await createUser(org._id, [center._id], "Nadia");
    await User.updateOne({ _id: user._id }, { skills: ["A"], workingHours: { lundi: "09:00-17:00" } });
    await User.updateOne({ _id: user._id }, StaffProfileFieldsSchema.parse({ skills: [], workingHours: null }));
    const saved = await User.findById(user._id).lean();
    assert.deepEqual(saved?.skills, []);
    assert.equal(saved?.workingHours, null);
  });

  it("supprime les espaces autour du poste à l'enregistrement", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const user = await createUser(org._id, [center._id], "Nadia");
    await User.updateOne({ _id: user._id }, { jobTitle: "  Esthéticienne  " });
    assert.equal((await User.findById(user._id).lean())?.jobTitle, "Esthéticienne");
  });
});

describe("getSkillSuggestions (compétences exigées par les services)", () => {
  async function catalog() {
    const org = await createOrg();
    await Service.create([
      { organizationId: org._id, name: "Coupe", category: "Coiffure", durationMinutes: 30, priceTnd: 20, requiredSkills: ["Coiffure"] },
      { organizationId: org._id, name: "Couleur", category: "Coiffure", durationMinutes: 90, priceTnd: 80, requiredSkills: ["coiffure", "Coloriste"] },
      { organizationId: org._id, name: "Cire", category: "Soins", durationMinutes: 30, priceTnd: 25, requiredSkills: ["Épilation"], active: false },
      { organizationId: org._id, name: "Sans compétence", category: "Soins", durationMinutes: 30, priceTnd: 25 },
    ]);
    return org;
  }

  it("liste les compétences des services (y compris inactifs), les plus utilisées d'abord", async () => {
    const org = await catalog();
    assert.deepEqual(await getSkillSuggestions(String(org._id)), ["Coiffure", "Coloriste", "Épilation"]);
  });

  it("filtre par texte saisi et exclut les compétences déjà choisies", async () => {
    const org = await catalog();
    assert.deepEqual(await getSkillSuggestions(String(org._id), { query: "epil" }), ["Épilation"]);
    assert.deepEqual(await getSkillSuggestions(String(org._id), { exclude: ["coiffure"] }), ["Coloriste", "Épilation"]);
  });

  it("ne montre jamais les compétences d'une autre organisation", async () => {
    const org = await catalog();
    const other = await createOrg("Autre salon");
    await createService(other._id, 30, 10);
    await Service.create({ organizationId: other._id, name: "Secret", category: "X", durationMinutes: 30, priceTnd: 10, requiredSkills: ["Confidentiel"] });
    assert.ok(!(await getSkillSuggestions(String(org._id))).includes("Confidentiel"));
    assert.deepEqual(await getSkillSuggestions(String(other._id)), ["Confidentiel"]);
  });

  it("renvoie une liste vide pour une organisation sans service", async () => {
    const org = await createOrg();
    assert.deepEqual(await getSkillSuggestions(String(org._id)), []);
  });
});
