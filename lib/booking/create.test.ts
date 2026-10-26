// Tests de caractérisation de createBooking : création, refus et protection contre les chevauchements.
// Décrivent le comportement ACTUEL, sans règle F4. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { isSlotAvailable } from "./availability";
import { BookingError, createBooking } from "./create";
import { Booking, Notification } from "@/lib/models/booking";
import { Promotion } from "@/lib/models/catalog";
import {
  SUNDAY,
  at,
  createCenter,
  createCustomer,
  createOrg,
  createService,
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

const CLASH = "Ce créneau vient d'être pris. Choisissez-en un autre.";

async function salon() {
  const org = await createOrg("Salon Yasmine");
  const center = await createCenter(org._id, "Tunis Centre");
  const alice = await createUser(org._id, [center._id], "Alice");
  const customer = await createCustomer(org._id);
  const service = await createService(org._id, 60, 50);
  const base = {
    organizationId: String(org._id),
    centerId: String(center._id),
    staffId: String(alice._id),
    customerId: String(customer._id),
    selection: { serviceIds: [String(service._id)] },
    source: "STAFF" as const,
  };
  return { org, center, alice, customer, service, base };
}

const rejects = (promise: Promise<unknown>, message: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof BookingError && e.message === message);

describe("createBooking : création", () => {
  it("enregistre un rendez-vous confirmé avec durée, prix et lien de gestion", async () => {
    const { base, service } = await salon();
    const { booking, token, manageUrl } = await createBooking({ ...base, start: at(10), baseUrl: "https://salonia.test" });
    assert.equal(booking.status, "CONFIRMED");
    assert.equal(booking.source, "STAFF");
    assert.equal(booking.start.toISOString(), at(10).toISOString());
    assert.equal(booking.end.toISOString(), at(11).toISOString());
    assert.equal(booking.totalTnd, 50);
    assert.equal(booking.items.length, 1);
    assert.equal(String(booking.items[0].serviceId), String(service._id));
    assert.ok(booking.manageTokenHash && booking.manageTokenHash !== token); // seul le haché est stocké
    assert.equal(manageUrl, `https://salonia.test/reservation/${token}`);
    assert.equal(await Booking.countDocuments(), 1);
  });

  it("n'a pas de lien de gestion sans baseUrl, et respecte le statut PENDING demandé", async () => {
    const { base } = await salon();
    const { booking, manageUrl } = await createBooking({ ...base, start: at(10), status: "PENDING" });
    assert.equal(manageUrl, undefined);
    assert.equal(booking.status, "PENDING");
  });

  it("met un message de confirmation en file d'attente si le client accepte les rappels", async () => {
    const { base, customer } = await salon();
    await createBooking({ ...base, start: at(10) });
    const notifications = await Notification.find().lean();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].kind, "CONFIRMATION");
    assert.equal(notifications[0].status, "QUEUED");
    assert.equal(notifications[0].to, customer.phone);
  });

  it("ne crée aucune notification sans consentement du client", async () => {
    const { org, base } = await salon();
    const noConsent = await createCustomer(org._id, false);
    await createBooking({ ...base, customerId: String(noConsent._id), start: at(10) });
    assert.equal(await Notification.countDocuments(), 0);
  });

  it("additionne durée et prix de plusieurs prestations", async () => {
    const { org, base, service } = await salon();
    const second = await createService(org._id, 30, 20, "Soin");
    const { booking } = await createBooking({ ...base, selection: { serviceIds: [String(service._id), String(second._id)] }, start: at(10) });
    assert.equal(booking.end.toISOString(), at(11, 30).toISOString());
    assert.equal(booking.totalTnd, 70);
  });
});

