// Tests de caractérisation du moteur de disponibilités (F3.2) : ils décrivent le comportement ACTUEL, sans règle F4.
// Base MongoDB éphémère en mémoire (voir test-support.ts). Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { getDaySlots, getPractitioners, getRangeSlotCounts, isSlotAvailable, pickLeastBusy } from "./availability";
import { addDays, dayKey, fromLocal } from "./time";
import {
  MONDAY,
  SUNDAY,
  at,
  createCenter,
  createCustomer,
  createOrg,
  createUser,
  insertBlock,
  insertBooking,
  resetTestDb,
  startTestDb,
  type TestDb,
} from "./test-support";

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

// Un salon avec un centre, deux praticiens (Alice, Bob) et un client.
async function salon() {
  const org = await createOrg();
  const center = await createCenter(org._id);
  const alice = await createUser(org._id, [center._id], "Alice");
  const bob = await createUser(org._id, [center._id], "Bob");
  const customer = await createCustomer(org._id);
  const o = String(org._id);
  const c = String(center._id);
  const ids = { alice: String(alice._id), bob: String(bob._id) };
  const book = (staff: "alice" | "bob", start: Date, minutes: number, status?: "CONFIRMED" | "CANCELLED") =>
    insertBooking({ organizationId: org._id, centerId: center._id, staffId: ids[staff], customerId: customer._id, start, minutes, status });
  return { org, center, alice, bob, customer, o, c, ids, book };
}

// « now » très tôt : le délai minimal de 30 minutes ne joue pas.
const EARLY = fromLocal(2029, 1, 1);
const slotsOf = (s: Awaited<ReturnType<typeof getDaySlots>>) => s.map((x) => x.start);

describe("getPractitioners", () => {
  it("ne renvoie que les STAFF du centre, triés par prénom", async () => {
    const { org, center, o, c } = await salon();
    await createUser(org._id, [center._id], "Carla");
    await createUser(org._id, [center._id], "Gérant", "MANAGER"); // un gérant n'est jamais praticien
    const otherCenter = await createCenter(org._id, "Autre centre");
    await createUser(org._id, [otherCenter._id], "Zoé"); // autre centre
    const otherOrg = await createOrg("Autre salon");
    const foreignCenter = await createCenter(otherOrg._id);
    await createUser(otherOrg._id, [foreignCenter._id], "Yann"); // autre organisation

    const list = await getPractitioners(o, c);
    assert.deepEqual(list.map((p) => p.firstName), ["Alice", "Bob", "Carla"]);
  });

  it("inclut un praticien affecté à plusieurs centres dans chacun d'eux", async () => {
    const { org, center, o, c } = await salon();
    const second = await createCenter(org._id, "Second");
    await createUser(org._id, [center._id, second._id], "Dina");
    assert.ok((await getPractitioners(o, c)).some((p) => p.firstName === "Dina"));
    assert.ok((await getPractitioners(o, String(second._id))).some((p) => p.firstName === "Dina"));
  });
});

