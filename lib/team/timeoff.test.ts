// F4 (étape 5a) — Congés et absences : conversion des dates, bornes et schéma de validation. Tests purs, sans base.
// Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayKey, fromLocal } from "@/lib/booking/time";
import { createStaffTimeOffSchema } from "./schemas";
import {
  MAX_DURATION_DAYS,
  MAX_FUTURE_DAYS,
  MAX_PAST_DAYS,
  MAX_TIMEOFF_REASON,
  checkTimeOffBounds,
  computeTimeOffRange,
  parseRealDay,
  summarizeTimeOff,
  timeOffAuditDetail,
  timeOffToForm,
  type TimeOffForm,
} from "./timeoff";

// Lundi 7 janvier 2030, 10 h à Tunis.
const NOW = fromLocal(2030, 1, 7, 10, 0);
const iso = (d: Date) => d.toISOString();

describe("parseRealDay", () => {
  it("accepte une date réelle et refuse les dates impossibles ou mal formées", () => {
    assert.equal(iso(parseRealDay("2030-01-08")!), "2030-01-07T23:00:00.000Z");
    assert.ok(parseRealDay("2032-02-29")); // année bissextile
    for (const bad of ["2031-02-29", "2030-02-31", "2030-13-01", "2030-00-10", "2030-1-8", "08/01/2030", "", undefined, null]) {
      assert.equal(parseRealDay(bad as string), null, String(bad));
    }
  });
});

describe("computeTimeOffRange : journées complètes", () => {
  it("une journée : de minuit local à minuit local du lendemain (fin exclusive)", () => {
    const r = computeTimeOffRange({ mode: "days", startDay: "2030-01-08" });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(iso(r.start), "2030-01-07T23:00:00.000Z"); // 00:00 à Tunis = 23:00 UTC la veille
      assert.equal(iso(r.end), "2030-01-08T23:00:00.000Z");
      assert.equal(r.allDay, true);
    }
  });

  it("plusieurs journées : le dernier jour est inclus", () => {
    const r = computeTimeOffRange({ mode: "days", startDay: "2030-01-08", endDay: "2030-01-10" });
    assert.ok(r.ok);
    if (r.ok) assert.equal(iso(r.end), iso(fromLocal(2030, 1, 11)));
  });

  it("une date de fin vide ou identique donne une seule journée", () => {
    const one = computeTimeOffRange({ mode: "days", startDay: "2030-01-08" });
    for (const endDay of ["", "  ", "2030-01-08"]) {
      const r = computeTimeOffRange({ mode: "days", startDay: "2030-01-08", endDay });
      assert.deepEqual(r, one, JSON.stringify(endDay));
    }
  });

  it("traverse correctement un changement de mois et d'année", () => {
    const r = computeTimeOffRange({ mode: "days", startDay: "2030-12-30", endDay: "2031-01-02" });
    assert.ok(r.ok);
    if (r.ok) assert.equal(dayKey(new Date(r.end.getTime() - 1)), "2031-01-02");
  });

  it("refuse une date de fin avant le début, et des dates invalides, avec le champ fautif", () => {
    assert.deepEqual(computeTimeOffRange({ mode: "days", startDay: "2030-01-10", endDay: "2030-01-08" }), {
      ok: false,
      field: "endDay",
      message: "La date de fin doit être le même jour ou après la date de début.",
    });
    assert.deepEqual(computeTimeOffRange({ mode: "days", startDay: "2030-02-31" }), { ok: false, field: "startDay", message: "Date invalide." });
    assert.deepEqual(computeTimeOffRange({ mode: "days", startDay: "2030-01-08", endDay: "demain" }), { ok: false, field: "endDay", message: "Date invalide." });
  });

  it("refuse des heures avec des journées complètes", () => {
    assert.equal((computeTimeOffRange({ mode: "days", startDay: "2030-01-08", from: "09:00" }) as { field: string }).field, "from");
    assert.equal((computeTimeOffRange({ mode: "days", startDay: "2030-01-08", to: "17:00" }) as { field: string }).field, "to");
    assert.equal(computeTimeOffRange({ mode: "days", startDay: "2030-01-08", from: "", to: " " }).ok, true);
  });
});

