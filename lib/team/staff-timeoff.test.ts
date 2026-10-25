// F4 (étape 5b) — Service des congés et absences : permissions, isolation, création, modification, suppression,
// chevauchements, rendez-vous concernés et absence d'effets collatéraux. Base MongoDB éphémère en mémoire.
// ENREGISTREMENT SEUL : ces absences ne bloquent encore aucun créneau. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { getDaySlots, isSlotAvailable } from "@/lib/booking/availability";
import { MONDAY, at, createCenter, createCustomer, createOrg, createUser, insertBlock, insertBooking, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { fromLocal } from "@/lib/booking/time";
import type { CurrentUser } from "@/lib/dal";
import { getTeamRoster } from "@/lib/data/team";
import type { Role } from "@/lib/enums";
import { AvailabilityBlock, Booking, Notification, WaitlistEntry } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import {
  createStaffTimeOff,
  deleteStaffTimeOff,
  listStaffTimeOff,
  updateStaffTimeOff,
  type CreateStaffTimeOffResult,
  type StaffTimeOffView,
} from "./service";

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

// Lundi 7 janvier 2030, 10 h à Tunis : « maintenant » fixe pour des bornes déterministes.
const NOW = fromLocal(2030, 1, 7, 10, 0);
const NOT_FOUND_STAFF = "Employé introuvable.";
const NOT_FOUND_ENTRY = "Absence introuvable.";
const OVERLAP = "Cet employé a déjà une absence sur cette période.";

type World = Awaited<ReturnType<typeof world>>;
async function world() {
  const org = await createOrg("Salon Yasmine");
  const tunis = await createCenter(org._id, "Tunis");
  const sousse = await createCenter(org._id, "Sousse");
  const alice = await createUser(org._id, [tunis._id], "Alice"); // Tunis seul
  const bob = await createUser(org._id, [sousse._id], "Bob"); // Sousse seul
  const carla = await createUser(org._id, [tunis._id, sousse._id], "Carla"); // partagée
  const customer = await createCustomer(org._id);
  const centers = [
    { id: String(tunis._id), name: "Tunis", governorate: "TUNIS" as const },
    { id: String(sousse._id), name: "Sousse", governorate: "SOUSSE" as const },
  ];
  return { org, tunis, sousse, alice, bob, carla, customer, centers, tunisId: centers[0].id, sousseId: centers[1].id };
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

// Saisie du formulaire : journées complètes du 8 au 10 janvier 2030 par défaut.
const form = (extra: Record<string, unknown> = {}) => ({ kind: "LEAVE", mode: "days", startDay: "2030-01-08", endDay: "2030-01-10", ...extra });
const days = (startDay: string, endDay?: string, extra: Record<string, unknown> = {}) => form({ startDay, endDay, ...extra });

const created = (r: CreateStaffTimeOffResult): StaffTimeOffView => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<CreateStaffTimeOffResult, { ok: true }>).timeOff;
};
const failure = (r: { ok: boolean }) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  return r as { ok: false; message?: string; errors?: Record<string, string[]> };
};
const book = (w: World, staff: { _id: unknown }, start: Date, minutes = 60, status?: "CONFIRMED" | "PENDING" | "CANCELLED" | "COMPLETED" | "NO_SHOW") =>
  insertBooking({ organizationId: w.org._id, centerId: w.tunis._id, staffId: staff._id as string, customerId: w.customer._id, start, minutes, status });
const count = () => StaffTimeOff.countDocuments();