describe("getDaySlots : horaires, pas et délai", () => {
  it("propose un créneau toutes les 15 min, du début d'ouverture à fermeture - durée", async () => {
    const { o, c, ids } = await salon();
    const slots = await getDaySlots({ organizationId: o, centerId: c, day: MONDAY, durationMinutes: 60, now: EARLY });
    assert.equal(slots.length, 37); // 09:00 → 18:00 par pas de 15 min
    assert.equal(slots[0].start, at(9).toISOString());
    assert.equal(slots[0].end, at(10).toISOString());
    assert.equal(slots.at(-1)!.start, at(18).toISOString());
    assert.deepEqual(slots[0].staffIds, [ids.alice, ids.bob]); // tous les praticiens libres
  });

  it("respecte la durée : une prestation de 45 min peut démarrer jusqu'à 18:15", async () => {
    const { o, c } = await salon();
    const slots = await getDaySlots({ organizationId: o, centerId: c, day: MONDAY, durationMinutes: 45, now: EARLY });
    assert.equal(slots.at(-1)!.start, at(18, 15).toISOString());
    assert.equal(slots.at(-1)!.end, at(19).toISOString());
  });

  it("ne propose rien un jour fermé ni pour un centre inconnu", async () => {
    const { o, c } = await salon();
    assert.deepEqual(await getDaySlots({ organizationId: o, centerId: c, day: SUNDAY, durationMinutes: 60, now: EARLY }), []);
    assert.deepEqual(
      await getDaySlots({ organizationId: o, centerId: String(new Types.ObjectId()), day: MONDAY, durationMinutes: 60, now: EARLY }),
      [],
    );
  });

  it("n'accepte pas un centre d'une autre organisation", async () => {
    const { c } = await salon();
    const other = await createOrg("Autre salon");
    assert.deepEqual(await getDaySlots({ organizationId: String(other._id), centerId: c, day: MONDAY, durationMinutes: 60, now: EARLY }), []);
  });

  it("impose 30 minutes d'avance : un créneau est proposé s'il démarre à now + 30 min ou plus tard", async () => {
    const { o, c } = await salon();
    const first = async (now: Date) =>
      (await getDaySlots({ organizationId: o, centerId: c, day: MONDAY, durationMinutes: 60, now }))[0]?.start;
    assert.equal(await first(at(8, 0)), at(9, 0).toISOString()); // avant l'ouverture
    assert.equal(await first(at(9, 0)), at(9, 30).toISOString());
    assert.equal(await first(at(9, 15)), at(9, 45).toISOString()); // pile now + 30 min : accepté
    assert.equal(await first(at(9, 16)), at(10, 0).toISOString());
    assert.equal(await first(at(18, 30)), undefined); // plus rien de possible
  });

  it("ne renvoie que le praticien demandé, et rien pour un praticien inconnu", async () => {
    const { o, c, ids } = await salon();
    const bobOnly = await getDaySlots({ organizationId: o, centerId: c, day: MONDAY, durationMinutes: 60, staffId: ids.bob, now: EARLY });
    assert.ok(bobOnly.length > 0 && bobOnly.every((s) => s.staffIds.length === 1 && s.staffIds[0] === ids.bob));
    const unknown = await getDaySlots({ organizationId: o, centerId: c, day: MONDAY, durationMinutes: 60, staffId: String(new Types.ObjectId()), now: EARLY });
    assert.deepEqual(unknown, []);
  });

  it("ne renvoie rien si le centre n'a aucun praticien", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    assert.deepEqual(
      await getDaySlots({ organizationId: String(org._id), centerId: String(center._id), day: MONDAY, durationMinutes: 60, now: EARLY }),
      [],
    );
  });
});