describe("computeTimeOffRange : plage horaire", () => {
  const range = (extra: Partial<TimeOffForm> = {}): TimeOffForm => ({ mode: "range", startDay: "2030-01-08", from: "09:00", to: "13:00", ...extra });

  it("une demi-journée : début et fin à l'heure de Tunis, dans la même journée", () => {
    const r = computeTimeOffRange(range());
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(iso(r.start), "2030-01-08T08:00:00.000Z");
      assert.equal(iso(r.end), "2030-01-08T12:00:00.000Z");
      assert.equal(r.allDay, false);
    }
  });

  it("accepte les heures sur un chiffre et la date de fin identique ou vide", () => {
    const a = computeTimeOffRange(range({ from: "9:00" }));
    const b = computeTimeOffRange(range({ endDay: "2030-01-08" }));
    const c = computeTimeOffRange(range({ endDay: "" }));
    assert.deepEqual(a, computeTimeOffRange(range()));
    assert.deepEqual(b, computeTimeOffRange(range()));
    assert.deepEqual(c, computeTimeOffRange(range()));
  });

  it("refuse une plage qui passe minuit ou vide, avec le message sur l'heure de fin", () => {
    for (const [from, to] of [["22:00", "02:00"], ["09:00", "09:00"], ["13:00", "09:00"]]) {
      assert.deepEqual(computeTimeOffRange(range({ from, to })), { ok: false, field: "to", message: "L'heure de fin doit être après l'heure de début." }, `${from}-${to}`);
    }
  });

  it("refuse des heures absentes ou impossibles, avec le champ fautif", () => {
    assert.deepEqual(computeTimeOffRange(range({ from: "" })), { ok: false, field: "from", message: "Heure de début invalide." });
    assert.deepEqual(computeTimeOffRange(range({ from: undefined })), { ok: false, field: "from", message: "Heure de début invalide." });
    assert.equal((computeTimeOffRange(range({ from: "09:60" })) as { field: string }).field, "from");
    assert.equal((computeTimeOffRange(range({ to: "24:00" })) as { field: string }).field, "to");
    assert.equal((computeTimeOffRange(range({ to: "midi" })) as { field: string }).field, "to");
  });

  it("refuse une plage horaire sur plusieurs jours", () => {
    assert.deepEqual(computeTimeOffRange(range({ endDay: "2030-01-09" })), { ok: false, field: "endDay", message: "Une plage horaire concerne une seule journée." });
  });
});

