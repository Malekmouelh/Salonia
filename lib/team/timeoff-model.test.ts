// F4 (étape 5a) — Modèle StaffTimeOff : enregistrement, contraintes, index, et absence d'effet sur la réservation.
// Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { getDaySlots, isSlotAvailable } from "@/lib/booking/availability";
import { MONDAY, at, createCenter, createCustomer, createOrg, createUser, insertBooking, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { fromLocal } from "@/lib/booking/time";
import { AvailabilityBlock, Booking } from "@/lib/models/booking";
import { StaffTimeOff } from "@/lib/models/team";
import { MAX_TIMEOFF_REASON } from "./timeoff";

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

async function salon() {
  const org = await createOrg("Salon Yasmine");
  const center = await createCenter(org._id, "Tunis");
  const alice = await createUser(org._id, [center._id], "Alice");
  return { org, center, alice };
}
// Document valide, que chaque test peut dégrader volontairement (valeurs invalides passées dans « extra »).
type NewTimeOff = NonNullable<ConstructorParameters<typeof StaffTimeOff>[0]>;
const valid = (s: Awaited<ReturnType<typeof salon>>, extra: Record<string, unknown> = {}) =>
  ({
    organizationId: s.org._id,
    userId: s.alice._id,
    kind: "LEAVE",
    start: fromLocal(2030, 1, 8),
    end: fromLocal(2030, 1, 11),
    allDay: true,
    ...extra,
  }) as unknown as NewTimeOff;

describe("StaffTimeOff : enregistrement", () => {
  it("enregistre et relit une absence avec ses dates exactes et ses horodatages", async () => {
    const s = await salon();
    const created = await StaffTimeOff.create(valid(s, { reason: "Vacances", createdBy: s.alice._id }));
    const saved = await StaffTimeOff.findById(created._id).lean();
    assert.equal(String(saved?.organizationId), String(s.org._id));
    assert.equal(String(saved?.userId), String(s.alice._id));
    assert.equal(saved?.kind, "LEAVE");
    assert.equal(saved?.start.toISOString(), "2030-01-07T23:00:00.000Z");
    assert.equal(saved?.end.toISOString(), "2030-01-10T23:00:00.000Z");
    assert.equal(saved?.allDay, true);
    assert.equal(saved?.reason, "Vacances");
    assert.ok(saved?.createdAt && saved?.updatedAt);
  });

  it("n'écrit pas de motif quand il est absent, et enlève les espaces autour du motif", async () => {
    const s = await salon();
    const without = await StaffTimeOff.create(valid(s));
    assert.ok(!("reason" in ((await StaffTimeOff.collection.findOne({ _id: without._id })) ?? {})));
    const trimmed = await StaffTimeOff.create(valid(s, { reason: "  Congé annuel  " }));
    assert.equal((await StaffTimeOff.findById(trimmed._id).lean())?.reason, "Congé annuel");
  });

  it("accepte les deux types et une plage horaire", async () => {
    const s = await salon();
    await StaffTimeOff.create(valid(s, { kind: "ABSENCE", allDay: false, start: fromLocal(2030, 1, 8, 9, 0), end: fromLocal(2030, 1, 8, 13, 0) }));
    assert.deepEqual((await StaffTimeOff.find().lean()).map((e) => [e.kind, e.allDay]), [["ABSENCE", false]]);
  });
});

describe("StaffTimeOff : contraintes", () => {
  it("refuse un enregistrement auquel il manque un champ obligatoire", async () => {
    const s = await salon();
    for (const missing of ["organizationId", "userId", "kind", "start", "end", "allDay"]) {
      const doc: Record<string, unknown> = valid(s);
      delete doc[missing];
      await assert.rejects(StaffTimeOff.create(doc), (e: Error) => e.name === "ValidationError", missing);
    }
    assert.equal(await StaffTimeOff.countDocuments(), 0);
  });

  it("refuse un type inconnu (une absence n'est pas un bloc du calendrier)", async () => {
    const s = await salon();
    for (const kind of ["SICK", "BREAK", "CLOSURE", "BLOCK", "leave", ""]) {
      await assert.rejects(StaffTimeOff.create(valid(s, { kind })), (e: Error) => e.name === "ValidationError", kind);
    }
  });

  it("refuse une fin qui n'est pas strictement après le début", async () => {
    const s = await salon();
    const start = fromLocal(2030, 1, 8, 9, 0);
    for (const end of [start, fromLocal(2030, 1, 8, 8, 0)]) {
      await assert.rejects(StaffTimeOff.create(valid(s, { start, end, allDay: false })), /La fin doit être après le début/);
    }
  });

  it("refuse un motif de plus de 120 caractères, accepte exactement 120", async () => {
    const s = await salon();
    await assert.rejects(StaffTimeOff.create(valid(s, { reason: "x".repeat(MAX_TIMEOFF_REASON + 1) })), (e: Error) => e.name === "ValidationError");
    await StaffTimeOff.create(valid(s, { reason: "x".repeat(MAX_TIMEOFF_REASON) }));
    assert.equal(await StaffTimeOff.countDocuments(), 1);
  });

  it("refuse des identifiants invalides", async () => {
    const s = await salon();
    await assert.rejects(StaffTimeOff.create(valid(s, { userId: "pas-un-id" })), (e: Error) => e.name === "ValidationError");
    await assert.rejects(StaffTimeOff.create(valid(s, { organizationId: "pas-un-id" })), (e: Error) => e.name === "ValidationError");
  });
});

describe("StaffTimeOff : collection et index", () => {
  it("utilise sa propre collection, distincte d'AvailabilityBlock", async () => {
    assert.equal(StaffTimeOff.collection.collectionName, "stafftimeoffs");
    assert.notEqual(StaffTimeOff.collection.collectionName, AvailabilityBlock.collection.collectionName);
  });

  it("définit les index prévus pour les lectures par employé et par période", async () => {
    await StaffTimeOff.syncIndexes();
    const keys = (await StaffTimeOff.collection.indexes()).map((i) => JSON.stringify(i.key));
    assert.ok(keys.includes(JSON.stringify({ organizationId: 1, userId: 1, start: 1 })));
    assert.ok(keys.includes(JSON.stringify({ userId: 1, end: 1 })));
  });

  it("n'impose aucune unicité : deux enregistrements identiques sont possibles (le contrôle des chevauchements viendra du service)", async () => {
    const s = await salon();
    await StaffTimeOff.create(valid(s));
    await StaffTimeOff.create(valid(s));
    assert.equal(await StaffTimeOff.countDocuments({ userId: s.alice._id }), 2);
  });
});

describe("StaffTimeOff : aucun effet sur la réservation (enregistrement seul)", () => {
  it("[existant] créer une absence ne change ni les créneaux, ni la disponibilité, ni les rendez-vous, ni les blocs", async () => {
    const s = await salon();
    const customer = await createCustomer(s.org._id);
    await insertBooking({ organizationId: s.org._id, centerId: s.center._id, staffId: s.alice._id, customerId: customer._id, start: at(10), minutes: 60 });
    const early = fromLocal(2029, 1, 1);
    const snapshot = async () => ({
      slots: await getDaySlots({ organizationId: String(s.org._id), centerId: String(s.center._id), day: MONDAY, durationMinutes: 60, now: early }),
      free: await isSlotAvailable({ organizationId: String(s.org._id), centerId: String(s.center._id), staffId: String(s.alice._id), start: at(14), durationMinutes: 60 }),
      bookings: await Booking.find().lean(),
      blocks: await AvailabilityBlock.countDocuments(),
    });
    const before = await snapshot();

    // Alice est « en congé » toute la journée du lundi : la réservation ne le sait pas encore.
    await StaffTimeOff.create({ organizationId: s.org._id, userId: s.alice._id, kind: "LEAVE", start: MONDAY, end: fromLocal(2030, 1, 8), allDay: true });
    assert.deepEqual(await snapshot(), before);
    assert.equal(before.free, true);
    assert.ok(before.slots.some((slot) => slot.start === at(14).toISOString() && slot.staffIds.includes(String(s.alice._id))));
    assert.equal(before.blocks, 0);
  });

  it("une absence est indépendante des organisations : filtrer par organisation et par employé isole ses données", async () => {
    const s = await salon();
    const other = await createOrg("Autre salon");
    const otherCenter = await createCenter(other._id);
    const stranger = await createUser(other._id, [otherCenter._id], "Intrus");
    await StaffTimeOff.create(valid(s));
    await StaffTimeOff.create({ ...valid(s), organizationId: other._id, userId: stranger._id });
    assert.equal(await StaffTimeOff.countDocuments({ organizationId: s.org._id, userId: s.alice._id }), 1);
    assert.equal(await StaffTimeOff.countDocuments({ organizationId: s.org._id, userId: stranger._id }), 0);
    assert.equal(await StaffTimeOff.countDocuments({ organizationId: new Types.ObjectId(), userId: s.alice._id }), 0);
  });
});