describe("createStaffTimeOff : création", () => {
  it("enregistre une absence en journées complètes pour l'employé, dans l'organisation de l'acteur", async () => {
    const w = await world();
    const view = created(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: " Vacances d'hiver " }), NOW));
    assert.equal(view.staffId, String(w.alice._id));
    assert.equal(view.kind, "LEAVE");
    assert.equal(view.allDay, true);
    assert.equal(view.start, "2030-01-07T23:00:00.000Z");
    assert.equal(view.end, "2030-01-10T23:00:00.000Z");
    assert.equal(view.reason, "Vacances d'hiver");
    assert.equal(view.affectedBookings, 0);
    const doc = await StaffTimeOff.findById(view.id).lean();
    assert.equal(String(doc?.organizationId), String(w.org._id));
    assert.equal(String(doc?.userId), String(w.alice._id));
    assert.equal(String(doc?.createdBy), "000000000000000000000001");
    assert.equal(doc?.allDay, true);
  });

  it("enregistre une plage horaire et une absence exceptionnelle, sans motif", async () => {
    const w = await world();
    const view = created(await createStaffTimeOff(owner(w), String(w.alice._id), { kind: "ABSENCE", mode: "range", startDay: "2030-01-08", from: "9:00", to: "13:00" }, NOW));
    assert.equal(view.kind, "ABSENCE");
    assert.equal(view.allDay, false);
    assert.equal(view.start, "2030-01-08T08:00:00.000Z");
    assert.equal(view.end, "2030-01-08T12:00:00.000Z");
    assert.equal(view.reason, null);
    assert.ok(!("reason" in ((await StaffTimeOff.collection.findOne({ _id: new (await import("mongoose")).Types.ObjectId(view.id) })) ?? {})));
  });

  it("ignore toute clé inconnue du formulaire : employé, organisation, auteur, dates déjà calculées", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const view = created(
      await createStaffTimeOff(owner(w), String(w.alice._id), form({ userId: String(w.bob._id), organizationId: String(other._id), createdBy: "x", start: "2000-01-01", allDay: false }), NOW),
    );
    const doc = await StaffTimeOff.findById(view.id).lean();
    assert.equal(String(doc?.userId), String(w.alice._id));
    assert.equal(String(doc?.organizationId), String(w.org._id));
    assert.equal(doc?.start.toISOString(), "2030-01-07T23:00:00.000Z");
    assert.equal(doc?.allDay, true);
  });

  it("refuse les saisies invalides par champ, sans rien écrire, avec les bornes calculées d'après « maintenant »", async () => {
    const w = await world();
    const r = failure(await createStaffTimeOff(owner(w), String(w.alice._id), { kind: "LEAVE", mode: "range", startDay: "2030-01-08", from: "22:00", to: "02:00" }, NOW));
    assert.deepEqual(r.errors, { to: ["L'heure de fin doit être après l'heure de début."] });
    assert.deepEqual(failure(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-02-31"), NOW)).errors, { startDay: ["Date invalide."] });
    assert.deepEqual(failure(await createStaffTimeOff(owner(w), String(w.alice._id), days("2028-12-01", "2028-12-02"), NOW)).errors, { startDay: ["Le début ne peut pas dater de plus de 365 jours."] });
    // La même saisie est valide à une date plus proche, et refusée un an et demi plus tard.
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-06-01"), NOW));
    failure(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-06-02"), fromLocal(2032, 6, 1)));
    for (const bad of [null, undefined, "texte", 42, []]) {
      const r = failure(await createStaffTimeOff(owner(w), String(w.alice._id), bad, NOW));
      assert.ok(r.errors || r.message, JSON.stringify(bad));
    }
    assert.equal(await count(), 1);
  });

  it("[existant] ne bloque aucun créneau : les disponibilités sont identiques avant et après", async () => {
    const w = await world();
    const early = fromLocal(2029, 1, 1);
    const snapshot = async () => ({
      slots: await getDaySlots({ organizationId: String(w.org._id), centerId: w.tunisId, day: MONDAY, durationMinutes: 60, now: early }),
      free: await isSlotAvailable({ organizationId: String(w.org._id), centerId: w.tunisId, staffId: String(w.alice._id), start: at(10), durationMinutes: 60 }),
    });
    const before = await snapshot();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-07", "2030-01-07"), NOW));
    assert.deepEqual(await snapshot(), before);
    assert.equal(before.free, true);
  });
});

describe("permissions et isolation (création, liste, modification, suppression)", () => {
  it("refuse tout rôle autre que propriétaire et gérant, un acteur sans organisation et un gérant sans centre", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    const actors = [
      ...(["STAFF", "CLIENT", "SUPER_ADMIN"] as const).map((role) => viewer(w, role, [w.tunisId])),
      viewer(w, "OWNER", [], false),
      manager(w),
    ];
    for (const actor of actors) {
      const label = `${actor.role}/${actor.organization ? "org" : "sans org"}`;
      assert.equal(failure(await createStaffTimeOff(actor, String(w.alice._id), days("2030-03-01"), NOW)).message, "Accès refusé.", label);
      assert.equal(failure(await listStaffTimeOff(actor, String(w.alice._id), NOW)).message, "Accès refusé.", label);
      assert.equal(failure(await updateStaffTimeOff(actor, entry.id, days("2030-03-01"), NOW)).message, "Accès refusé.", label);
      assert.equal(failure(await deleteStaffTimeOff(actor, entry.id)).message, "Accès refusé.", label);
    }
    assert.equal(await count(), 1);
    assert.equal((await StaffTimeOff.findById(entry.id).lean())?.start.toISOString(), entry.start);
  });

  it("le gérant gère les absences d'un employé dont tous les centres sont dans son périmètre", async () => {
    const w = await world();
    const m = manager(w, w.tunisId);
    const entry = created(await createStaffTimeOff(m, String(w.alice._id), form(), NOW));
    assert.equal((await listStaffTimeOff(m, String(w.alice._id), NOW) as { items: unknown[] }).items.length, 1);
    assert.equal((await updateStaffTimeOff(m, entry.id, days("2030-03-01"), NOW)).ok, true);
    assert.equal((await deleteStaffTimeOff(m, entry.id)).ok, true);
    // Carla est partagée mais entièrement dans le périmètre d'un gérant des deux centres.
    created(await createStaffTimeOff(manager(w, w.tunisId, w.sousseId), String(w.carla._id), form(), NOW));
  });

  it("D1 : le gérant ne gère pas un employé partagé avec un centre qu'il ne gère pas, le propriétaire si", async () => {
    const w = await world();
    const m = manager(w, w.tunisId);
    assert.equal(failure(await createStaffTimeOff(m, String(w.carla._id), form(), NOW)).message, NOT_FOUND_STAFF);
    assert.equal(failure(await listStaffTimeOff(m, String(w.carla._id), NOW)).message, NOT_FOUND_STAFF);
    const entry = created(await createStaffTimeOff(owner(w), String(w.carla._id), form(), NOW));
    assert.equal(failure(await updateStaffTimeOff(m, entry.id, days("2030-03-01"), NOW)).message, NOT_FOUND_ENTRY);
    assert.equal(failure(await deleteStaffTimeOff(m, entry.id)).message, NOT_FOUND_ENTRY);
    assert.equal((await StaffTimeOff.findById(entry.id).lean())?.start.toISOString(), entry.start); // intacte
  });

  it("le gérant ne gère pas un employé d'un autre centre", async () => {
    const w = await world();
    const m = manager(w, w.tunisId);
    assert.equal(failure(await createStaffTimeOff(m, String(w.bob._id), form(), NOW)).message, NOT_FOUND_STAFF);
    assert.equal(await count(), 0);
  });

  it("refuse une cible inexistante, d'une autre organisation, non STAFF ou un identifiant invalide, avec le même message", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const foreignCenter = await createCenter(other._id, "Étranger");
    const foreign = await createUser(other._id, [foreignCenter._id], "Intrus");
    const inconsistent = await createUser(other._id, [w.tunis._id], "Incohérent");
    const managerUser = await createUser(w.org._id, [w.tunis._id], "Gérant", "MANAGER");
    const ownerUser = await createUser(w.org._id, [w.tunis._id], "Patron", "OWNER");
    const targets: unknown[] = [String(foreign._id), String(inconsistent._id), String(managerUser._id), String(ownerUser._id), "64b7f0c2a1b2c3d4e5f60718", "pas-un-id", "", undefined, null, 42, { $ne: null }];
    for (const target of targets) {
      assert.equal(failure(await createStaffTimeOff(owner(w), target, form(), NOW)).message, NOT_FOUND_STAFF, JSON.stringify(target));
      assert.equal(failure(await listStaffTimeOff(owner(w), target, NOW)).message, NOT_FOUND_STAFF, JSON.stringify(target));
    }
    assert.equal(await count(), 0);
  });

  it("refuse une absence inconnue, d'une autre organisation, d'un employé qui n'est plus STAFF ou un identifiant invalide", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    // Une autre organisation ne voit ni ne modifie ni ne supprime cette absence.
    const otherOrg = await createOrg("Autre salon");
    const otherCenter = await createCenter(otherOrg._id, "Ailleurs");
    const otherOwner: CurrentUser = { ...viewer(w, "OWNER", []), organization: { id: String(otherOrg._id), name: "Autre", slug: otherOrg.slug, centers: [{ id: String(otherCenter._id), name: "Ailleurs", governorate: "TUNIS" }] } };
    for (const id of [entry.id, "64b7f0c2a1b2c3d4e5f60718", "pas-un-id", "", undefined, null, { $ne: null }]) {
      assert.equal(failure(await updateStaffTimeOff(otherOwner, id, days("2030-03-01"), NOW)).message, NOT_FOUND_ENTRY, JSON.stringify(id));
      assert.equal(failure(await deleteStaffTimeOff(otherOwner, id)).message, NOT_FOUND_ENTRY, JSON.stringify(id));
    }
    // Même chose si l'employé est devenu gérant.
    await User.updateOne({ _id: w.alice._id }, { role: "MANAGER" });
    assert.equal(failure(await updateStaffTimeOff(owner(w), entry.id, days("2030-03-01"), NOW)).message, NOT_FOUND_ENTRY);
    assert.equal(failure(await deleteStaffTimeOff(owner(w), entry.id)).message, NOT_FOUND_ENTRY);
    assert.equal(await count(), 1);
  });

  it("la réponse est la même pour une cible inaccessible et inexistante (pas de fuite d'information)", async () => {
    const w = await world();
    const m = manager(w, w.tunisId);
    assert.deepEqual(await createStaffTimeOff(m, "64b7f0c2a1b2c3d4e5f60718", form(), NOW), await createStaffTimeOff(m, String(w.bob._id), form(), NOW));
    assert.deepEqual(await listStaffTimeOff(m, "64b7f0c2a1b2c3d4e5f60718", NOW), await listStaffTimeOff(m, String(w.bob._id), NOW));
  });

  it("les absences d'une organisation ne sont jamais visibles ni modifiées depuis une autre", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const otherCenter = await createCenter(other._id, "Ailleurs");
    const stranger = await createUser(other._id, [otherCenter._id], "Intrus");
    const mine = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    await StaffTimeOff.create({ organizationId: other._id, userId: stranger._id, kind: "LEAVE", start: fromLocal(2030, 1, 8), end: fromLocal(2030, 1, 9), allDay: true });
    const list = (await listStaffTimeOff(owner(w), String(w.alice._id), NOW)) as { items: StaffTimeOffView[] };
    assert.deepEqual(list.items.map((i) => i.id), [mine.id]);
    assert.equal(await StaffTimeOff.countDocuments({ organizationId: other._id }), 1);
  });
});