describe("checkTimeOffBounds", () => {
  const days = (startDay: string, endDay?: string) => {
    const r = computeTimeOffRange({ mode: "days", startDay, endDay });
    assert.ok(r.ok);
    return r as Extract<ReturnType<typeof computeTimeOffRange>, { ok: true }>;
  };

  it("accepte une absence passée de la veille, du jour, et future proche", () => {
    for (const day of ["2030-01-06", "2030-01-07", "2030-02-01"]) assert.equal(checkTimeOffBounds(days(day), NOW, "days"), null, day);
  });

  it("le premier jour peut remonter à 365 jours, pas à 366", () => {
    assert.equal(MAX_PAST_DAYS, 365);
    // Aujourd'hui = 2030-01-07 ; −365 jours = 2029-01-07.
    assert.equal(checkTimeOffBounds(days("2029-01-07"), NOW, "days"), null);
    assert.deepEqual(checkTimeOffBounds(days("2029-01-06"), NOW, "days"), { field: "startDay", message: "Le début ne peut pas dater de plus de 365 jours." });
  });

  it("le dernier jour peut aller jusqu'à aujourd'hui + 730 jours, pas 731", () => {
    assert.equal(MAX_FUTURE_DAYS, 730);
    // 2030-01-07 + 730 jours = 2032-01-07.
    assert.equal(checkTimeOffBounds(days("2032-01-07"), NOW, "days"), null);
    assert.deepEqual(checkTimeOffBounds(days("2032-01-08"), NOW, "days"), { field: "endDay", message: "La fin ne peut pas dépasser 730 jours à partir d'aujourd'hui." });
    assert.deepEqual(checkTimeOffBounds(days("2031-12-01", "2032-01-08"), NOW, "days")?.field, "endDay");
  });

  it("en mode plage horaire, l'erreur de limite lointaine porte sur la date unique", () => {
    const r = computeTimeOffRange({ mode: "range", startDay: "2032-01-08", from: "09:00", to: "10:00" });
    assert.ok(r.ok);
    if (r.ok) assert.equal(checkTimeOffBounds(r, NOW, "range")?.field, "startDay");
  });

  it("la durée est limitée à 366 jours (jours inclus)", () => {
    assert.equal(MAX_DURATION_DAYS, 366);
    // 2030-01-07 → 2031-01-07 inclus = 366 jours : accepté ; un jour de plus : refusé.
    assert.equal(checkTimeOffBounds(days("2030-01-07", "2031-01-07"), NOW, "days"), null);
    assert.deepEqual(checkTimeOffBounds(days("2030-01-07", "2031-01-08"), NOW, "days"), { field: "endDay", message: "Une absence ne peut pas durer plus de 366 jours." });
  });

  it("raisonne en jours entiers de Tunis, quelle que soit l'heure de la journée", () => {
    const justAfterMidnight = fromLocal(2030, 1, 7, 0, 5); // 23:05 UTC la veille
    const lastMinute = fromLocal(2030, 1, 7, 23, 59);
    for (const now of [justAfterMidnight, lastMinute]) {
      assert.equal(checkTimeOffBounds(days("2029-01-07"), now, "days"), null);
      assert.notEqual(checkTimeOffBounds(days("2029-01-06"), now, "days"), null);
    }
  });

  it("dépend de « maintenant » : la même absence devient hors bornes un an plus tard", () => {
    const entry = days("2030-01-07");
    assert.equal(checkTimeOffBounds(entry, NOW, "days"), null);
    assert.notEqual(checkTimeOffBounds(entry, fromLocal(2031, 6, 1), "days"), null);
  });
});

