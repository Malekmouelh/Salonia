// F4 (étape 1) — Compétences et validation de la fiche employé. Tests purs, sans base. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEEKDAYS } from "@/lib/booking/time";
import {
  CreateStaffSchema,
  JobTitleSchema,
  MAX_JOB_TITLE_LENGTH,
  SkillsSchema,
  StaffHoursInputSchema,
  StaffProfileFieldsSchema,
  WORKING_DAYS,
  WorkingHoursSchema,
} from "./schemas";
import { MAX_SKILLS, MAX_SKILL_LENGTH, buildSkillSuggestions, cleanSkill, normalizeSkills, skillKey } from "./skills";

describe("normalisation des compétences", () => {
  it("nettoie les espaces en conservant casse et accents pour l'affichage", () => {
    assert.equal(cleanSkill("  Épilation   à  la cire "), "Épilation à la cire");
  });

  it("donne la même clé sans tenir compte de la casse, des accents et des espaces", () => {
    assert.equal(skillKey("Épilation  Cire"), "epilation cire");
    assert.equal(skillKey("EPILATION cire"), skillKey("épilation cire"));
    assert.notEqual(skillKey("Coiffure"), skillKey("Coloriste"));
  });

  it("conserve les caractères arabes (seules les marques de vocalisation sont ignorées)", () => {
    assert.equal(skillKey("حلاقة"), "حلاقة");
    assert.equal(skillKey("حَلاقة"), "حلاقة");
  });

  it("retire les doublons et les vides en gardant le premier libellé", () => {
    assert.deepEqual(normalizeSkills(["Coiffure", "  coiffure ", "COIFFURE", "", "   ", "Coloriste", "Épilation", "epilation"]), [
      "Coiffure",
      "Coloriste",
      "Épilation",
    ]);
  });

  it("ne modifie pas la liste fournie", () => {
    const input = ["A", "a"];
    normalizeSkills(input);
    assert.deepEqual(input, ["A", "a"]);
  });
});

describe("suggestions de compétences", () => {
  const lists = [["Coiffure", "Coloriste"], ["coiffure", "Épilation"], ["Coiffure", "coiffure"], []];

  it("regroupe par clé, compte une fois par service et trie par fréquence puis alphabétique", () => {
    assert.deepEqual(buildSkillSuggestions(lists), ["Coiffure", "Coloriste", "Épilation"]);
  });

  it("filtre par texte saisi, sans casse ni accents", () => {
    assert.deepEqual(buildSkillSuggestions(lists, { query: "EPIL" }), ["Épilation"]);
    assert.deepEqual(buildSkillSuggestions(lists, { query: "co" }), ["Coiffure", "Coloriste"]);
    assert.deepEqual(buildSkillSuggestions(lists, { query: "zzz" }), []);
  });

  it("exclut les compétences déjà choisies et respecte la limite", () => {
    assert.deepEqual(buildSkillSuggestions(lists, { exclude: ["COIFFURE"] }), ["Coloriste", "Épilation"]);
    assert.deepEqual(buildSkillSuggestions(lists, { limit: 1 }), ["Coiffure"]);
    assert.deepEqual(buildSkillSuggestions(lists, { limit: 0 }), []);
  });

  it("renvoie une liste vide sans service", () => {
    assert.deepEqual(buildSkillSuggestions([]), []);
  });
});

describe("schéma des compétences", () => {
  it("normalise et dédoublonne", () => {
    assert.deepEqual(SkillsSchema.parse([" Coiffure ", "coiffure", "", "Brushing"]), ["Coiffure", "Brushing"]);
  });

  it("accepte une liste vide", () => {
    assert.deepEqual(SkillsSchema.parse([]), []);
  });

  it("refuse une compétence trop longue ou trop de compétences", () => {
    assert.equal(SkillsSchema.safeParse(["x".repeat(MAX_SKILL_LENGTH + 1)]).success, false);
    assert.equal(SkillsSchema.safeParse(["x".repeat(MAX_SKILL_LENGTH)]).success, true);
    const many = Array.from({ length: MAX_SKILLS + 1 }, (_, i) => `Compétence ${i}`);
    assert.equal(SkillsSchema.safeParse(many).success, false);
    assert.equal(SkillsSchema.safeParse(many.slice(0, MAX_SKILLS)).success, true);
  });

  it("compte les compétences après suppression des doublons", () => {
    const withDuplicates = [...Array.from({ length: MAX_SKILLS }, (_, i) => `C${i}`), "c0", "C1"];
    assert.equal(SkillsSchema.safeParse(withDuplicates).success, true);
  });

  it("refuse autre chose qu'une liste de textes", () => {
    assert.equal(SkillsSchema.safeParse("Coiffure").success, false);
    assert.equal(SkillsSchema.safeParse([1, 2]).success, false);
  });
});