describe("getDaySlots : rendez-vous et blocs", () => {
  const day = (o: string, c: string, durationMinutes = 60) => getDaySlots({ organizationId: o, centerId: c, day: MONDAY, durationMinutes, now: EARLY });
  const at10 = at(10).toISOString();

  it("retire un praticien occupé des créneaux qui chevauchent son rendez-vous, mais pas l'autre", async () => {
    const { o, c, ids, book } = await salon();
    await book("alice", at(10), 60);
    const slots = await day(o, c);
    const byStart = new Map(slots.map((s) => [s.start, s.staffIds]));
    assert.deepEqual(byStart.get(at10), [ids.bob]);
    assert.deepEqual(byStart.get(at(9, 15).toISOString()), [ids.bob]); // 09:15-10:15 chevauche
    assert.deepEqual(byStart.get(at(10, 45).toISOString()), [ids.bob]); // 10:45-11:45 chevauche
    assert.deepEqual(byStart.get(at(9).toISOString()), [ids.alice, ids.bob]); // finit à 10:00 pile : libre
    assert.deepEqual(byStart.get(at(11).toISOString()), [ids.alice, ids.bob]); // commence à 11:00 pile : libre
  });

  it("supprime le créneau quand tous les praticiens sont occupés", async () => {
    const { o, c, book } = await salon();
    await book("alice", at(10), 60);
    await book("bob", at(10), 60);
    assert.ok(!slotsOf(await day(o, c)).includes(at10));
  });

  it("ignore les rendez-vous annulés", async () => {
    const { o, c, ids, book } = await salon();
    await book("alice", at(10), 60, "CANCELLED");
    const slot = (await day(o, c)).find((s) => s.start === at10);
    assert.deepEqual(slot?.staffIds, [ids.alice, ids.bob]);
  });

  it("applique un bloc propre à un praticien à lui seul", async () => {
    const { org, center, o, c, ids } = await salon();
    await insertBlock({ organizationId: org._id, centerId: center._id, staffId: ids.bob, start: at(12), end: at(13), kind: "BREAK" });
    const slot = (await day(o, c)).find((s) => s.start === at(12).toISOString());
    assert.deepEqual(slot?.staffIds, [ids.alice]);
  });

  it("applique un bloc sans praticien (fermeture) à tout le centre", async () => {
    const { org, center, o, c } = await salon();
    await insertBlock({ organizationId: org._id, centerId: center._id, staffId: null, start: at(12), end: at(13), kind: "CLOSURE" });
    const starts = slotsOf(await day(o, c));
    assert.ok(!starts.includes(at(11, 15).toISOString())); // 11:15-12:15
    assert.ok(!starts.includes(at(12).toISOString()));
    assert.ok(!starts.includes(at(12, 45).toISOString()));
    assert.ok(starts.includes(at(11).toISOString())); // finit à 12:00 pile
    assert.ok(starts.includes(at(13).toISOString())); // commence à 13:00 pile
  });

  it("ne tient pas compte d'un bloc posé sur un autre centre, même pour le même praticien", async () => {
    // Comportement actuel : la disponibilité est calculée centre par centre.
    const { org, o, c, ids } = await salon();
    const second = await createCenter(org._id, "Second");
    await insertBlock({ organizationId: org._id, centerId: second._id, staffId: ids.alice, start: at(10), end: at(11) });
    const slot = (await day(o, c)).find((s) => s.start === at10);
    assert.deepEqual(slot?.staffIds, [ids.alice, ids.bob]);
  });
});

describe("getRangeSlotCounts", () => {
  it("donne, jour par jour, le même nombre de créneaux que getDaySlots", async () => {
    const { o, c, book } = await salon();
    await book("alice", at(10), 60);
    await book("bob", at(10), 60);
    const counts = await getRangeSlotCounts({ organizationId: o, centerId: c, from: MONDAY, days: 7, durationMinutes: 60 });
    assert.equal(Object.keys(counts).length, 7);
    for (let i = 0; i < 7; i++) {
      const d = addDays(MONDAY, i);
      const expected = (await getDaySlots({ organizationId: o, centerId: c, day: d, durationMinutes: 60, now: EARLY })).length;
      assert.equal(counts[dayKey(d)], expected, dayKey(d));
    }
    assert.equal(counts[dayKey(SUNDAY)], undefined); // le dimanche 06 est avant la plage
    assert.equal(counts[dayKey(addDays(MONDAY, 6))], 0); // dimanche 13 : fermé
  });

  it("renvoie un objet vide pour un centre inconnu et zéro partout sans praticien", async () => {
    const { o } = await salon();
    assert.deepEqual(await getRangeSlotCounts({ organizationId: o, centerId: String(new Types.ObjectId()), from: MONDAY, days: 3, durationMinutes: 60 }), {});
    const org = await createOrg();
    const empty = await createCenter(org._id);
    const counts = await getRangeSlotCounts({ organizationId: String(org._id), centerId: String(empty._id), from: MONDAY, days: 2, durationMinutes: 60 });
    assert.deepEqual(Object.values(counts), [0, 0]);
  });
});

