// F4 (étape 6) — Planning personnel en lecture seule : permissions, périmètre des centres, semaine à l'heure de Tunis,
// statuts, champs exposés et absence d'écriture. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { insertBlock, insertBooking, createCenter, createCustomer, createOrg, createUser, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { fromLocal } from "@/lib/booking/time";
import type { CurrentUser } from "@/lib/dal";
import { getStaffPlanning, type PlanningResult, type StaffPlanning } from "@/lib/data/planning";
import type { Role } from "@/lib/enums";
import { AvailabilityBlock, Booking } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";

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

// Mercredi 9 janvier 2030, 10 h à Tunis : la semaine courante va du lundi 7 au dimanche 13 janvier.
const NOW = fromLocal(2030, 1, 9, 10, 0);
const day = (d: number, h = 0, m = 0) => fromLocal(2030, 1, d, h, m);

type World = Awaited<ReturnType<typeof world>>;
async function world() {
  const org = await createOrg("Salon Yasmine");
  const tunis = await createCenter(org._id, "Tunis");
  const sousse = await createCenter(org._id, "Sousse");
  const alice = await createUser(org._id, [tunis._id], "Alice");
  const bob = await createUser(org._id, [sousse._id], "Bob");
  const carla = await createUser(org._id, [tunis._id, sousse._id], "Carla");
  const customer = await createCustomer(org._id);
  const centers = [
    { id: String(tunis._id), name: "Tunis", governorate: "TUNIS" as const },
    { id: String(sousse._id), name: "Sousse", governorate: "SOUSSE" as const },
  ];
  return { org, tunis, sousse, alice, bob, carla, customer, centers, tunisId: centers[0].id, sousseId: centers[1].id };
}
function viewer(w: World, role: Role, centerIds: string[], opts: { id?: string; organization?: boolean } = {}): CurrentUser {
  return {
    id: opts.id ?? "000000000000000000000001",
    firstName: "Acteur",
    lastName: "Test",
    email: null,
    phone: null,
    role,
    lastLoginAt: null,
    centerIds,
    organization: opts.organization === false ? null : { id: String(w.org._id), name: "Salon Yasmine", slug: w.org.slug, centers: w.centers },
  };
}
const owner = (w: World) => viewer(w, "OWNER", []);
const manager = (w: World, ...ids: string[]) => viewer(w, "MANAGER", ids);
const staffViewer = (w: World, who: { _id: unknown }, ...centerIds: string[]) => viewer(w, "STAFF", centerIds, { id: String(who._id) });
const book = (w: World, staff: { _id: unknown }, center: { _id: unknown }, start: Date, minutes = 60, status?: "CONFIRMED" | "PENDING" | "CANCELLED" | "COMPLETED" | "NO_SHOW") =>
  insertBooking({ organizationId: w.org._id, centerId: center._id as string, staffId: staff._id as string, customerId: w.customer._id, start, minutes, status });

const plan = (r: PlanningResult): StaffPlanning => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<PlanningResult, { ok: true }>).planning;
};
const refused = (r: PlanningResult) => {
  assert.equal(r.ok, false, "refus attendu");
  return (r as Extract<PlanningResult, { ok: false }>).reason;
};
const get = (u: CurrentUser, staffId: unknown, extra: { week?: string | null } = {}) => getStaffPlanning(u, { staffId: staffId as string, now: NOW, ...extra });
const dayOf = (p: StaffPlanning, key: string) => p.days.find((d) => d.key === key)!;
const allBookingIds = (p: StaffPlanning) => p.days.flatMap((d) => d.bookings.map((b) => b.id));