describe("schéma du poste", () => {
  it("retire les espaces, et un poste vide devient undefined", () => {
    assert.equal(JobTitleSchema.parse("  Coloriste senior "), "Coloriste senior");
    assert.equal(JobTitleSchema.parse("   "), undefined);
  });

  it("refuse un poste trop long", () => {
    assert.equal(JobTitleSchema.safeParse("x".repeat(MAX_JOB_TITLE_LENGTH)).success, true);
    assert.equal(JobTitleSchema.safeParse("x".repeat(MAX_JOB_TITLE_LENGTH + 1)).success, false);
  });
});

describe("schéma des horaires individuels", () => {
  it("expose les mêmes jours que les horaires des centres", () => {
    assert.deepEqual([...WORKING_DAYS].sort(), [...WEEKDAYS].sort());
  });

  it("accepte des plages, des jours de repos (null) et des jours absents", () => {
    assert.deepEqual(WorkingHoursSchema.parse({ lundi: "09:00-17:00", mardi: null, mercredi: "13:00-19:00" }), {
      lundi: "09:00-17:00",
      mardi: null,
      mercredi: "13:00-19:00",
    });
    assert.deepEqual(WorkingHoursSchema.parse({}), {});
  });

  it("met les plages au format HH:MM-HH:MM", () => {
    assert.deepEqual(WorkingHoursSchema.parse({ lundi: " 9:00 - 17:30 " }), { lundi: "09:00-17:30" });
  });

  it("refuse un format invalide, une heure impossible ou une fin qui n'est pas après le début", () => {
    for (const bad of ["fermé", "9h-17h", "09:00", "25:00-26:00", "09:60-10:00", "17:00-09:00", "09:00-09:00", ""]) {
      assert.equal(WorkingHoursSchema.safeParse({ lundi: bad }).success, false, bad);
    }
  });

  it("refuse un jour inconnu et une valeur qui n'est pas du texte", () => {
    assert.equal(WorkingHoursSchema.safeParse({ funday: "09:00-17:00" }).success, false);
    assert.equal(WorkingHoursSchema.safeParse({ lundi: 9 }).success, false);
    assert.equal(WorkingHoursSchema.safeParse(null).success, false);
  });
});

describe("schéma de la fiche employé", () => {
  it("accepte un objet vide : une mise à jour ne touche que les champs fournis", () => {
    assert.deepEqual(StaffProfileFieldsSchema.parse({}), {});
  });

  it("valide et normalise tous les champs ensemble", () => {
    const parsed = StaffProfileFieldsSchema.parse({
      jobTitle: " Coiffeuse ",
      skills: ["Coiffure", "coiffure"],
      workingHours: { lundi: "9:00-17:00", dimanche: null },
    });
    assert.deepEqual(parsed, { jobTitle: "Coiffeuse", skills: ["Coiffure"], workingHours: { lundi: "09:00-17:00", dimanche: null } });
  });

  it("accepte workingHours à null (suit les horaires du centre)", () => {
    assert.deepEqual(StaffProfileFieldsSchema.parse({ workingHours: null }), { workingHours: null });
  });

  it("signale l'erreur du champ concerné", () => {
    const r = StaffProfileFieldsSchema.safeParse({ workingHours: { lundi: "18:00-09:00" } });
    assert.equal(r.success, false);
    if (!r.success) assert.deepEqual(r.error.issues[0].path, ["workingHours", "lundi"]);
  });
});