describe("timeOffToForm (pré-remplissage de la modification)", () => {
  it("restitue les journées complètes avec le dernier jour inclus", () => {
    const r = computeTimeOffRange({ mode: "days", startDay: "2030-01-08", endDay: "2030-01-10" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(timeOffToForm(r), { mode: "days", startDay: "2030-01-08", endDay: "2030-01-10", from: "", to: "" });
  });

  it("restitue une plage horaire", () => {
    const r = computeTimeOffRange({ mode: "range", startDay: "2030-01-08", from: "9:30", to: "13:15" });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(timeOffToForm(r), { mode: "range", startDay: "2030-01-08", endDay: "2030-01-08", from: "09:30", to: "13:15" });
  });

  it("refait l'aller-retour sans perte pour toute saisie valide", () => {
    const forms: TimeOffForm[] = [
      { mode: "days", startDay: "2030-03-31" },
      { mode: "days", startDay: "2030-12-30", endDay: "2031-01-02" },
      { mode: "days", startDay: "2032-02-28", endDay: "2032-03-01" },
      { mode: "range", startDay: "2030-06-15", from: "00:00", to: "23:59" },
      { mode: "range", startDay: "2030-06-15", from: "08:15", to: "08:30" },
    ];
    for (const form of forms) {
      const first = computeTimeOffRange(form);
      assert.ok(first.ok, JSON.stringify(form));
      if (first.ok) assert.deepEqual(computeTimeOffRange(timeOffToForm(first)), first, JSON.stringify(form));
    }
  });

  it("est total : une plage enregistrée sur plusieurs jours est ramenée à 23:59 de sa première journée", () => {
    const odd = { start: fromLocal(2030, 1, 8, 9, 0), end: fromLocal(2030, 1, 9, 10, 0), allDay: false };
    assert.deepEqual(timeOffToForm(odd), { mode: "range", startDay: "2030-01-08", endDay: "2030-01-08", from: "09:00", to: "23:59" });
  });
});

describe("schéma d'une absence (createStaffTimeOffSchema)", () => {
  const schema = createStaffTimeOffSchema(NOW);
  const valid = { kind: "LEAVE", mode: "days", startDay: "2030-01-08", endDay: "2030-01-10", reason: " Vacances " };

  it("produit les dates enregistrables, sans les champs du formulaire", () => {
    const r = schema.parse(valid);
    assert.deepEqual(Object.keys(r).sort(), ["allDay", "end", "kind", "reason", "start"]);
    assert.equal(r.kind, "LEAVE");
    assert.equal(r.allDay, true);
    assert.equal(iso(r.start), iso(fromLocal(2030, 1, 8)));
    assert.equal(iso(r.end), iso(fromLocal(2030, 1, 11)));
    assert.equal(r.reason, "Vacances");
  });

  it("gère les deux types et la plage horaire", () => {
    const r = schema.parse({ kind: "ABSENCE", mode: "range", startDay: "2030-01-08", from: "9:00", to: "13:00" });
    assert.equal(r.kind, "ABSENCE");
    assert.equal(r.allDay, false);
    assert.equal(iso(r.end), "2030-01-08T12:00:00.000Z");
  });

  it("n'inclut pas le motif quand il est absent ou vide", () => {
    for (const reason of [undefined, "", "   "]) {
      const r = schema.parse({ ...valid, reason });
      assert.ok(!("reason" in r), JSON.stringify(reason));
    }
  });

  it("limite le motif à 120 caractères", () => {
    assert.equal(MAX_TIMEOFF_REASON, 120);
    assert.equal(schema.safeParse({ ...valid, reason: "x".repeat(120) }).success, true);
    const r = schema.safeParse({ ...valid, reason: "x".repeat(121) });
    assert.equal(r.success, false);
    if (!r.success) assert.deepEqual(r.error.issues[0].path, ["reason"]);
  });

  it("ignore toute clé inconnue : employé, organisation, auteur, identifiant, dates déjà calculées", () => {
    const r = schema.parse({ ...valid, userId: "x", organizationId: "y", createdBy: "z", _id: "w", role: "OWNER", start: "2000-01-01", end: "2000-01-02", allDay: false });
    assert.deepEqual(Object.keys(r).sort(), ["allDay", "end", "kind", "reason", "start"]);
    assert.equal(r.allDay, true);
    assert.equal(iso(r.start), iso(fromLocal(2030, 1, 8)));
  });

  it("refuse un type ou un mode inconnu, avec l'erreur sur le bon champ", () => {
    const kind = schema.safeParse({ ...valid, kind: "SICK" });
    const mode = schema.safeParse({ ...valid, mode: "hours" });
    assert.equal(kind.success, false);
    assert.equal(mode.success, false);
    if (!kind.success) assert.deepEqual(kind.error.issues[0].path, ["kind"]);
    if (!mode.success) assert.deepEqual(mode.error.issues[0].path, ["mode"]);
  });

  it("signale le champ fautif des règles de dates, avec le message exact", () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ startDay: "2030-02-31" }, "startDay", "Date invalide."],
      [{ endDay: "2030-01-05" }, "endDay", "La date de fin doit être le même jour ou après la date de début."],
      [{ mode: "range", from: "22:00", to: "02:00", endDay: undefined }, "to", "L'heure de fin doit être après l'heure de début."],
      [{ mode: "range", from: "", to: "10:00", endDay: undefined }, "from", "Heure de début invalide."],
      [{ startDay: "2028-12-01", endDay: "2028-12-02" }, "startDay", "Le début ne peut pas dater de plus de 365 jours."],
      [{ startDay: "2033-01-01", endDay: "2033-01-02" }, "endDay", "La fin ne peut pas dépasser 730 jours à partir d'aujourd'hui."],
      [{ startDay: "2030-01-07", endDay: "2031-02-01" }, "endDay", "Une absence ne peut pas durer plus de 366 jours."],
    ];
    for (const [patch, field, message] of cases) {
      const r = schema.safeParse({ ...valid, ...patch });
      assert.equal(r.success, false, JSON.stringify(patch));
      if (!r.success) assert.deepEqual([r.error.issues[0].path[0], r.error.issues[0].message], [field, message], JSON.stringify(patch));
    }
  });

  it("refuse une entrée qui n'est pas un objet ou des champs de mauvais type", () => {
    for (const bad of [null, undefined, "texte", 42, [], { ...valid, startDay: 20300108 }, { ...valid, kind: ["LEAVE"] }]) {
      assert.equal(schema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });

  it("ne modifie pas l'entrée", () => {
    const input = { ...valid };
    schema.parse(input);
    assert.deepEqual(input, valid);
  });

  it("les bornes suivent la date fournie : le même formulaire est refusé avec un « maintenant » plus tardif", () => {
    assert.equal(createStaffTimeOffSchema(NOW).safeParse(valid).success, true);
    assert.equal(createStaffTimeOffSchema(fromLocal(2032, 6, 1)).safeParse(valid).success, false);
  });
});