describe("chevauchements", () => {
  it("refuse une absence qui chevauche une autre du même employé : partielle, incluse, englobante ou identique", async () => {
    const w = await world();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-10", "2030-01-14"), NOW));
    for (const [from, to] of [["2030-01-08", "2030-01-10"], ["2030-01-12", "2030-01-12"], ["2030-01-09", "2030-01-20"], ["2030-01-10", "2030-01-14"], ["2030-01-14", "2030-01-16"]]) {
      const r = failure(await createStaffTimeOff(owner(w), String(w.alice._id), days(from, to), NOW));
      assert.deepEqual(r.errors, { startDay: [OVERLAP] }, `${from}→${to}`);
    }
    assert.equal(await count(), 1);
  });

  it("refuse le chevauchement quel que soit le type, et entre journée complète et plage horaire", async () => {
    const w = await world();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-10", "2030-01-10"), NOW));
    const asAbsence = failure(await createStaffTimeOff(owner(w), String(w.alice._id), { kind: "ABSENCE", mode: "range", startDay: "2030-01-10", from: "09:00", to: "10:00" }, NOW));
    assert.deepEqual(asAbsence.errors, { startDay: [OVERLAP] });
  });

  it("accepte des absences adjacentes (la fin de l'une est le début de l'autre) ", async () => {
    const w = await world();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-10", "2030-01-12"), NOW));
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-08", "2030-01-09"), NOW)); // finit à minuit : touche le 10
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-13", "2030-01-14"), NOW)); // commence où l'autre finit
    created(await createStaffTimeOff(owner(w), String(w.alice._id), { kind: "ABSENCE", mode: "range", startDay: "2030-01-15", from: "09:00", to: "12:00" }, NOW));
    created(await createStaffTimeOff(owner(w), String(w.alice._id), { kind: "ABSENCE", mode: "range", startDay: "2030-01-15", from: "12:00", to: "14:00" }, NOW)); // plages qui se touchent
    assert.equal(await count(), 5);
  });

  it("n'applique le contrôle qu'au même employé : un autre employé peut être absent aux mêmes dates", async () => {
    const w = await world();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    created(await createStaffTimeOff(owner(w), String(w.carla._id), form(), NOW));
    created(await createStaffTimeOff(owner(w), String(w.bob._id), form(), NOW));
    assert.equal(await count(), 3);
  });

  it("une absence supprimée libère la période", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    failure(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    assert.equal((await deleteStaffTimeOff(owner(w), entry.id)).ok, true);
    created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
  });

  it("[concurrence] le contrôle n'est pas atomique : des créations simultanées peuvent toutes passer, sans erreur technique", async () => {
    // Lecture puis écriture : plusieurs requêtes simultanées peuvent voir « aucun chevauchement » avant qu'une autre
    // n'écrive. Ce test ne suppose donc PAS qu'une seule réussit : il vérifie seulement qu'au moins une réussit et que
    // chaque refus est un refus de chevauchement. (Limite documentée dans lib/models/team.ts.)
    const w = await world();
    const results = await Promise.all(Array.from({ length: 6 }, () => createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW)));
    const ok = results.filter((r) => r.ok).length;
    assert.ok(ok >= 1 && ok <= 6);
    for (const r of results.filter((x) => !x.ok)) assert.deepEqual((r as { errors?: unknown }).errors, { startDay: [OVERLAP] });
    assert.equal(await count(), ok);
  });
});