describe("getStaffPlanning : permissions", () => {
  it("un STAFF voit son propre planning, même s'il demande un autre employé dans l'URL", async () => {
    const w = await world();
    const mine = await book(w, w.alice, w.tunis, day(9, 14));
    const theirs = await book(w, w.bob, w.sousse, day(9, 14));
    for (const staffId of [undefined, null, String(w.alice._id), String(w.bob._id), String(w.carla._id), "n'importe quoi", { $ne: null }]) {
      const p = plan(await get(staffViewer(w, w.alice, w.tunisId), staffId));
      assert.equal(p.staff.id, String(w.alice._id), JSON.stringify(staffId));
      assert.equal(p.staff.isSelf, true);
      assert.deepEqual(allBookingIds(p), [String(mine._id)]);
      assert.ok(!allBookingIds(p).includes(String(theirs._id)));
    }
  });

  it("un STAFF ne voit que les rendez-vous de ses centres d'affectation", async () => {
    const w = await world();
    const inMine = await book(w, w.carla, w.tunis, day(9, 10));
    await book(w, w.carla, w.sousse, day(9, 14)); // Carla n'est plus affectée à Sousse dans cette simulation
    const p = plan(await get(staffViewer(w, w.carla, w.tunisId), undefined));
    assert.deepEqual(allBookingIds(p), [String(inMine._id)]);
  });

  it("le propriétaire voit n'importe quel employé de son organisation, tous centres confondus", async () => {
    const w = await world();
    const a = await book(w, w.carla, w.tunis, day(9, 10));
    const b = await book(w, w.carla, w.sousse, day(9, 14));
    const p = plan(await get(owner(w), String(w.carla._id)));
    assert.equal(p.staff.isSelf, false);
    assert.deepEqual(allBookingIds(p), [String(a._id), String(b._id)]);
    assert.equal(plan(await get(owner(w), String(w.bob._id))).staff.firstName, "Bob");
  });

  it("D5 : le gérant ne voit que les rendez-vous de ses centres, même pour un employé partagé", async () => {
    const w = await world();
    const inTunis = await book(w, w.carla, w.tunis, day(9, 10));
    const inSousse = await book(w, w.carla, w.sousse, day(9, 14));
    const p = plan(await get(manager(w, w.tunisId), String(w.carla._id)));
    assert.deepEqual(allBookingIds(p), [String(inTunis._id)]);
    assert.ok(!JSON.stringify(p).includes(String(inSousse._id)));
    assert.deepEqual(p.centers.map((c) => c.name), ["Tunis"]); // le centre de Sousse n'est pas révélé
  });

  it("le gérant ne voit pas un employé d'un autre centre ; sans employé demandé, introuvable", async () => {
    const w = await world();
    const m = manager(w, w.tunisId);
    assert.equal(refused(await get(m, String(w.bob._id))), "not-found");
    for (const bad of [undefined, null, "", "pas-un-id", "64b7f0c2a1b2c3d4e5f60718", 42, { $ne: null }]) {
      assert.equal(refused(await get(owner(w), bad)), "not-found", JSON.stringify(bad));
      assert.equal(refused(await get(m, bad)), "not-found", JSON.stringify(bad));
    }
  });

  it("refuse CLIENT, SUPER_ADMIN, un acteur sans organisation et un gérant sans centre", async () => {
    const w = await world();
    for (const role of ["CLIENT", "SUPER_ADMIN"] as const) assert.equal(refused(await get(viewer(w, role, [w.tunisId]), String(w.alice._id))), "forbidden", role);
    assert.equal(refused(await get(viewer(w, "OWNER", [], { organization: false }), String(w.alice._id))), "forbidden");
    assert.equal(refused(await get(viewer(w, "STAFF", [], { id: String(w.alice._id), organization: false }), undefined)), "forbidden");
    assert.equal(refused(await get(manager(w), String(w.alice._id))), "forbidden");
  });

  it("l'organisation est isolée : un employé d'une autre organisation est introuvable, même pour le propriétaire", async () => {
    const w = await world();
    const other = await createOrg("Autre salon");
    const otherCenter = await createCenter(other._id, "Ailleurs");
    const stranger = await createUser(other._id, [otherCenter._id], "Intrus");
    const inconsistent = await createUser(other._id, [w.tunis._id], "Incohérent");
    for (const s of [stranger, inconsistent]) assert.equal(refused(await get(owner(w), String(s._id))), "not-found");
    // Un STAFF d'une autre organisation ne se retrouve pas par son identifiant : « moi » doit exister dans l'organisation.
    const asStranger = viewer(w, "STAFF", [w.tunisId], { id: String(stranger._id) });
    assert.equal(refused(await get(asStranger, undefined)), "not-found");
    // Les rendez-vous d'une autre organisation sur un centre de la nôtre ne sont jamais lus.
    await StaffTimeOff.create({ organizationId: other._id, userId: w.alice._id, kind: "LEAVE", start: day(9), end: day(10), allDay: true });
    assert.equal(dayOf(plan(await get(owner(w), String(w.alice._id))), "2030-01-09").timeOff.length, 0);
  });

  it("refuse une cible qui n'est pas un STAFF : gérant, propriétaire", async () => {
    const w = await world();
    const managerUser = await createUser(w.org._id, [w.tunis._id], "Gérant", "MANAGER");
    const ownerUser = await createUser(w.org._id, [w.tunis._id], "Patron", "OWNER");
    for (const t of [managerUser, ownerUser]) assert.equal(refused(await get(owner(w), String(t._id))), "not-found");
  });
});

