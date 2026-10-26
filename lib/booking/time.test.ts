// Tests de caractérisation des utilitaires d'heure locale (Africa/Tunis, UTC+1 fixe). Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_HOURS,
  addDays,
  addMinutes,
  dayKey,
  fromLocal,
  hhmmToMinutes,
  hoursForDay,
  minutesToHhmm,
  overlaps,
  parseDayKey,
  parseRange,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  toLocal,
} from "./time";

// 2030-01-06 = dimanche, 2030-01-07 = lundi.
describe("heure locale de Tunis", () => {
  it("convertit l'heure locale en UTC avec un décalage fixe de +1 h", () => {
    assert.equal(fromLocal(2030, 1, 7, 9, 30).toISOString(), "2030-01-07T08:30:00.000Z");
    assert.equal(fromLocal(2030, 7, 15, 9, 30).toISOString(), "2030-07-15T08:30:00.000Z"); // pas d'heure d'été
  });

  it("repasse en UTC vers l'heure locale, y compris au changement de jour", () => {
    const p = toLocal(new Date("2030-01-06T23:30:00.000Z"));
    assert.deepEqual(p, { year: 2030, month: 1, day: 7, hour: 0, minute: 30, weekday: 1 });
    assert.equal(toLocal(fromLocal(2030, 1, 6)).weekday, 0); // dimanche
  });

  it("dayKey et parseDayKey font l'aller-retour ; un format invalide donne null", () => {
    const d = fromLocal(2030, 1, 7, 15, 0);
    assert.equal(dayKey(d), "2030-01-07");
    assert.equal(parseDayKey("2030-01-07")?.toISOString(), "2030-01-06T23:00:00.000Z");
    assert.equal(parseDayKey("07/01/2030"), null);
    assert.equal(parseDayKey("2030-1-7"), null);
  });

  it("calcule début de jour, de semaine (lundi) et de mois", () => {
    const sunday = fromLocal(2030, 1, 6, 18, 0);
    assert.equal(startOfLocalDay(sunday).toISOString(), fromLocal(2030, 1, 6).toISOString());
    assert.equal(dayKey(startOfLocalWeek(sunday)), "2029-12-31"); // le dimanche appartient à la semaine du lundi précédent
    assert.equal(dayKey(startOfLocalWeek(fromLocal(2030, 1, 7))), "2030-01-07");
    assert.equal(dayKey(startOfLocalMonth(fromLocal(2030, 1, 20))), "2030-01-01");
  });

  it("ajoute des jours et des minutes en millisecondes réelles", () => {
    const d = fromLocal(2030, 1, 7);
    assert.equal(addDays(d, 1).toISOString(), fromLocal(2030, 1, 8).toISOString());
    assert.equal(addMinutes(d, 90).toISOString(), fromLocal(2030, 1, 7, 1, 30).toISOString());
  });
});

describe("horaires HH:MM", () => {
  it("convertit HH:MM en minutes et inversement", () => {
    assert.equal(hhmmToMinutes("09:30"), 570);
    assert.equal(hhmmToMinutes("00:00"), 0);
    assert.equal(minutesToHhmm(570), "09:30");
    assert.equal(minutesToHhmm(1140), "19:00");
  });

  it("lit une plage valide, avec espaces ou heure sur un chiffre", () => {
    assert.deepEqual(parseRange("09:00-19:00"), { open: 540, close: 1140 });
    assert.deepEqual(parseRange(" 9:00 - 17:30 "), { open: 540, close: 1050 });
  });

  it("renvoie null pour une plage vide, invalide ou dont la fin n'est pas après le début", () => {
    assert.equal(parseRange(null), null);
    assert.equal(parseRange(undefined), null);
    assert.equal(parseRange(""), null);
    assert.equal(parseRange("fermé"), null);
    assert.equal(parseRange("19:00-09:00"), null);
    assert.equal(parseRange("09:00-09:00"), null);
  });
});

describe("hoursForDay (horaires d'ouverture d'un centre)", () => {
  const monday = fromLocal(2030, 1, 7);
  const sunday = fromLocal(2030, 1, 6);

  it("utilise les horaires par défaut (9 h-19 h, fermé le dimanche) quand le centre n'en a pas", () => {
    assert.deepEqual(hoursForDay(null, monday), { open: 540, close: 1140 });
    assert.deepEqual(hoursForDay(undefined, monday), { open: 540, close: 1140 });
    assert.equal(hoursForDay(null, sunday), null);
    assert.equal(DEFAULT_HOURS.dimanche, null);
  });

  it("respecte les horaires du centre, et un jour explicitement null est fermé", () => {
    assert.deepEqual(hoursForDay({ lundi: "10:00-16:00" }, monday), { open: 600, close: 960 });
    assert.equal(hoursForDay({ lundi: null }, monday), null);
  });

  it("retombe sur le jour par défaut quand la clé du jour est absente de l'objet", () => {
    assert.deepEqual(hoursForDay({ mardi: "10:00-12:00" }, monday), { open: 540, close: 1140 });
    assert.equal(hoursForDay({ mardi: "10:00-12:00" }, sunday), null);
  });
});

describe("overlaps", () => {
  const t = (h: number, m = 0) => fromLocal(2030, 1, 7, h, m);
  it("détecte un chevauchement, partiel ou total", () => {
    assert.equal(overlaps(t(10), t(11), t(10, 30), t(11, 30)), true);
    assert.equal(overlaps(t(10), t(12), t(10, 30), t(11)), true);
  });
  it("traite deux plages qui se touchent comme non chevauchantes", () => {
    assert.equal(overlaps(t(10), t(11), t(11), t(12)), false);
    assert.equal(overlaps(t(11), t(12), t(10), t(11)), false);
  });
});
