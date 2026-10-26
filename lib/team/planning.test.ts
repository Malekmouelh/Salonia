// F4 (étape 6) — Planning personnel : semaine à l'heure de Tunis, jours, horaires du jour. Tests purs, sans base. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayKey, fromLocal } from "@/lib/booking/time";
import { centerWeek, parseStoredHours } from "./hours";
import { MAX_WEEK_DISTANCE_DAYS, overlapsDay, planningHours, resolveWeekStart, weekDays } from "./planning";

// Mercredi 9 janvier 2030, 10 h à Tunis.
const NOW = fromLocal(2030, 1, 9, 10, 0);
const key = (d: Date) => dayKey(d);

describe("resolveWeekStart", () => {
  it("sans paramètre : lundi 00:00 de la semaine courante (heure de Tunis)", () => {
    const monday = resolveWeekStart(undefined, NOW);
    assert.equal(key(monday), "2030-01-07");
    assert.equal(monday.toISOString(), "2030-01-06T23:00:00.000Z"); // 00:00 à Tunis = 23:00 UTC la veille
  });

  it("le dimanche appartient à la semaine du lundi précédent, le lundi à sa propre semaine", () => {
    assert.equal(key(resolveWeekStart(undefined, fromLocal(2030, 1, 13, 23, 59))), "2030-01-07"); // dimanche 23:59
    assert.equal(key(resolveWeekStart(undefined, fromLocal(2030, 1, 14, 0, 0))), "2030-01-14"); // lundi 00:00 pile
    assert.equal(key(resolveWeekStart(undefined, fromLocal(2030, 1, 6, 23, 59))), "2029-12-31");
  });

  it("l'heure de Tunis décide de la semaine : dimanche 23:30 UTC est déjà lundi à Tunis", () => {
    assert.equal(key(resolveWeekStart(undefined, new Date("2030-01-13T23:30:00.000Z"))), "2030-01-14");
  });

  it("?week accepte n'importe quel jour de la semaine voulue", () => {
    for (const day of ["2030-01-14", "2030-01-15", "2030-01-17", "2030-01-20"]) assert.equal(key(resolveWeekStart(day, NOW)), "2030-01-14", day);
    assert.equal(key(resolveWeekStart("2029-12-31", NOW)), "2029-12-31");
    assert.equal(key(resolveWeekStart("2030-01-01", NOW)), "2029-12-31"); // une semaine à cheval sur deux années
  });

  it("repli sur la semaine courante pour toute valeur invalide", () => {
    const fallback = "2030-01-07";
    for (const bad of [undefined, null, "", "  ", "2030-02-31", "2030-13-01", "2030-00-10", "2030-1-8", "14/01/2030", "demain", 42, {}, [], ["2030-01-14"], "2030-01-14T10:00:00Z"]) {
      assert.equal(key(resolveWeekStart(bad, NOW)), fallback, JSON.stringify(bad));
    }
  });

  it("repli aussi pour une date réelle trop lointaine (plus de 5 ans)", () => {
    assert.ok(MAX_WEEK_DISTANCE_DAYS >= 5 * 365);
    assert.equal(key(resolveWeekStart("2099-01-01", NOW)), "2030-01-07");
    assert.equal(key(resolveWeekStart("1999-01-01", NOW)), "2030-01-07");
    assert.equal(key(resolveWeekStart("2033-06-01", NOW)), "2033-05-30"); // dans la limite
  });
});

describe("weekDays", () => {
  const days = weekDays(resolveWeekStart(undefined, NOW));

  it("sept jours consécutifs du lundi au dimanche, chacun de minuit local à minuit local", () => {
    assert.deepEqual(days.map((d) => d.key), ["2030-01-07", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11", "2030-01-12", "2030-01-13"]);
    assert.deepEqual(days.map((d) => d.weekday), ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]);
    for (const d of days) assert.equal(d.end.getTime() - d.start.getTime(), 86_400_000);
    for (let i = 1; i < 7; i++) assert.equal(days[i].start.getTime(), days[i - 1].end.getTime());
  });

  it("à cheval sur le changement d'année", () => {
    assert.deepEqual(weekDays(fromLocal(2029, 12, 31)).map((d) => d.key), ["2029-12-31", "2030-01-01", "2030-01-02", "2030-01-03", "2030-01-04", "2030-01-05", "2030-01-06"]);
  });
});

describe("overlapsDay", () => {
  const monday = weekDays(resolveWeekStart(undefined, NOW))[0];
  const at = (d: number, h = 0, m = 0) => fromLocal(2030, 1, d, h, m);

  it("début inclus, fin exclue", () => {
    assert.equal(overlapsDay({ start: at(7, 0), end: at(7, 1) }, monday), true);
    assert.equal(overlapsDay({ start: at(6, 23), end: at(7, 0) }, monday), false); // finit pile à minuit
    assert.equal(overlapsDay({ start: at(8, 0), end: at(8, 1) }, monday), false); // commence pile à minuit suivant
    assert.equal(overlapsDay({ start: at(7, 23, 30), end: at(8, 0, 30) }, monday), true); // à cheval
  });

  it("accepte des dates ISO comme des Date, et un élément qui englobe le jour", () => {
    assert.equal(overlapsDay({ start: at(6).toISOString(), end: at(9).toISOString() }, monday), true);
    assert.equal(overlapsDay({ start: at(7, 10), end: at(7, 11) }, monday), true);
  });
});

describe("planningHours (informatif)", () => {
  const days = weekDays(resolveWeekStart(undefined, NOW));
  const [monday, tuesday, wednesday, , , , sunday] = days;
  const center = { lundi: "08:00-20:00", mercredi: "10:00-18:00", dimanche: null };

  it("horaires personnels : plage, repos, ou comme le centre", () => {
    const week = parseStoredHours({ lundi: "09:00-17:00", mardi: null });
    assert.deepEqual(planningHours(week, monday, [center]), { mode: "range", open: "09:00", close: "17:00", center: { open: "08:00", close: "20:00" } });
    assert.deepEqual(planningHours(week, tuesday, [center]).mode, "off");
    assert.deepEqual(planningHours(week, wednesday, [center]), { mode: "center", open: null, close: null, center: { open: "10:00", close: "18:00" } });
  });

  it("un centre fermé ce jour-là est signalé", () => {
    assert.equal(planningHours(centerWeek(), sunday, [center]).center, "closed");
  });

  it("les horaires du centre ne s'affichent que s'il n'y a qu'un seul centre concerné", () => {
    assert.equal(planningHours(centerWeek(), monday, []).center, null);
    assert.equal(planningHours(centerWeek(), monday, [center, center]).center, null);
    assert.deepEqual(planningHours(parseStoredHours({ lundi: "09:00-17:00" }), monday, [center, center]).mode, "range");
  });

  it("un centre sans horaires enregistrés utilise les horaires par défaut (9 h-19 h, fermé le dimanche)", () => {
    assert.deepEqual(planningHours(centerWeek(), monday, [null]).center, { open: "09:00", close: "19:00" });
    assert.equal(planningHours(centerWeek(), sunday, [null]).center, "closed");
  });
});