describe("isSlotAvailable", () => {
  const check = (s: Awaited<ReturnType<typeof salon>>, who: "alice" | "bob", start: Date, extra: { excludeBookingId?: string; ignoreOpeningHours?: boolean; minutes?: number } = {}) =>
    isSlotAvailable({ organizationId: s.o, centerId: s.c, staffId: s.ids[who], start, durationMinutes: extra.minutes ?? 60, ...extra });

  it("vérifie les horaires d'ouverture, bornes comprises", async () => {
    const s = await salon();
    assert.equal(await check(s, "alice", at(9)), true); // ouverture pile
    assert.equal(await check(s, "alice", at(8, 45)), false);
    assert.equal(await check(s, "alice", at(18)), true); // finit à la fermeture pile
    assert.equal(await check(s, "alice", at(18, 15)), false);
    assert.equal(await check(s, "alice", at(10, 0, SUNDAY)), false); // jour fermé
  });

  it("refuse un centre inconnu ou d'une autre organisation", async () => {
    const s = await salon();
    const other = await createOrg("Autre salon");
    assert.equal(await isSlotAvailable({ organizationId: s.o, centerId: String(new Types.ObjectId()), staffId: s.ids.alice, start: at(10), durationMinutes: 60 }), false);
    assert.equal(await isSlotAvailable({ organizationId: String(other._id), centerId: s.c, staffId: s.ids.alice, start: at(10), durationMinutes: 60 }), false);
  });

  it("refuse un créneau chevauchant un rendez-vous du praticien, pas celui de l'autre", async () => {
    const s = await salon();
    await s.book("alice", at(10), 60);
    assert.equal(await check(s, "alice", at(10, 30)), false);
    assert.equal(await check(s, "alice", at(9, 15)), false);
    assert.equal(await check(s, "alice", at(11)), true);
    assert.equal(await check(s, "bob", at(10, 30)), true);
  });

  it("refuse un créneau bloqué : bloc du praticien ou fermeture du centre", async () => {
    const s = await salon();
    await insertBlock({ organizationId: s.org._id, centerId: s.center._id, staffId: s.ids.bob, start: at(12), end: at(13) });
    await insertBlock({ organizationId: s.org._id, centerId: s.center._id, staffId: null, start: at(15), end: at(16), kind: "CLOSURE" });
    assert.equal(await check(s, "bob", at(12)), false);
    assert.equal(await check(s, "alice", at(12)), true);
    assert.equal(await check(s, "alice", at(15)), false);
    assert.equal(await check(s, "bob", at(15)), false);
  });

  it("ignore les rendez-vous annulés", async () => {
    const s = await salon();
    await s.book("alice", at(10), 60, "CANCELLED");
    assert.equal(await check(s, "alice", at(10)), true);
  });

  it("excludeBookingId ignore ce rendez-vous (report) mais pas les autres", async () => {
    const s = await salon();
    const mine = await s.book("alice", at(10), 60);
    const other = await s.book("alice", at(14), 60);
    assert.equal(await check(s, "alice", at(10, 30)), false); // sans exclusion : chevauche son ancien créneau
    assert.equal(await check(s, "alice", at(10, 30), { excludeBookingId: String(mine._id) }), true);
    assert.equal(await check(s, "alice", at(14), { excludeBookingId: String(mine._id) }), false); // l'autre rendez-vous bloque toujours
    assert.equal(await check(s, "alice", at(14), { excludeBookingId: String(other._id) }), true);
  });

  it("ignoreOpeningHours autorise l'hors-horaires et un jour fermé, mais pas un rendez-vous ni un bloc", async () => {
    const s = await salon();
    assert.equal(await check(s, "alice", at(7), { ignoreOpeningHours: true }), true);
    assert.equal(await check(s, "alice", at(10, 0, SUNDAY), { ignoreOpeningHours: true }), true);
    await s.book("alice", at(7), 60);
    assert.equal(await check(s, "alice", at(7, 30), { ignoreOpeningHours: true }), false);
    await insertBlock({ organizationId: s.org._id, centerId: s.center._id, staffId: s.ids.bob, start: at(6), end: at(8) });
    assert.equal(await check(s, "bob", at(7), { ignoreOpeningHours: true }), false);
  });

  it("réactivation d'un rendez-vous annulé : refusée si le créneau a été repris, acceptée sinon", async () => {
    // Reproduit la vérification de setBookingStatus (annulé → confirmé) : excludeBookingId + ignoreOpeningHours.
    const s = await salon();
    const cancelled = await s.book("alice", at(10), 60, "CANCELLED");
    const reactivate = () => check(s, "alice", at(10), { excludeBookingId: String(cancelled._id), ignoreOpeningHours: true });
    assert.equal(await reactivate(), true);
    await s.book("alice", at(10, 30), 60);
    assert.equal(await reactivate(), false);
  });

  it("report d'un rendez-vous : le nouveau créneau peut chevaucher l'ancien, pas un autre rendez-vous", async () => {
    // Reproduit rescheduleBooking / rescheduleByToken.
    const s = await salon();
    const mine = await s.book("alice", at(10), 60);
    await s.book("alice", at(12), 60);
    const move = (start: Date) => check(s, "alice", start, { excludeBookingId: String(mine._id) });
    assert.equal(await move(at(10, 30)), true);
    assert.equal(await move(at(11, 30)), false); // chevauche le rendez-vous de 12:00
    assert.equal(await move(at(11)), true);
  });

  // ── Comportements actuels à connaître (non corrigés ici) ──
  it("[existant] ne vérifie pas le délai minimal de 30 minutes : un créneau passé est jugé disponible", async () => {
    const s = await salon();
    const pastMonday = fromLocal(2020, 1, 6, 10, 0); // lundi dans le passé
    assert.equal(await check(s, "alice", pastMonday), true);
  });

  it("[existant] ne vérifie pas que le praticien travaille dans le centre (c'est createBooking qui le fait)", async () => {
    const s = await salon();
    const elsewhere = await createCenter(s.org._id, "Ailleurs");
    const outsider = await createUser(s.org._id, [elsewhere._id], "Externe");
    const ok = await isSlotAvailable({ organizationId: s.o, centerId: s.c, staffId: String(outsider._id), start: at(10), durationMinutes: 60 });
    assert.equal(ok, true);
  });

  it("[existant] ne voit pas le rendez-vous d'un même praticien dans un autre centre", async () => {
    const s = await salon();
    const second = await createCenter(s.org._id, "Second");
    const dina = await createUser(s.org._id, [s.center._id, second._id], "Dina");
    await insertBooking({ organizationId: s.org._id, centerId: second._id, staffId: dina._id, customerId: s.customer._id, start: at(10), minutes: 60 });
    const free = await isSlotAvailable({ organizationId: s.o, centerId: s.c, staffId: String(dina._id), start: at(10), durationMinutes: 60 });
    assert.equal(free, true); // libre côté centre 1, alors qu'elle est occupée au centre 2
  });
});