describe("createStaffTimeOffSchema : option checkBounds", () => {
  const old = { kind: "LEAVE", mode: "days", startDay: "2028-01-10", endDay: "2028-01-12", reason: "Ancien" }; // plus de 365 jours dans le passé

  it("par défaut, les bornes sont vérifiées (comportement inchangé)", () => {
    for (const schema of [createStaffTimeOffSchema(NOW), createStaffTimeOffSchema(NOW, {}), createStaffTimeOffSchema(NOW, { checkBounds: true })]) {
      const r = schema.safeParse(old);
      assert.equal(r.success, false);
      if (!r.success) assert.deepEqual([r.error.issues[0].path[0], r.error.issues[0].message], ["startDay", "Le début ne peut pas dater de plus de 365 jours."]);
    }
  });

  it("checkBounds: false accepte des dates hors fenêtre, avec le même résultat que le schéma complet pour des dates valides", () => {
    const lenient = createStaffTimeOffSchema(NOW, { checkBounds: false });
    const r = lenient.parse(old);
    assert.equal(iso(r.start), iso(fromLocal(2028, 1, 10)));
    assert.equal(iso(r.end), iso(fromLocal(2028, 1, 13)));
    assert.equal(r.reason, "Ancien");
    const inWindow = { ...old, startDay: "2030-01-08", endDay: "2030-01-10" };
    assert.deepEqual(lenient.parse(inWindow), createStaffTimeOffSchema(NOW).parse(inWindow));
    // Futur trop lointain et durée trop longue : aussi acceptés sans les bornes.
    assert.equal(lenient.safeParse({ ...old, startDay: "2033-01-01", endDay: "2033-01-02" }).success, true);
    assert.equal(lenient.safeParse({ ...old, startDay: "2030-01-07", endDay: "2031-06-01" }).success, true);
  });

  it("checkBounds: false garde toutes les autres règles", () => {
    const lenient = createStaffTimeOffSchema(NOW, { checkBounds: false });
    const cases: [Record<string, unknown>, string][] = [
      [{ startDay: "2028-02-31" }, "startDay"],
      [{ endDay: "2028-01-05" }, "endDay"],
      [{ mode: "range", from: "22:00", to: "02:00", endDay: undefined }, "to"],
      [{ kind: "SICK" }, "kind"],
      [{ reason: "x".repeat(121) }, "reason"],
      [{ mode: "days", from: "09:00" }, "from"],
    ];
    for (const [patch, field] of cases) {
      const r = lenient.safeParse({ ...old, ...patch });
      assert.equal(r.success, false, JSON.stringify(patch));
      if (!r.success) assert.equal(r.error.issues[0].path[0], field, JSON.stringify(patch));
    }
  });
});