describe("getStaffPlanning : semaine à l'heure de Tunis", () => {
  it("par défaut, la semaine courante du lundi au dimanche, avec navigation", async () => {
    const w = await world();
    const p = plan(await get(owner(w), String(w.alice._id)));
    assert.equal(p.weekStart, "2030-01-07");
    assert.deepEqual(p.days.map((d) => d.key), ["2030-01-07", "2030-01-08", "2030-01-09", "2030-01-10", "2030-01-11", "2030-01-12", "2030-01-13"]);
    assert.deepEqual(p.days.map((d) => d.weekday), ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]);
    assert.equal(p.prevWeek, "2029-12-31");
    assert.equal(p.nextWeek, "2030-01-14");
    assert.equal(p.currentWeek, "2030-01-07");
    assert.equal(p.today, "2030-01-09");
  });

  it("?week accepte n'importe quel jour de la semaine voulue et se replie sur la semaine courante si invalide", async () => {
    const w = await world();
    const weekOf = async (week: unknown) => plan(await get(owner(w), String(w.alice._id), { week: week as string })).weekStart;
    assert.equal(await weekOf("2030-01-14"), "2030-01-14"); // un lundi
    assert.equal(await weekOf("2030-01-20"), "2030-01-14"); // un dimanche : appartient à la semaine du lundi précédent
    assert.equal(await weekOf("2030-01-17"), "2030-01-14");
    assert.equal(await weekOf("2029-12-31"), "2029-12-31");
    for (const bad of ["2030-02-31", "2030-13-01", "n'importe quoi", "", "14/01/2030", undefined, null, 42, "2099-01-01", "1900-01-01"]) {
      assert.equal(await weekOf(bad), "2030-01-07", JSON.stringify(bad));
    }
  });

  it("bornes de la semaine : lundi 00:00 inclus, lundi suivant 00:00 exclu", async () => {
    const w = await world();
    const startsAtMonday = await book(w, w.alice, w.tunis, day(7, 0, 0), 30); // inclus
    const endsAtMonday = await book(w, w.alice, w.tunis, day(6, 23, 0), 60); // finit lundi 00:00 pile : exclu de la semaine
    const startsNextMonday = await book(w, w.alice, w.tunis, day(14, 0, 0), 30); // exclu
    const lastMinute = await book(w, w.alice, w.tunis, day(13, 23, 30), 30); // dimanche 23:30 → minuit pile : inclus
    const ids = allBookingIds(plan(await get(owner(w), String(w.alice._id))));
    assert.ok(ids.includes(String(startsAtMonday._id)));
    assert.ok(ids.includes(String(lastMinute._id)));
    assert.ok(!ids.includes(String(endsAtMonday._id)));
    assert.ok(!ids.includes(String(startsNextMonday._id)));
    // La semaine suivante contient celui qui commence lundi 14 à 00:00, pas celui de la semaine précédente.
    const next = allBookingIds(plan(await get(owner(w), String(w.alice._id), { week: "2030-01-14" })));
    assert.deepEqual(next, [String(startsNextMonday._id)]);
  });

  it("un rendez-vous qui passe minuit figure sur les deux jours, et sur la semaine suivante s'il la chevauche", async () => {
    const w = await world();
    const overnight = await book(w, w.alice, w.tunis, day(13, 23, 30), 60); // dimanche 23:30 → lundi 00:30
    const thisWeek = plan(await get(owner(w), String(w.alice._id)));
    assert.deepEqual(dayOf(thisWeek, "2030-01-13").bookings.map((b) => b.id), [String(overnight._id)]);
    const nextWeek = plan(await get(owner(w), String(w.alice._id), { week: "2030-01-14" }));
    assert.deepEqual(dayOf(nextWeek, "2030-01-14").bookings.map((b) => b.id), [String(overnight._id)]);
    assert.equal(thisWeek.bookingCount, 1); // compté une seule fois dans la semaine
    // Un jour entier plus tard, il n'y figure plus.
    assert.deepEqual(dayOf(nextWeek, "2030-01-15").bookings, []);
  });

  it("l'heure de Tunis décide du jour : 23:30 UTC le dimanche est déjà lundi", async () => {
    const w = await world();
    const b = await book(w, w.alice, w.tunis, new Date("2030-01-13T23:30:00.000Z"), 30); // lundi 14 janvier 00:30 à Tunis
    assert.deepEqual(allBookingIds(plan(await get(owner(w), String(w.alice._id)))), []);
    assert.deepEqual(allBookingIds(plan(await get(owner(w), String(w.alice._id), { week: "2030-01-14" }))), [String(b._id)]);
  });
});