describe("rendez-vous concernés (lecture seule)", () => {
  it("compte les rendez-vous actifs de l'employé qui chevauchent l'absence, sans en modifier aucun", async () => {
    const w = await world();
    await book(w, w.alice, fromLocal(2030, 1, 9, 10, 0), 60, "CONFIRMED"); // compté
    await book(w, w.alice, fromLocal(2030, 1, 9, 14, 0), 30, "PENDING"); // compté
    await book(w, w.alice, fromLocal(2030, 1, 8, 9, 0), 60, "CANCELLED"); // annulé : non
    await book(w, w.alice, fromLocal(2030, 1, 8, 11, 0), 60, "COMPLETED"); // terminé : non
    await book(w, w.alice, fromLocal(2030, 1, 8, 15, 0), 60, "NO_SHOW"); // absent : non
    await book(w, w.carla, fromLocal(2030, 1, 9, 10, 0), 60, "CONFIRMED"); // autre employé : non
    await book(w, w.alice, fromLocal(2030, 1, 11, 10, 0), 60, "CONFIRMED"); // après l'absence : non
    await book(w, w.alice, fromLocal(2030, 1, 7, 15, 0), 60, "CONFIRMED"); // avant l'absence : non
    const bookingsBefore = await Booking.find().sort({ _id: 1 }).lean();

    const view = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    assert.equal(view.affectedBookings, 2);
    assert.deepEqual(await Booking.find().sort({ _id: 1 }).lean(), bookingsBefore); // aucun rendez-vous modifié
    assert.equal(await Notification.countDocuments(), 0); // aucun message envoyé
    assert.equal(await WaitlistEntry.countDocuments(), 0);
  });

  it("un rendez-vous qui touche seulement la limite de l'absence n'est pas concerné", async () => {
    const w = await world();
    await book(w, w.alice, fromLocal(2030, 1, 7, 23, 0), 60); // finit à minuit pile (début de l'absence du 8)
    await book(w, w.alice, fromLocal(2030, 1, 11, 0, 0), 60); // commence à minuit pile (fin de l'absence du 8 au 10)
    assert.equal(created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW)).affectedBookings, 0);
    // Un rendez-vous à cheval sur le début de l'absence est, lui, concerné (Carla : 23 h 30 → 0 h 30).
    await book(w, w.carla, fromLocal(2030, 1, 7, 23, 30), 60);
    assert.equal(created(await createStaffTimeOff(owner(w), String(w.carla._id), form(), NOW)).affectedBookings, 1);
  });

  it("ne compte que les rendez-vous non terminés : un rendez-vous déjà passé n'est jamais « concerné »", async () => {
    const w = await world();
    await book(w, w.alice, fromLocal(2030, 1, 1, 10, 0), 60, "CONFIRMED"); // passé
    assert.equal(created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-01", "2030-01-02"), NOW)).affectedBookings, 0); // absence passée
    // Absence en cours (7 au 9 janvier, « maintenant » = 7 janvier 10 h) : seuls les rendez-vous qui finissent après maintenant comptent.
    await book(w, w.bob, fromLocal(2030, 1, 7, 9, 0), 60); // sans effet : autre employé
    await book(w, w.carla, fromLocal(2030, 1, 7, 9, 0), 60, "CONFIRMED"); // finit pile à « maintenant » : non
    await book(w, w.carla, fromLocal(2030, 1, 7, 11, 0), 60, "CONFIRMED"); // à venir : oui
    const view = created(await createStaffTimeOff(owner(w), String(w.carla._id), days("2030-01-07", "2030-01-09"), NOW));
    assert.equal(view.affectedBookings, 1);
  });

  it("créer, modifier et supprimer une absence ne modifie jamais un rendez-vous", async () => {
    const w = await world();
    await book(w, w.alice, fromLocal(2030, 1, 9, 10, 0), 60, "CONFIRMED");
    await book(w, w.alice, fromLocal(2030, 1, 9, 14, 0), 60, "PENDING");
    const before = await Booking.find().sort({ _id: 1 }).lean();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    assert.equal(entry.affectedBookings, 2);
    const updated = (await updateStaffTimeOff(owner(w), entry.id, days("2030-01-09", "2030-01-09"), NOW)) as { ok: true; timeOff: StaffTimeOffView };
    assert.equal(updated.timeOff.affectedBookings, 2);
    assert.equal((await deleteStaffTimeOff(owner(w), entry.id)).ok, true);
    assert.deepEqual(await Booking.find().sort({ _id: 1 }).lean(), before);
  });
});

