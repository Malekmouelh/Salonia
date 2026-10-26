// F4 (étape 4) — Lecture et écriture des horaires de travail individuels. Tests purs, sans base. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEEKDAYS } from "@/lib/booking/time";
import { WORKING_DAYS, centerWeek, parseStoredHours, readStoredHours, serializeHours, type WeekHours } from "./hours";

describe("parseStoredHours : la convention des trois états", () => {
  it("null, absent ou objet vide : les sept jours suivent le centre", () => {
    for (const raw of [null, undefined, {}]) {
      assert.deepEqual(parseStoredHours(raw), centerWeek(), String(raw));
    }
  });

  it("jour absent = comme le centre, jour à null = repos, jour avec plage = plage", () => {
    const week = parseStoredHours({ lundi: "09:00-17:00", mardi: null });
    assert.deepEqual(week.lundi, { mode: "range", open: "09:00", close: "17:00" });
    assert.deepEqual(week.mardi, { mode: "off" });
    assert.deepEqual(week.mercredi, { mode: "center" });
    for (const d of ["jeudi", "vendredi", "samedi", "dimanche"] as const) assert.deepEqual(week[d], { mode: "center" }, d);
  });

  it("normalise les plages (9:00 → 09:00, espaces)", () => {
    assert.deepEqual(parseStoredHours({ samedi: " 9:00 - 13:30 " }).samedi, { mode: "range", open: "09:00", close: "13:30" });
  });

  it("couvre les sept jours dans l'ordre, avec les mêmes clés que les horaires des centres", () => {
    assert.deepEqual(Object.keys(parseStoredHours(null)), [...WORKING_DAYS]);
    assert.deepEqual([...WORKING_DAYS].sort(), [...WEEKDAYS].sort());
  });

  it("traite les valeurs invalides comme « comme le centre », sans exception", () => {
    const invalid: unknown[] = ["texte", 42, true, [], ["09:00-17:00"], () => 1];
    for (const raw of invalid) assert.deepEqual(parseStoredHours(raw), centerWeek(), String(raw));
    const week = parseStoredHours({
      lundi: "fermé", // texte
      mardi: "17:00-09:00", // plage inversée : passe minuit
      mercredi: "09:00-09:00", // plage vide
      jeudi: "25:00-26:00", // heures impossibles
      vendredi: 9, // mauvais type
      samedi: "09:00-24:00", // 24:00 non accepté
      dimanche: undefined,
      funday: "09:00-17:00", // jour inconnu : ignoré
    });
    assert.deepEqual(week, centerWeek());
  });

  it("une valeur invalide n'empêche pas de lire les autres jours", () => {
    const week = parseStoredHours({ lundi: "n'importe quoi", mardi: "10:00-18:00", mercredi: null });
    assert.deepEqual(week.lundi, { mode: "center" });
    assert.deepEqual(week.mardi, { mode: "range", open: "10:00", close: "18:00" });
    assert.deepEqual(week.mercredi, { mode: "off" });
  });

  it("ne modifie pas la valeur lue", () => {
    const raw = { lundi: "9:00-17:00", mardi: null };
    parseStoredHours(raw);
    assert.deepEqual(raw, { lundi: "9:00-17:00", mardi: null });
  });
});

describe("serializeHours", () => {
  const week = (patch: Partial<WeekHours>): WeekHours => ({ ...centerWeek(), ...patch });

  it("tous les jours « comme le centre » donne null", () => {
    assert.equal(serializeHours(centerWeek()), null);
  });

  it("omet les jours comme le centre, écrit null pour le repos et la plage pour les horaires", () => {
    assert.deepEqual(
      serializeHours(week({ lundi: { mode: "range", open: "09:00", close: "17:00" }, mardi: { mode: "off" }, vendredi: { mode: "range", open: "13:00", close: "19:00" } })),
      { lundi: "09:00-17:00", mardi: null, vendredi: "13:00-19:00" },
    );
  });

  it("un seul jour de repos suffit à personnaliser les horaires", () => {
    assert.deepEqual(serializeHours(week({ dimanche: { mode: "off" } })), { dimanche: null });
  });

  it("recopie les plages saisies sans les valider (le serveur s'en charge)", () => {
    assert.deepEqual(serializeHours(week({ lundi: { mode: "range", open: "18:00", close: "09:00" } })), { lundi: "18:00-09:00" });
    assert.deepEqual(serializeHours(week({ lundi: { mode: "range", open: "", close: "" } })), { lundi: "-" });
  });

  it("fait l'aller-retour sans perte pour toute valeur valide", () => {
    const stored = { lundi: "09:00-17:00", mardi: null, jeudi: "10:15-18:45", dimanche: null };
    assert.deepEqual(serializeHours(parseStoredHours(stored)), stored);
    assert.equal(serializeHours(parseStoredHours(null)), null);
    assert.equal(serializeHours(parseStoredHours({})), null);
  });
});

describe("readStoredHours", () => {
  it("renvoie la valeur normalisée, ou null quand rien n'est personnalisé ou valide", () => {
    assert.equal(readStoredHours(undefined), null);
    assert.equal(readStoredHours({}), null);
    assert.equal(readStoredHours({ lundi: "garbage" }), null);
    assert.equal(readStoredHours("texte"), null);
    assert.deepEqual(readStoredHours({ lundi: " 9:00-17:00 ", mardi: null, mercredi: "nope" }), { lundi: "09:00-17:00", mardi: null });
  });
});