describe("pickLeastBusy", () => {
  it("renvoie le seul praticien tel quel, et undefined pour une liste vide", async () => {
    const s = await salon();
    assert.equal(await pickLeastBusy(s.c, [s.ids.bob], MONDAY), s.ids.bob);
    assert.equal(await pickLeastBusy(s.c, [], MONDAY), undefined);
  });

  it("choisit le praticien ayant le moins de rendez-vous ce jour-là", async () => {
    const s = await salon();
    await s.book("alice", at(10), 30);
    await s.book("alice", at(11), 30);
    await s.book("bob", at(10), 30);
    assert.equal(await pickLeastBusy(s.c, [s.ids.alice, s.ids.bob], MONDAY), s.ids.bob);
  });

  it("départage les égalités selon l'ordre de la liste fournie", async () => {
    const s = await salon();
    assert.equal(await pickLeastBusy(s.c, [s.ids.alice, s.ids.bob], MONDAY), s.ids.alice);
    assert.equal(await pickLeastBusy(s.c, [s.ids.bob, s.ids.alice], MONDAY), s.ids.bob);
    await s.book("alice", at(10), 30);
    await s.book("bob", at(10), 30);
    assert.equal(await pickLeastBusy(s.c, [s.ids.bob, s.ids.alice], MONDAY), s.ids.bob);
  });

  it("ignore les rendez-vous annulés, d'un autre jour ou d'un autre centre", async () => {
    const s = await salon();
    const second = await createCenter(s.org._id, "Second");
    await s.book("alice", at(10), 30, "CANCELLED"); // annulé
    await s.book("alice", at(10, 0, addDays(MONDAY, 1)), 30); // lendemain
    await insertBooking({ organizationId: s.org._id, centerId: second._id, staffId: s.ids.alice, customerId: s.customer._id, start: at(11), minutes: 30 }); // autre centre
    await s.book("bob", at(10), 30); // seul rendez-vous compté
    assert.equal(await pickLeastBusy(s.c, [s.ids.bob, s.ids.alice], MONDAY), s.ids.alice);
  });
});