describe("updateStaffTimeOff : modification", () => {
  it("modifie type, dates et motif, sans changer l'employé, l'organisation ni l'auteur", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: "Vacances" }), NOW));
    const before = await StaffTimeOff.findById(entry.id).lean();
    const r = (await updateStaffTimeOff(owner(w), entry.id, { kind: "ABSENCE", mode: "range", startDay: "2030-01-12", from: "09:00", to: "11:30", reason: "Rendez-vous médical" }, NOW)) as { ok: true; changed: boolean; timeOff: StaffTimeOffView };
    assert.equal(r.changed, true);
    assert.equal(r.timeOff.kind, "ABSENCE");
    assert.equal(r.timeOff.allDay, false);
    assert.equal(r.timeOff.start, "2030-01-12T08:00:00.000Z");
    assert.equal(r.timeOff.reason, "Rendez-vous médical");
    const after = await StaffTimeOff.findById(entry.id).lean();
    assert.equal(String(after?.userId), String(before?.userId));
    assert.equal(String(after?.organizationId), String(before?.organizationId));
    assert.equal(String(after?.createdBy), String(before?.createdBy));
    assert.equal(after?.reason, "Rendez-vous médical");
    assert.equal(await count(), 1);
  });

  it("supprime le motif quand il est vidé, et ne peut pas déplacer l'absence vers un autre employé", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: "Vacances" }), NOW));
    const r = (await updateStaffTimeOff(owner(w), entry.id, { ...form({ reason: "" }), userId: String(w.bob._id), organizationId: "x" }, NOW)) as { ok: true; changed: boolean; timeOff: StaffTimeOffView };
    assert.equal(r.changed, true);
    assert.equal(r.timeOff.reason, null);
    const raw = await StaffTimeOff.collection.findOne({ _id: new (await import("mongoose")).Types.ObjectId(entry.id) });
    assert.ok(raw && !("reason" in raw));
    assert.equal(String(raw.userId), String(w.alice._id));
  });

  it("sans changement réel : aucune écriture (updatedAt inchangé) et changed = false", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: "Vacances" }), NOW));
    const before = (await StaffTimeOff.findById(entry.id).lean())!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    for (const same of [form({ reason: "Vacances" }), form({ reason: "  Vacances  ", endDay: "2030-01-10" }), form({ reason: "Vacances", extra: "ignoré", userId: String(w.bob._id) })]) {
      const r = (await updateStaffTimeOff(owner(w), entry.id, same, NOW)) as { ok: true; changed: boolean; timeOff: StaffTimeOffView };
      assert.equal(r.changed, false);
      assert.equal(r.timeOff.id, entry.id);
    }
    assert.deepEqual((await StaffTimeOff.findById(entry.id).lean())!.updatedAt, before);
  });

  it("une absence sans motif resoumise sans motif ne change pas", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    for (const reason of [undefined, "", "   "]) {
      const r = (await updateStaffTimeOff(owner(w), entry.id, form({ reason }), NOW)) as { ok: true; changed: boolean };
      assert.equal(r.changed, false, JSON.stringify(reason));
    }
  });

  it("exclut l'entrée modifiée du contrôle : elle peut s'étendre sur son ancienne période, pas sur celle d'une autre", async () => {
    const w = await world();
    const first = created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-08", "2030-01-10"), NOW));
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-20", "2030-01-22"), NOW));
    assert.equal(((await updateStaffTimeOff(owner(w), first.id, days("2030-01-08", "2030-01-12"), NOW)) as { changed: boolean }).changed, true); // s'étend
    assert.equal(((await updateStaffTimeOff(owner(w), first.id, days("2030-01-09", "2030-01-09"), NOW)) as { changed: boolean }).changed, true); // se réduit
    assert.equal(((await updateStaffTimeOff(owner(w), first.id, days("2030-01-18", "2030-01-19"), NOW)) as { changed: boolean }).changed, true); // adjacente à la seconde
    const clash = failure(await updateStaffTimeOff(owner(w), first.id, days("2030-01-19", "2030-01-21"), NOW));
    assert.deepEqual(clash.errors, { startDay: [OVERLAP] });
    assert.equal((await StaffTimeOff.findById(first.id).lean())?.start.toISOString(), fromLocal(2030, 1, 18).toISOString()); // inchangée par le refus
  });

  it("refuse les saisies invalides par champ sans rien modifier", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    const r = failure(await updateStaffTimeOff(owner(w), entry.id, days("2030-01-10", "2030-01-08"), NOW));
    assert.deepEqual(r.errors, { endDay: ["La date de fin doit être le même jour ou après la date de début."] });
    assert.equal((await StaffTimeOff.findById(entry.id).lean())?.end.toISOString(), entry.end);
  });
});