describe("summarizeTimeOff (résumé en cours / prochaine)", () => {
  const entry = (kind: string, start: Date, end: Date, allDay = true) => ({ kind, start, end, allDay });
  const day = (d: number) => fromLocal(2030, 1, d);

  it("sans absence : rien en cours, rien à venir", () => {
    assert.deepEqual(summarizeTimeOff([], NOW), { current: null, next: null });
  });

  it("distingue l'absence en cours et la prochaine, au format sérialisable sans motif", () => {
    const r = summarizeTimeOff([entry("LEAVE", day(6), day(9)), entry("ABSENCE", day(15), day(16))], NOW);
    assert.deepEqual(r.current, { kind: "LEAVE", start: iso(day(6)), end: iso(day(9)), allDay: true });
    assert.deepEqual(r.next, { kind: "ABSENCE", start: iso(day(15)), end: iso(day(16)), allDay: true });
    assert.deepEqual(Object.keys(r.current!).sort(), ["allDay", "end", "kind", "start"]);
  });

  it("le début est inclus et la fin exclue", () => {
    const startsNow = summarizeTimeOff([entry("LEAVE", NOW, day(9))], NOW);
    assert.ok(startsNow.current && !startsNow.next);
    const endsNow = summarizeTimeOff([entry("LEAVE", day(5), NOW)], NOW);
    assert.deepEqual(endsNow, { current: null, next: null }); // terminée
  });

  it("ignore les absences terminées, garde la plus proche à venir, et l'absence en cours qui finit le plus tard", () => {
    const r = summarizeTimeOff(
      [
        entry("LEAVE", day(1), day(3)), // terminée
        entry("LEAVE", day(20), day(21)), // lointaine
        entry("ABSENCE", day(12), day(13)), // la plus proche
        entry("ABSENCE", day(6), day(8)), // en cours
        entry("LEAVE", day(7), day(11)), // en cours, finit plus tard : retenue
      ],
      NOW,
    );
    assert.equal(r.current?.end, iso(day(11)));
    assert.equal(r.current?.kind, "LEAVE");
    assert.equal(r.next?.start, iso(day(12)));
  });

  it("gère une plage horaire en cours", () => {
    const r = summarizeTimeOff([entry("ABSENCE", fromLocal(2030, 1, 7, 9, 0), fromLocal(2030, 1, 7, 13, 0), false)], NOW);
    assert.equal(r.current?.allDay, false);
    assert.equal(r.current?.end, "2030-01-07T12:00:00.000Z");
  });
});

describe("timeOffAuditDetail (journal d'audit sans motif)", () => {
  const id = "64b7f0c2a1b2c3d4e5f60718";

  it("une journée, plusieurs journées (dernier jour inclus) et une plage horaire", () => {
    assert.equal(timeOffAuditDetail({ staffId: id, kind: "LEAVE", start: fromLocal(2030, 1, 8), end: fromLocal(2030, 1, 9), allDay: true }), `staff:${id} LEAVE 2030-01-08`);
    assert.equal(timeOffAuditDetail({ staffId: id, kind: "LEAVE", start: fromLocal(2030, 1, 8), end: fromLocal(2030, 1, 11), allDay: true }), `staff:${id} LEAVE 2030-01-08→2030-01-10`);
    assert.equal(
      timeOffAuditDetail({ staffId: id, kind: "ABSENCE", start: fromLocal(2030, 1, 8, 9, 30), end: fromLocal(2030, 1, 8, 13, 0), allDay: false }),
      `staff:${id} ABSENCE 2030-01-08 09:30-13:00`,
    );
  });

  it("accepte des dates ISO (vues sérialisées) et tient dans la limite de 200 caractères de l'audit", () => {
    const detail = timeOffAuditDetail({ staffId: id, kind: "LEAVE", start: "2030-01-07T23:00:00.000Z", end: "2031-01-07T23:00:00.000Z", allDay: true });
    assert.equal(detail, `staff:${id} LEAVE 2030-01-08→2031-01-07`);
    assert.ok(detail.length < 200);
  });

  it("ne reprend jamais un motif, même passé par erreur dans l'objet", () => {
    const withReason = { staffId: id, kind: "LEAVE", start: fromLocal(2030, 1, 8), end: fromLocal(2030, 1, 9), allDay: true, reason: "Diagnostic confidentiel" };
    assert.ok(!timeOffAuditDetail(withReason).includes("confidentiel"));
  });
});