describe("getStaffPlanning : rendez-vous", () => {
  it("affiche tous les statuts, triés chronologiquement par jour, et ne compte pas les annulés", async () => {
    const w = await world();
    await book(w, w.alice, w.tunis, day(9, 16), 30, "COMPLETED");
    await book(w, w.alice, w.tunis, day(9, 9), 30, "CONFIRMED");
    await book(w, w.alice, w.tunis, day(9, 12), 30, "CANCELLED");
    await book(w, w.alice, w.tunis, day(9, 14), 30, "NO_SHOW");
    await book(w, w.alice, w.tunis, day(9, 11), 30, "PENDING");
    const p = plan(await get(owner(w), String(w.alice._id)));
    const wednesday = dayOf(p, "2030-01-09").bookings;
    assert.deepEqual(wednesday.map((b) => b.status), ["CONFIRMED", "PENDING", "CANCELLED", "NO_SHOW", "COMPLETED"]);
    assert.deepEqual(wednesday.map((b) => b.start), [...wednesday.map((b) => b.start)].sort());
    assert.equal(p.bookingCount, 4);
  });

  it("n'expose que l'heure, le statut, le nom du client, les prestations et le centre", async () => {
    const w = await world();
    const b = await book(w, w.alice, w.tunis, day(9, 10), 45);
    await Booking.updateOne({ _id: b._id }, { notes: "NOTE-CONFIDENTIELLE", promoCode: "SECRET10", packName: undefined });
    const p = plan(await get(owner(w), String(w.alice._id)));
    const row = dayOf(p, "2030-01-09").bookings[0];
    assert.deepEqual(Object.keys(row).sort(), ["center", "customer", "end", "id", "services", "start", "status"]);
    assert.equal(row.customer, `${w.customer.firstName} ${w.customer.lastName}`);
    assert.equal(row.center, "Tunis");
    assert.equal(row.services, "Prestation Test");
    const text = JSON.stringify(p);
    for (const secret of ["NOTE-CONFIDENTIELLE", "SECRET10", w.customer.phone, "totalTnd", "phone", "notes", "risk", "reminder", "payment"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  it("utilise le nom du pack quand il existe", async () => {
    const w = await world();
    const b = await book(w, w.alice, w.tunis, day(9, 10));
    await Booking.updateOne({ _id: b._id }, { packName: "Pack Mariée" });
    assert.equal(dayOf(plan(await get(owner(w), String(w.alice._id))), "2030-01-09").bookings[0].services, "Pack Mariée");
  });

  it("renvoie une semaine vide sans rendez-vous", async () => {
    const w = await world();
    const p = plan(await get(owner(w), String(w.alice._id)));
    assert.equal(p.bookingCount, 0);
    assert.ok(p.days.every((d) => d.bookings.length === 0 && d.timeOff.length === 0 && d.blocks.length === 0));
  });
});

describe("getStaffPlanning : absences, pauses et horaires (informatifs)", () => {
  it("affiche les absences de l'employé qui chevauchent la semaine, jamais leur motif", async () => {
    const w = await world();
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "LEAVE", start: day(8), end: day(11), allDay: true, reason: "Traitement médical confidentiel" });
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "ABSENCE", start: day(12, 9), end: day(12, 12), allDay: false, reason: "Autre motif secret" });
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "LEAVE", start: day(20), end: day(21), allDay: true }); // hors semaine
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.bob._id, kind: "LEAVE", start: day(8), end: day(11), allDay: true }); // autre employé
    const p = plan(await get(owner(w), String(w.alice._id)));
    assert.deepEqual(dayOf(p, "2030-01-08").timeOff.map((t) => t.kind), ["LEAVE"]);
    assert.deepEqual(dayOf(p, "2030-01-10").timeOff.map((t) => t.kind), ["LEAVE"]);
    assert.deepEqual(dayOf(p, "2030-01-11").timeOff, []); // la fin (exclue) est le 11 à 00:00
    assert.deepEqual(dayOf(p, "2030-01-12").timeOff.map((t) => [t.kind, t.allDay]), [["ABSENCE", false]]);
    const text = JSON.stringify(p);
    assert.ok(!text.includes("médical") && !text.includes("secret") && !text.includes("reason"));
    assert.deepEqual(Object.keys(dayOf(p, "2030-01-08").timeOff[0]).sort(), ["allDay", "end", "id", "kind", "start"]);
  });

  it("le STAFF concerné ne voit pas non plus le motif de ses propres absences (D4)", async () => {
    const w = await world();
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "ABSENCE", start: day(8), end: day(9), allDay: true, reason: "Motif privé" });
    const p = plan(await get(staffViewer(w, w.alice, w.tunisId), undefined));
    assert.equal(dayOf(p, "2030-01-08").timeOff.length, 1);
    assert.ok(!JSON.stringify(p).includes("Motif privé"));
  });

  it("affiche les pauses de l'employé et les fermetures du centre, en lecture seule et sans motif", async () => {
    const w = await world();
    const own = await insertBlock({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.alice._id, start: day(8, 12), end: day(8, 13), kind: "BREAK" });
    const closure = await insertBlock({ organizationId: w.org._id, centerId: w.tunis._id, staffId: null, start: day(10), end: day(11), kind: "CLOSURE" });
    await insertBlock({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.carla._id, start: day(8, 14), end: day(8, 15) }); // autre employé
    await insertBlock({ organizationId: w.org._id, centerId: w.sousse._id, staffId: null, start: day(9), end: day(10), kind: "CLOSURE" }); // autre centre
    await AvailabilityBlock.updateOne({ _id: own._id }, { reason: "RAISON-DU-BLOC" });
    const p = plan(await get(owner(w), String(w.alice._id)));
    assert.deepEqual(dayOf(p, "2030-01-08").blocks.map((b) => [b.id, b.kind, b.wholeCenter, b.center]), [[String(own._id), "BREAK", false, "Tunis"]]);
    assert.deepEqual(dayOf(p, "2030-01-10").blocks.map((b) => [b.id, b.kind, b.wholeCenter]), [[String(closure._id), "CLOSURE", true]]);
    assert.deepEqual(dayOf(p, "2030-01-09").blocks, []); // fermeture de Sousse : pas pour Alice (Tunis)
    assert.ok(!JSON.stringify(p).includes("RAISON-DU-BLOC"));
  });

  it("un gérant ne voit pas les fermetures d'un centre hors de son périmètre", async () => {
    const w = await world();
    await insertBlock({ organizationId: w.org._id, centerId: w.sousse._id, staffId: null, start: day(9), end: day(10), kind: "CLOSURE" });
    await insertBlock({ organizationId: w.org._id, centerId: w.tunis._id, staffId: null, start: day(8), end: day(9), kind: "CLOSURE" });
    const p = plan(await get(manager(w, w.tunisId), String(w.carla._id)));
    assert.deepEqual(p.days.flatMap((d) => d.blocks.map((b) => b.center)), ["Tunis"]);
  });

  it("horaires du jour : plage personnelle, repos, ou comme le centre avec ses heures (un seul centre)", async () => {
    const w = await world();
    await User.updateOne({ _id: w.alice._id }, { workingHours: { lundi: "09:00-17:00", mardi: null } });
    await Center.updateOne({ _id: w.tunis._id }, { openingHours: { lundi: "08:00-20:00", mercredi: "10:00-18:00", dimanche: null } });
    const p = plan(await get(owner(w), String(w.alice._id)));
    assert.deepEqual(dayOf(p, "2030-01-07").hours, { mode: "range", open: "09:00", close: "17:00", center: { open: "08:00", close: "20:00" } });
    assert.deepEqual(dayOf(p, "2030-01-08").hours.mode, "off");
    assert.deepEqual(dayOf(p, "2030-01-09").hours, { mode: "center", open: null, close: null, center: { open: "10:00", close: "18:00" } });
    assert.equal(dayOf(p, "2030-01-13").hours.center, "closed"); // dimanche fermé
  });

  it("un employé sans horaires, ou avec des horaires invalides en base, suit le centre", async () => {
    const w = await world();
    await User.collection.updateOne({ _id: w.alice._id }, { $set: { workingHours: { lundi: "n'importe quoi", mardi: 12 } } });
    const p = plan(await get(owner(w), String(w.alice._id)));
    assert.ok(p.days.every((d) => d.hours.mode === "center"));
    const bob = plan(await get(owner(w), String(w.bob._id)));
    assert.ok(bob.days.every((d) => d.hours.mode === "center"));
  });

  it("employé de plusieurs centres : pas d'heures de centre affichées (ambigu), horaires personnels conservés", async () => {
    const w = await world();
    await User.updateOne({ _id: w.carla._id }, { workingHours: { jeudi: "10:00-14:00" } });
    const p = plan(await get(owner(w), String(w.carla._id)));
    assert.equal(dayOf(p, "2030-01-10").hours.mode, "range");
    assert.ok(p.days.every((d) => d.hours.center === null));
    assert.deepEqual(p.centers.map((c) => c.name), ["Tunis", "Sousse"]);
  });
});