// Absence ancienne : son début dépasse la borne de 365 jours dans le passé (NOW = 7 janvier 2030).
describe("updateStaffTimeOff : absence ancienne hors des bornes de dates", () => {
  async function oldEntry(w: World, extra: Record<string, unknown> = {}) {
    const doc = await StaffTimeOff.create({
      organizationId: w.org._id,
      userId: w.alice._id,
      kind: "LEAVE",
      start: fromLocal(2028, 1, 10),
      end: fromLocal(2028, 1, 13), // 10 au 12 janvier 2028 inclus
      allDay: true,
      reason: "Ancien motif",
      ...extra,
    });
    return String(doc._id);
  }
  const sameDates = (extra: Record<string, unknown> = {}) => ({ kind: "LEAVE", mode: "days", startDay: "2028-01-10", endDay: "2028-01-12", reason: "Ancien motif", ...extra });
  const result = (r: { ok: boolean }) => r as { ok: true; changed: boolean; timeOff: StaffTimeOffView };
  const stored = async (id: string) => StaffTimeOff.findById(id).lean();

  it("autorise de corriger seulement le motif : les dates hors fenêtre sont conservées", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const before = await stored(id);
    const r = result(await updateStaffTimeOff(owner(w), id, sameDates({ reason: "Motif corrigé" }), NOW));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.changed, true);
    assert.equal(r.timeOff.reason, "Motif corrigé");
    const after = await stored(id);
    assert.equal(after?.reason, "Motif corrigé");
    assert.equal(after?.start.toISOString(), before?.start.toISOString());
    assert.equal(after?.end.toISOString(), before?.end.toISOString());
    assert.equal(after?.allDay, true);
    assert.equal(String(after?.userId), String(w.alice._id));
  });

  it("autorise d'ajouter, de retirer le motif ou de changer le type, sans changer les dates", async () => {
    const w = await world();
    const id = await oldEntry(w);
    assert.equal(result(await updateStaffTimeOff(owner(w), id, sameDates({ kind: "ABSENCE" }), NOW)).changed, true);
    assert.equal((await stored(id))?.kind, "ABSENCE");
    assert.equal(result(await updateStaffTimeOff(owner(w), id, sameDates({ kind: "ABSENCE", reason: "" }), NOW)).changed, true);
    const raw = await StaffTimeOff.collection.findOne({ _id: new (await import("mongoose")).Types.ObjectId(id) });
    assert.ok(raw && !("reason" in raw));
    assert.equal(result(await updateStaffTimeOff(owner(w), id, sameDates({ kind: "ABSENCE", reason: "Nouveau" }), NOW)).changed, true);
    assert.equal((await stored(id))?.start.toISOString(), fromLocal(2028, 1, 10).toISOString());
  });

  it("une resoumission identique ne change rien et n'écrit rien", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const before = (await stored(id))!.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const r = result(await updateStaffTimeOff(owner(w), id, sameDates(), NOW));
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
    assert.deepEqual((await stored(id))!.updatedAt, before);
  });

  it("conserve aussi une plage horaire ancienne et une durée ou une fin hors bornes", async () => {
    const w = await world();
    const rangeId = await oldEntry(w, { allDay: false, start: fromLocal(2028, 3, 1, 9, 0), end: fromLocal(2028, 3, 1, 12, 0) });
    const ok = result(await updateStaffTimeOff(owner(w), rangeId, { kind: "LEAVE", mode: "range", startDay: "2028-03-01", from: "09:00", to: "12:00", reason: "Corrigé" }, NOW));
    assert.equal(ok.changed, true);
    // Absence de plus de 366 jours enregistrée avant : le motif reste modifiable.
    const longId = await oldEntry(w, { start: fromLocal(2028, 6, 1), end: fromLocal(2029, 8, 1), reason: "Longue" });
    const long = result(await updateStaffTimeOff(owner(w), longId, { kind: "LEAVE", mode: "days", startDay: "2028-06-01", endDay: "2029-07-31", reason: "Longue, corrigée" }, NOW));
    assert.equal(long.ok, true, JSON.stringify(long));
    assert.equal(long.changed, true);
  });

  it("si les dates changent, les nouvelles dates sont validées comme à la création : début encore hors fenêtre refusé", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const before = await stored(id);
    for (const patch of [{ endDay: "2028-01-20" }, { startDay: "2028-01-11" }, { startDay: "2028-01-05", endDay: "2028-01-12" }]) {
      const r = failure(await updateStaffTimeOff(owner(w), id, sameDates({ ...patch, reason: "Ne doit pas être enregistré" }), NOW));
      assert.deepEqual(r.errors, { startDay: ["Le début ne peut pas dater de plus de 365 jours."] }, JSON.stringify(patch));
    }
    const after = await stored(id);
    assert.equal(after?.reason, "Ancien motif"); // rien n'a été écrit, pas même le motif
    assert.equal(after?.start.toISOString(), before?.start.toISOString());
    assert.equal(after?.end.toISOString(), before?.end.toISOString());
  });

  it("un passage de journée complète à plage horaire (dates modifiées) est aussi validé selon les bornes", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const r = failure(await updateStaffTimeOff(owner(w), id, { kind: "LEAVE", mode: "range", startDay: "2028-01-10", from: "09:00", to: "12:00" }, NOW));
    assert.deepEqual(r.errors, { startDay: ["Le début ne peut pas dater de plus de 365 jours."] });
  });

  it("si les nouvelles dates respectent les bornes, la modification est acceptée et déplace bien l'absence", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const r = result(await updateStaffTimeOff(owner(w), id, { kind: "LEAVE", mode: "days", startDay: "2030-02-01", endDay: "2030-02-03", reason: "Replanifiée" }, NOW));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.changed, true);
    const after = await stored(id);
    assert.equal(after?.start.toISOString(), fromLocal(2030, 2, 1).toISOString());
    assert.equal(after?.end.toISOString(), fromLocal(2030, 2, 4).toISOString());
    // Dates trop lointaines ou durée excessive : toujours refusées quand elles changent.
    assert.deepEqual(failure(await updateStaffTimeOff(owner(w), id, { kind: "LEAVE", mode: "days", startDay: "2033-01-01", endDay: "2033-01-02" }, NOW)).errors, { endDay: ["La fin ne peut pas dépasser 730 jours à partir d'aujourd'hui."] });
    assert.deepEqual(failure(await updateStaffTimeOff(owner(w), id, { kind: "LEAVE", mode: "days", startDay: "2030-01-07", endDay: "2031-02-01" }, NOW)).errors, { endDay: ["Une absence ne peut pas durer plus de 366 jours."] });
  });

  it("garde les autres validations du formulaire même quand les dates ne changent pas", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const tooLong = failure(await updateStaffTimeOff(owner(w), id, sameDates({ reason: "x".repeat(121) }), NOW));
    assert.deepEqual(Object.keys(tooLong.errors ?? {}), ["reason"]);
    const badKind = failure(await updateStaffTimeOff(owner(w), id, sameDates({ kind: "SICK" }), NOW));
    assert.deepEqual(Object.keys(badKind.errors ?? {}), ["kind"]);
    assert.deepEqual(failure(await updateStaffTimeOff(owner(w), id, sameDates({ startDay: "2028-02-31" }), NOW)).errors, { startDay: ["Date invalide."] });
    assert.equal(failure(await updateStaffTimeOff(owner(w), id, sameDates({ endDay: "2028-01-05" }), NOW)).errors?.endDay?.[0], "La date de fin doit être le même jour ou après la date de début.");
    assert.equal((await stored(id))?.reason, "Ancien motif");
  });

  it("garde les permissions, l'organisation et la règle des centres pour une absence ancienne", async () => {
    const w = await world();
    const id = await oldEntry(w);
    const sharedId = await oldEntry(w, { userId: w.carla._id });
    const edit = (actor: CurrentUser, target: string) => updateStaffTimeOff(actor, target, sameDates({ reason: "Piratée" }), NOW);
    for (const role of ["STAFF", "CLIENT", "SUPER_ADMIN"] as const) assert.equal(failure(await edit(viewer(w, role, [w.tunisId]), id)).message, "Accès refusé.", role);
    assert.equal(failure(await edit(manager(w, w.sousseId), id)).message, NOT_FOUND_ENTRY); // autre centre
    assert.equal(failure(await edit(manager(w, w.tunisId), sharedId)).message, NOT_FOUND_ENTRY); // employé partagé
    const otherOrg = await createOrg("Autre salon");
    const otherCenter = await createCenter(otherOrg._id, "Ailleurs");
    const otherOwner: CurrentUser = { ...viewer(w, "OWNER", []), organization: { id: String(otherOrg._id), name: "Autre", slug: otherOrg.slug, centers: [{ id: String(otherCenter._id), name: "Ailleurs", governorate: "TUNIS" }] } };
    assert.equal(failure(await edit(otherOwner, id)).message, NOT_FOUND_ENTRY);
    assert.equal((await stored(id))?.reason, "Ancien motif");
    // Le gérant du bon centre, lui, peut corriger le motif.
    assert.equal(result(await edit(manager(w, w.tunisId), id)).changed, true);
  });

  it("une correction de motif ou de type reste possible même si l'absence en chevauche déjà une autre", async () => {
    const w = await world();
    const id = await oldEntry(w);
    // Un doublon antérieur (par exemple issu de la concurrence documentée) chevauche l'absence ancienne.
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "ABSENCE", start: fromLocal(2028, 1, 11), end: fromLocal(2028, 1, 14), allDay: true });
    const motif = result(await updateStaffTimeOff(owner(w), id, sameDates({ reason: "Corrigé" }), NOW));
    assert.equal(motif.ok, true, JSON.stringify(motif));
    assert.equal(motif.changed, true);
    assert.equal((await stored(id))?.reason, "Corrigé");
    const type = result(await updateStaffTimeOff(owner(w), id, sameDates({ reason: "Corrigé", kind: "ABSENCE" }), NOW));
    assert.equal(type.ok, true);
    assert.equal((await stored(id))?.kind, "ABSENCE");
    // Une resoumission identique : toujours aucune écriture.
    const same = result(await updateStaffTimeOff(owner(w), id, sameDates({ reason: "Corrigé", kind: "ABSENCE" }), NOW));
    assert.equal(same.changed, false);
  });

  it("les permissions, l'organisation et la validation restent exigées pour cette correction, malgré le chevauchement", async () => {
    const w = await world();
    const id = await oldEntry(w);
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "ABSENCE", start: fromLocal(2028, 1, 11), end: fromLocal(2028, 1, 14), allDay: true });
    assert.equal(failure(await updateStaffTimeOff(viewer(w, "STAFF", [w.tunisId]), id, sameDates({ reason: "X" }), NOW)).message, "Accès refusé.");
    assert.equal(failure(await updateStaffTimeOff(manager(w, w.sousseId), id, sameDates({ reason: "X" }), NOW)).message, NOT_FOUND_ENTRY);
    assert.deepEqual(Object.keys(failure(await updateStaffTimeOff(owner(w), id, sameDates({ reason: "x".repeat(121) }), NOW)).errors ?? {}), ["reason"]);
    assert.equal((await stored(id))?.reason, "Ancien motif");
  });

  it("un changement de période est, lui, contrôlé contre les chevauchements : dates, durée ou passage journée/plage", async () => {
    const w = await world();
    // A : 8 au 10 janvier 2030 ; B (insérée directement) : 9 au 11 janvier, elle chevauche A.
    const a = created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-08", "2030-01-10", { reason: "A" }), NOW));
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "ABSENCE", start: fromLocal(2030, 1, 9), end: fromLocal(2030, 1, 12), allDay: true });
    const bounds = async () => (await StaffTimeOff.findById(a.id).lean())!.end.toISOString();
    // Motif seul : accepté malgré le chevauchement existant.
    assert.equal(result(await updateStaffTimeOff(owner(w), a.id, days("2030-01-08", "2030-01-10", { reason: "A corrigée" }), NOW)).changed, true);
    // Période modifiée mais chevauchant encore B : refusé, rien n'est écrit.
    for (const [from, to] of [["2030-01-08", "2030-01-09"], ["2030-01-08", "2030-01-12"], ["2030-01-10", "2030-01-10"]]) {
      assert.deepEqual(failure(await updateStaffTimeOff(owner(w), a.id, days(from, to, { reason: "A corrigée" }), NOW)).errors, { startDay: [OVERLAP] }, `${from}→${to}`);
    }
    const toRange = failure(await updateStaffTimeOff(owner(w), a.id, { kind: "LEAVE", mode: "range", startDay: "2030-01-09", from: "09:00", to: "10:00", reason: "A corrigée" }, NOW));
    assert.deepEqual(toRange.errors, { startDay: [OVERLAP] });
    assert.equal(await bounds(), fromLocal(2030, 1, 11).toISOString()); // période inchangée par les refus
    // Période modifiée sans chevauchement (adjacente à B) : acceptée.
    assert.equal(result(await updateStaffTimeOff(owner(w), a.id, days("2030-01-08", "2030-01-08", { reason: "A corrigée" }), NOW)).changed, true);
    assert.equal(await bounds(), fromLocal(2030, 1, 9).toISOString());
  });

  it("la création respecte toujours toutes les bornes de dates", async () => {
    const w = await world();
    assert.deepEqual(failure(await createStaffTimeOff(owner(w), String(w.alice._id), days("2028-01-10", "2028-01-12"), NOW)).errors, { startDay: ["Le début ne peut pas dater de plus de 365 jours."] });
    assert.deepEqual(failure(await createStaffTimeOff(owner(w), String(w.alice._id), days("2033-01-01", "2033-01-02"), NOW)).errors, { endDay: ["La fin ne peut pas dépasser 730 jours à partir d'aujourd'hui."] });
    assert.deepEqual(failure(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-07", "2031-02-01"), NOW)).errors, { endDay: ["Une absence ne peut pas durer plus de 366 jours."] });
    assert.equal(await count(), 0);
  });

  it("une absence ancienne reste supprimable", async () => {
    const w = await world();
    const id = await oldEntry(w);
    assert.equal((await deleteStaffTimeOff(owner(w), id)).ok, true);
  });
});