describe("createBooking : refus", () => {
  it("refuse un centre inconnu, un client inconnu ou d'une autre organisation", async () => {
    const { base } = await salon();
    await rejects(createBooking({ ...base, centerId: String(new Types.ObjectId()), start: at(10) }), "Centre introuvable.");
    await rejects(createBooking({ ...base, customerId: String(new Types.ObjectId()), start: at(10) }), "Client introuvable.");
    const other = await createOrg("Autre salon");
    const foreign = await createCustomer(other._id);
    await rejects(createBooking({ ...base, customerId: String(foreign._id), start: at(10) }), "Client introuvable.");
  });

  it("refuse un praticien d'un autre centre, un gérant ou un utilisateur d'une autre organisation", async () => {
    const { org, base } = await salon();
    const elsewhere = await createCenter(org._id, "Ailleurs");
    const outsider = await createUser(org._id, [elsewhere._id], "Externe");
    const manager = await createUser(org._id, [new Types.ObjectId(base.centerId)], "Gérant", "MANAGER");
    const other = await createOrg("Autre salon");
    const otherCenter = await createCenter(other._id);
    const foreign = await createUser(other._id, [otherCenter._id], "Étranger");
    const msg = "Ce praticien ne travaille pas dans ce centre.";
    await rejects(createBooking({ ...base, staffId: String(outsider._id), start: at(10) }), msg);
    await rejects(createBooking({ ...base, staffId: String(manager._id), start: at(10) }), msg);
    await rejects(createBooking({ ...base, staffId: String(foreign._id), start: at(10) }), msg);
  });

  it("refuse une sélection vide, une prestation inconnue ou inactive", async () => {
    const { base, service } = await salon();
    await rejects(createBooking({ ...base, selection: { serviceIds: [] }, start: at(10) }), "Choisissez au moins une prestation.");
    await rejects(createBooking({ ...base, selection: { serviceIds: [String(new Types.ObjectId())] }, start: at(10) }), "Une prestation n'est plus disponible.");
    service.active = false;
    await service.save();
    await rejects(createBooking({ ...base, start: at(10) }), "Une prestation n'est plus disponible.");
  });

  it("refuse un créneau déjà pris, hors horaires ou un jour fermé", async () => {
    const { org, center, alice, customer, base } = await salon();
    await insertBooking({ organizationId: org._id, centerId: center._id, staffId: alice._id, customerId: customer._id, start: at(10), minutes: 60 });
    await rejects(createBooking({ ...base, start: at(10, 30) }), CLASH);
    await rejects(createBooking({ ...base, start: at(7) }), CLASH);
    await rejects(createBooking({ ...base, start: at(10, 0, SUNDAY) }), CLASH);
    assert.equal(await Booking.countDocuments(), 1); // rien n'a été ajouté
    assert.equal(await Notification.countDocuments(), 0);
  });

  it("ignoreOpeningHours permet un rendez-vous hors horaires, mais pas sur un créneau occupé", async () => {
    const { base } = await salon();
    const { booking } = await createBooking({ ...base, start: at(7), ignoreOpeningHours: true });
    assert.equal(booking.start.toISOString(), at(7).toISOString());
    await rejects(createBooking({ ...base, start: at(7, 30), ignoreOpeningHours: true }), CLASH);
  });

  it("deux réservations successives du même créneau : la seconde est refusée", async () => {
    const { base } = await salon();
    await createBooking({ ...base, start: at(14) });
    await rejects(createBooking({ ...base, start: at(14) }), CLASH);
    assert.equal(await Booking.countDocuments({ status: "CONFIRMED" }), 1);
  });
});

describe("createBooking : protection contre les chevauchements d'un praticien multi-centres", () => {
  // Comportement actuel : isSlotAvailable raisonne par centre, alors que le garde-fou final de
  // createBooking raisonne par praticien. Un praticien affecté à deux centres le met en évidence.
  async function multiCenter() {
    const s = await salon();
    const second = await createCenter(s.org._id, "Sousse");
    const dina = await createUser(s.org._id, [s.center._id, second._id], "Dina");
    const promo = await Promotion.create({
      organizationId: s.org._id,
      name: "Test",
      code: "TEST10",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 365 * 86_400_000),
    });
    const inSecond = { ...s.base, centerId: String(second._id), staffId: String(dina._id) };
    const existing = await insertBooking({ organizationId: s.org._id, centerId: s.center._id, staffId: dina._id, customerId: s.customer._id, start: at(10), minutes: 60 });
    return { ...s, second, dina, promo, inSecond, existing };
  }

  it("la disponibilité du second centre ne voit pas le rendez-vous du premier", async () => {
    const m = await multiCenter();
    const free = await isSlotAvailable({ organizationId: m.inSecond.organizationId, centerId: m.inSecond.centerId, staffId: m.inSecond.staffId, start: at(10, 30), durationMinutes: 60 });
    assert.equal(free, true);
  });

  it("le garde-fou retire la nouvelle réservation, refuse avec le message habituel et restitue le code promo", async () => {
    const m = await multiCenter();
    await rejects(createBooking({ ...m.inSecond, start: at(10, 30), promoCode: "TEST10" }), CLASH);
    assert.equal(await Booking.countDocuments(), 1);
    assert.equal(String((await Booking.findOne().lean())!._id), String(m.existing._id)); // l'ancienne survit
    assert.equal((await Promotion.findById(m.promo._id).lean())!.usedCount, 0);
    assert.equal(await Notification.countDocuments(), 0); // la confirmation n'est créée qu'après le garde-fou
  });

  it("un code promo valide incrémente son compteur quand la réservation aboutit", async () => {
    const m = await multiCenter();
    const { booking } = await createBooking({ ...m.inSecond, start: at(12), promoCode: "TEST10" });
    assert.equal(booking.discountTnd, 5);
    assert.equal(booking.totalTnd, 45);
    assert.equal((await Promotion.findById(m.promo._id).lean())!.usedCount, 1);
  });

  it("un rendez-vous annulé de l'autre centre ne déclenche pas le garde-fou", async () => {
    const m = await multiCenter();
    await Booking.updateOne({ _id: m.existing._id }, { status: "CANCELLED" });
    const { booking } = await createBooking({ ...m.inSecond, start: at(10, 30) });
    assert.equal(booking.status, "CONFIRMED");
    assert.equal(await Booking.countDocuments({ status: "CONFIRMED" }), 1);
  });

  it("[existant] le garde-fou ignore les blocs de disponibilité des autres centres", async () => {
    const m = await multiCenter();
    await insertBlock({ organizationId: m.org._id, centerId: m.center._id, staffId: m.dina._id, start: at(14), end: at(15) });
    const { booking } = await createBooking({ ...m.inSecond, start: at(14) });
    assert.equal(booking.status, "CONFIRMED"); // le bloc du centre 1 n'empêche pas la réservation au centre 2
  });
});