describe("getStaffPlanning : lecture seule", () => {
  it("ne modifie aucune donnée : rendez-vous, absences, blocs, utilisateurs, centres", async () => {
    const w = await world();
    await book(w, w.alice, w.tunis, day(9, 10));
    await book(w, w.alice, w.tunis, day(9, 14), 30, "CANCELLED");
    await StaffTimeOff.create({ organizationId: w.org._id, userId: w.alice._id, kind: "LEAVE", start: day(8), end: day(9), allDay: true, reason: "x" });
    await insertBlock({ organizationId: w.org._id, centerId: w.tunis._id, staffId: w.alice._id, start: day(8, 12), end: day(8, 13) });
    const snapshot = async () => ({
      bookings: await Booking.find().sort({ _id: 1 }).lean(),
      timeOff: await StaffTimeOff.find().sort({ _id: 1 }).lean(),
      blocks: await AvailabilityBlock.find().sort({ _id: 1 }).lean(),
      users: await User.find().sort({ _id: 1 }).lean(),
      centers: await Center.find().sort({ _id: 1 }).lean(),
    });
    const before = await snapshot();
    plan(await get(owner(w), String(w.alice._id)));
    plan(await get(manager(w, w.tunisId), String(w.alice._id)));
    plan(await get(staffViewer(w, w.alice, w.tunisId), undefined));
    plan(await get(owner(w), String(w.alice._id), { week: "2030-02-04" }));
    refused(await get(manager(w, w.sousseId), String(w.alice._id)));
    assert.deepEqual(await snapshot(), before);
  });
});