describe("schéma de création d'un compte STAFF", () => {
  const CENTER = "64b7f0c2a1b2c3d4e5f60718";
  const valid = { firstName: "Sara", lastName: "Ben Ali", email: "Sara@Test.tn", phone: "", password: "Temp1234", centerIds: [CENTER] };

  it("accepte une demande valide et normalise e-mail, téléphone et centres", () => {
    const r = CreateStaffSchema.parse({ ...valid, email: " Sara@Test.TN ", phone: "+216 22 345 678", centerIds: [CENTER, CENTER.toUpperCase()] });
    assert.equal(r.email, "sara@test.tn");
    assert.equal(r.phone, "22345678");
    assert.deepEqual(r.centerIds, [CENTER]); // dédoublonné, en minuscules
  });

  it("n'exige qu'un seul identifiant : e-mail seul ou téléphone seul", () => {
    assert.equal(CreateStaffSchema.safeParse({ ...valid, phone: "" }).success, true);
    const phoneOnly = CreateStaffSchema.parse({ ...valid, email: "", phone: "22 345 678" });
    assert.equal(phoneOnly.email, undefined);
    assert.equal(phoneOnly.phone, "22345678");
  });

  it("refuse l'absence d'e-mail et de téléphone, signalée sur le champ e-mail", () => {
    const r = CreateStaffSchema.safeParse({ ...valid, email: "", phone: "" });
    assert.equal(r.success, false);
    if (!r.success) assert.deepEqual(r.error.issues[0].path, ["email"]);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, email: undefined, phone: undefined }).success, false);
  });

  it("refuse un e-mail ou un téléphone invalide", () => {
    assert.equal(CreateStaffSchema.safeParse({ ...valid, email: "pas-un-email" }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, phone: "12345" }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, email: "", phone: "11 345 678" }).success, false); // ne commence pas par 2-9
  });

  it("refuse des noms trop courts ou trop longs", () => {
    assert.equal(CreateStaffSchema.safeParse({ ...valid, firstName: "S" }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, lastName: " " }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, lastName: "x".repeat(61) }).success, false);
  });

  it("applique les règles de mot de passe existantes : 8 caractères, une lettre, un chiffre", () => {
    for (const bad of ["Ab1", "abcdefgh", "12345678", ""]) assert.equal(CreateStaffSchema.safeParse({ ...valid, password: bad }).success, false, bad);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, password: "abcdefg1" }).success, true);
  });

  it("n'enlève pas les espaces du mot de passe", () => {
    assert.equal(CreateStaffSchema.parse({ ...valid, password: " Temp1234 " }).password, " Temp1234 ");
  });

  it("limite le mot de passe à 72 octets UTF-8 (pas 72 caractères)", () => {
    assert.equal(CreateStaffSchema.safeParse({ ...valid, password: "a1" + "x".repeat(70) }).success, true); // 72 octets
    assert.equal(CreateStaffSchema.safeParse({ ...valid, password: "a1" + "x".repeat(71) }).success, false); // 73 octets
    // 36 caractères de 2 octets = 72 octets : accepté ; 37 = 74 octets : refusé alors qu'il fait moins de 72 caractères.
    assert.equal(CreateStaffSchema.safeParse({ ...valid, password: "1" + "é".repeat(35) + "a" }).success, true);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, password: "1a" + "é".repeat(36) }).success, false);
  });

  it("exige au moins un centre, avec des identifiants bien formés", () => {
    assert.equal(CreateStaffSchema.safeParse({ ...valid, centerIds: [] }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, centerIds: undefined }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, centerIds: ["pas-un-id"] }).success, false);
    assert.equal(CreateStaffSchema.safeParse({ ...valid, centerIds: ["a".repeat(12)] }).success, false); // 12 caractères : non accepté
  });

  it("ignore toute clé inconnue : rôle, organisation, hash, identifiant interne", () => {
    const r = CreateStaffSchema.parse({ ...valid, role: "OWNER", organizationId: "x", passwordHash: "y", _id: "z", lastLoginAt: "2020-01-01" });
    assert.deepEqual(Object.keys(r).sort(), ["centerIds", "email", "firstName", "lastName", "password", "phone"]);
  });

  it("normalise poste et compétences facultatifs", () => {
    const r = CreateStaffSchema.parse({ ...valid, jobTitle: "  Coloriste ", skills: ["Coloriste", "coloriste", " "] });
    assert.equal(r.jobTitle, "Coloriste");
    assert.deepEqual(r.skills, ["Coloriste"]);
  });

  it("les messages d'erreur ne contiennent jamais le mot de passe saisi", () => {
    const secret = "motdepasse-secret-sans-chiffre";
    const r = CreateStaffSchema.safeParse({ ...valid, password: secret });
    assert.equal(r.success, false);
    if (!r.success) assert.ok(!JSON.stringify(r.error.issues).includes(secret));
  });
});

describe("schéma d'enregistrement des horaires d'un employé", () => {
  it("null et objet vide donnent null : tous les jours suivent le centre", () => {
    assert.equal(StaffHoursInputSchema.parse(null), null);
    assert.equal(StaffHoursInputSchema.parse({}), null);
    assert.equal(StaffHoursInputSchema.parse({ lundi: undefined }), null);
  });

  it("conserve repos (null) et plages normalisées, sans les jours absents", () => {
    assert.deepEqual(StaffHoursInputSchema.parse({ lundi: "9:00-17:00", mardi: null }), { lundi: "09:00-17:00", mardi: null });
  });

  it("refuse une plage qui passe minuit, 24:00, une plage vide ou un champ vidé", () => {
    for (const bad of ["22:00-02:00", "18:00-09:00", "09:00-24:00", "09:00-09:00", "", "-", "09:00-", "-17:00"]) {
      assert.equal(StaffHoursInputSchema.safeParse({ lundi: bad }).success, false, JSON.stringify(bad));
    }
  });

  it("signale le jour fautif avec un message précis", () => {
    const r = StaffHoursInputSchema.safeParse({ mardi: "22:00-02:00", jeudi: "" });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.deepEqual(r.error.issues.map((i) => [i.path[0], i.message]), [
        ["mardi", "L'heure de fin doit être après l'heure de début."],
        ["jeudi", "Format attendu : 09:00-17:00."],
      ]);
    }
  });

  it("refuse un jour inconnu et un type incorrect", () => {
    assert.equal(StaffHoursInputSchema.safeParse({ funday: "09:00-17:00" }).success, false);
    assert.equal(StaffHoursInputSchema.safeParse({ lundi: 9 }).success, false);
    assert.equal(StaffHoursInputSchema.safeParse("texte").success, false);
    assert.equal(StaffHoursInputSchema.safeParse(undefined).success, false);
    assert.equal(StaffHoursInputSchema.safeParse([]).success, false);
  });
});