describe("deleteStaffTimeOff : suppression", () => {
  it("supprime l'absence demandée seulement, sans toucher aux autres ni à rien d'autre", async () => {
    const w = await world();
    const a = created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-08", "2030-01-09"), NOW));
    const b = created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-15", "2030-01-16"), NOW));
    await book(w, w.alice, fromLocal(2030, 1, 8, 10, 0));
    const bookingsBefore = await Booking.find().lean();
    // Le résumé renvoyé sert à l'audit : employé, type et dates, jamais le motif.
    assert.deepEqual(await deleteStaffTimeOff(owner(w), a.id), {
      ok: true,
      deleted: { staffId: String(w.alice._id), kind: "LEAVE", start: a.start, end: a.end, allDay: true },
    });
    assert.equal(await StaffTimeOff.findById(a.id), null);
    assert.ok(await StaffTimeOff.findById(b.id));
    assert.deepEqual(await Booking.find().lean(), bookingsBefore);
  });

  it("une seconde suppression de la même absence répond « introuvable »", async () => {
    const w = await world();
    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form(), NOW));
    assert.equal((await deleteStaffTimeOff(owner(w), entry.id)).ok, true);
    assert.equal(failure(await deleteStaffTimeOff(owner(w), entry.id)).message, NOT_FOUND_ENTRY);
  });
});

describe("listStaffTimeOff : liste détaillée d'un employé", () => {
  it("renvoie d'abord les absences en cours ou à venir (la plus proche en premier), puis les passées (la plus récente en premier)", async () => {
    const w = await world();
    const create = async (startDay: string, endDay: string, reason?: string) => created(await createStaffTimeOff(owner(w), String(w.alice._id), days(startDay, endDay, reason ? { reason } : {}), NOW));
    const farFuture = await create("2030-03-01", "2030-03-02", "lointaine");
    const ongoing = await create("2030-01-06", "2030-01-08", "en cours");
    const nearFuture = await create("2030-01-20", "2030-01-21", "proche");
    const pastOld = await create("2029-12-01", "2029-12-02", "ancienne");
    const pastRecent = await create("2030-01-02", "2030-01-03", "récente");
    const r = (await listStaffTimeOff(owner(w), String(w.alice._id), NOW)) as { ok: true; items: StaffTimeOffView[] };
    assert.deepEqual(r.items.map((i) => i.id), [ongoing.id, nearFuture.id, farFuture.id, pastRecent.id, pastOld.id]);
    assert.deepEqual(r.items.map((i) => i.reason), ["en cours", "proche", "lointaine", "récente", "ancienne"]);
  });

  it("n'inclut que les absences de cet employé, avec le nombre de rendez-vous concernés de chacune", async () => {
    const w = await world();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), days("2030-01-08", "2030-01-09"), NOW));
    created(await createStaffTimeOff(owner(w), String(w.carla._id), days("2030-01-08", "2030-01-09"), NOW));
    await book(w, w.alice, fromLocal(2030, 1, 8, 10, 0));
    const alice = (await listStaffTimeOff(owner(w), String(w.alice._id), NOW)) as { items: StaffTimeOffView[] };
    const carla = (await listStaffTimeOff(owner(w), String(w.carla._id), NOW)) as { items: StaffTimeOffView[] };
    assert.deepEqual(alice.items.map((i) => [i.staffId, i.affectedBookings]), [[String(w.alice._id), 1]]);
    assert.deepEqual(carla.items.map((i) => [i.staffId, i.affectedBookings]), [[String(w.carla._id), 0]]);
  });

  it("renvoie une liste vide sans absence, et plafonne la liste aux 200 absences les plus récentes", async () => {
    const w = await world();
    assert.deepEqual(await listStaffTimeOff(owner(w), String(w.alice._id), NOW), { ok: true, items: [] });
    await StaffTimeOff.insertMany(
      Array.from({ length: 205 }, (_, i) => ({ organizationId: w.org._id, userId: w.alice._id, kind: "LEAVE", start: fromLocal(2030, 1, 1 + (i % 28), 0, i), end: fromLocal(2030, 1, 1 + (i % 28), 0, i + 1), allDay: false })),
    );
    assert.equal(((await listStaffTimeOff(owner(w), String(w.alice._id), NOW)) as { items: unknown[] }).items.length, 200);
  });
});

describe("confidentialité du motif", () => {
  it("le motif n'apparaît jamais dans la liste générale de l'équipe", async () => {
    const w = await world();
    created(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: "Traitement médical confidentiel" }), NOW));
    const roster = await getTeamRoster(owner(w));
    const text = JSON.stringify(roster);
    assert.ok(!text.includes("médical") && !text.includes("confidentiel") && !text.includes("reason"));
  });

  it("une erreur technique renvoie un message générique et n'écrit jamais le motif dans les journaux", async () => {
    const w = await world();
    const secret = "Diagnostic confidentiel";
    mock.method(StaffTimeOff, "create", () => {
      throw Object.assign(new Error(`échec : ${secret}`), { name: "MongoNetworkError", code: 6 });
    });
    const logged: unknown[][] = [];
    mock.method(console, "error", (...args: unknown[]) => void logged.push(args));
    const r = await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: secret }), NOW);
    assert.deepEqual(r, { ok: false, message: "Impossible d'enregistrer l'absence. Réessayez." });
    assert.ok(logged.length > 0);
    assert.ok(!JSON.stringify(logged).includes(secret));
    assert.ok(!JSON.stringify(r).includes(secret));
  });

  it("les erreurs de validation ne reprennent pas le motif saisi", async () => {
    const w = await world();
    const secret = "x".repeat(200) + " motif-sensible";
    const r = failure(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: secret }), NOW));
    assert.ok(!JSON.stringify(r).includes("motif-sensible"));
    assert.deepEqual(Object.keys(r.errors ?? {}), ["reason"]);
  });
});

describe("aucun effet collatéral", () => {
  it("n'écrit ni dans AvailabilityBlock, ni dans les centres, ni dans les utilisateurs, ni dans les horaires individuels", async () => {
    const w = await world();
    await User.updateOne({ _id: w.alice._id }, { workingHours: { lundi: "09:00-17:00", mardi: null }, jobTitle: "Coloriste", skills: ["Coloriste"] });
    await insertBlock({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.alice._id, start: at(12), end: at(13) });
    const snapshot = async () => ({
      users: await User.find().sort({ _id: 1 }).lean(),
      centers: await Center.find().sort({ _id: 1 }).lean(),
      blocks: await AvailabilityBlock.find().sort({ _id: 1 }).lean(),
    });
    const before = await snapshot();

    const entry = created(await createStaffTimeOff(owner(w), String(w.alice._id), form({ reason: "Vacances" }), NOW));
    await updateStaffTimeOff(owner(w), entry.id, days("2030-02-01", "2030-02-02"), NOW);
    await listStaffTimeOff(owner(w), String(w.alice._id), NOW);
    await deleteStaffTimeOff(owner(w), entry.id);

    assert.deepEqual(await snapshot(), before);
    assert.equal(await count(), 0);
  });
});
