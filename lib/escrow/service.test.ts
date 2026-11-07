// Service SalonEscrow côté base : contrôles faits AVANT toute transaction et retour arrière d'un rendez-vous
// dont l'acompte n'a pas pu être bloqué. Base MongoDB éphémère en mémoire ; aucune blockchain n'est contactée
// (adresse RPC inutilisée, port 9 : toute tentative d'appel ferait échouer le test). Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { english, generateMnemonic, generatePrivateKey } from "viem/accounts";
import { Booking, Customer, Notification } from "@/lib/models/booking";
import { Promotion } from "@/lib/models/catalog";
import { Center, User } from "@/lib/models/core";
import {
  at,
  createCenter,
  createCustomer,
  createOrg,
  createUser,
  insertBooking,
  resetTestDb,
  startTestDb,
  type TestDb,
} from "@/lib/booking/test-support";
import { EscrowError } from "./errors";
import mongoose from "mongoose";
import { chainDbName, chainModels } from "@/lib/models/chain";
import { NETWORK_ERROR } from "./errors";
import {
  NO_WALLET,
  abandonEscrowIntent,
  confirmCancelFromTx,
  confirmEscrowFromTx,
  escrowCenterChainId,
  isSlotFreeOnChain,
  prepareEscrowIntent,
  readEscrowStatuses,
  releaseExpiredHolds,
  rollbackUnpaidBooking,
  settleEscrowBookingByStaff,
} from "./service";

let db: TestDb;
before(async () => {
  Object.assign(process.env, {
    ESCROW_NETWORK: "hardhat",
    ESCROW_RPC_URL: "http://127.0.0.1:9",
    ESCROW_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ESCROW_TOKEN_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    ESCROW_ADMIN_PRIVATE_KEY: generatePrivateKey(),
    ESCROW_HD_MNEMONIC: generateMnemonic(english),
  });
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  await resetTestDb(db);
  // Base blockchain séparée (comptes MetaMask) : vidée aussi entre deux tests.
  await mongoose.connection.useDb(chainDbName()).dropDatabase();
});

const rejects = (promise: Promise<unknown>, message: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof EscrowError && e.message === message);

async function salon({ escrow = true } = {}) {
  const org = await createOrg();
  const center = await createCenter(org._id);
  if (escrow) await Center.updateOne({ _id: center._id }, { $set: { chainId: 7 } });
  const staff = await createUser(org._id, [center._id], "Amira");
  const customer = await createCustomer(org._id);
  const book = (start: Date) =>
    insertBooking({ organizationId: org._id, centerId: center._id, staffId: staff._id, customerId: customer._id, start, minutes: 30 });
  return { org, center, staff, customer, book, organizationId: String(org._id) };
}

describe("escrowCenterChainId", () => {
  it("renvoie le numéro de chaîne d'un centre configuré, null sinon", async () => {
    const withEscrow = await salon();
    const without = await salon({ escrow: false });
    assert.equal(await escrowCenterChainId(withEscrow.organizationId, String(withEscrow.center._id)), 7);
    assert.equal(await escrowCenterChainId(without.organizationId, String(without.center._id)), null);
  });

  it("isolation : le centre d'une autre organisation n'est pas reconnu", async () => {
    const a = await salon();
    const b = await salon({ escrow: false });
    assert.equal(await escrowCenterChainId(b.organizationId, String(a.center._id)), null);
    assert.equal(await escrowCenterChainId(a.organizationId, "pas-un-id"), null);
  });
});

describe("isSlotFreeOnChain (sans appel réseau)", () => {
  it("null pour un centre sans acompte sécurisé", async () => {
    const s = await salon({ escrow: false });
    assert.equal(await isSlotFreeOnChain({ organizationId: s.organizationId, centerId: String(s.center._id), staffId: String(s.staff._id), start: at(10) }), null);
  });

  it("libre si le praticien n'a encore jamais été réservé sur la chaîne", async () => {
    const s = await salon();
    assert.equal(await isSlotFreeOnChain({ organizationId: s.organizationId, centerId: String(s.center._id), staffId: String(s.staff._id), start: at(10) }), true);
  });

  it("faux pour un praticien d'un autre centre", async () => {
    const s = await salon();
    const other = await createCenter(s.org._id, "Autre centre");
    const elsewhere = await createUser(s.org._id, [other._id], "Sami");
    assert.equal(await isSlotFreeOnChain({ organizationId: s.organizationId, centerId: String(s.center._id), staffId: String(elsewhere._id), start: at(10) }), false);
  });
});

const TX = `0x${"ab".repeat(32)}`;

// Rendez-vous en attente (PENDING) d'un compte client, avec ou sans wallet MetaMask relié.
async function pendingBooking(start: Date, { wallet = true, escrowCenter = true } = {}) {
  const s = await salon({ escrow: escrowCenter });
  const client = await User.create({ firstName: "Sarra", lastName: "Test", email: `p${Date.now()}${Math.random()}@test.local`, passwordHash: "x", role: "CLIENT" });
  await Customer.updateOne({ _id: s.customer._id }, { $set: { userId: client._id } });
  if (wallet) {
    const { WalletAccount } = await chainModels();
    await WalletAccount.create({ userId: String(client._id), address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", linkedAt: new Date() });
  }
  const booking = await s.book(start);
  await Booking.updateOne({ _id: booking._id }, { $set: { status: "PENDING" } });
  return { ...s, clientUserId: String(client._id), bookingId: String(booking._id), booking };
}

describe("prepareEscrowIntent (MetaMask) : refus avant toute transaction", () => {
  it("MetaMask obligatoire : refuse un client sans wallet relié", async () => {
    const p = await pendingBooking(at(10), { wallet: false });
    await rejects(prepareEscrowIntent({ organizationId: p.organizationId, bookingId: p.bookingId, clientUserId: p.clientUserId }), NO_WALLET);
  });

  it("refuse le rendez-vous d'un autre client ou d'une autre organisation", async () => {
    const p = await pendingBooking(at(10));
    const other = await salon();
    const intruder = await User.create({ firstName: "Autre", lastName: "Client", email: "autre@test.local", passwordHash: "x", role: "CLIENT" });
    await rejects(prepareEscrowIntent({ organizationId: p.organizationId, bookingId: p.bookingId, clientUserId: String(intruder._id) }), "Rendez-vous introuvable.");
    await rejects(prepareEscrowIntent({ organizationId: other.organizationId, bookingId: p.bookingId, clientUserId: p.clientUserId }), "Rendez-vous introuvable.");
  });

  it("refuse un créneau non aligné, un centre sans acompte sécurisé, un rendez-vous déjà confirmé", async () => {
    const unaligned = await pendingBooking(at(10, 15));
    await rejects(
      prepareEscrowIntent({ organizationId: unaligned.organizationId, bookingId: unaligned.bookingId, clientUserId: unaligned.clientUserId }),
      "Avec l'acompte sécurisé, choisissez un créneau à l'heure pile ou à la demie.",
    );
    const plain = await pendingBooking(at(10), { escrowCenter: false });
    await rejects(
      prepareEscrowIntent({ organizationId: plain.organizationId, bookingId: plain.bookingId, clientUserId: plain.clientUserId }),
      "Ce salon n'utilise pas l'acompte sécurisé.",
    );
    const confirmed = await pendingBooking(at(11));
    await Booking.updateOne({ _id: confirmed.booking._id }, { $set: { status: "CONFIRMED" } });
    await rejects(
      prepareEscrowIntent({ organizationId: confirmed.organizationId, bookingId: confirmed.bookingId, clientUserId: confirmed.clientUserId }),
      "Cette réservation est déjà réglée.",
    );
  });
});

describe("confirmEscrowFromTx (MetaMask) : le serveur ne croit jamais le navigateur", () => {
  it("refuse un hash invalide, le rendez-vous d'un autre client, un rendez-vous déjà réglé", async () => {
    const p = await pendingBooking(at(10));
    await rejects(confirmEscrowFromTx({ clientUserId: p.clientUserId, bookingId: p.bookingId, txHash: "0x1234" }), "Transaction introuvable ou refusée par le contrat.");
    const intruder = await User.create({ firstName: "Autre", lastName: "Client", email: "autre2@test.local", passwordHash: "x", role: "CLIENT" });
    await rejects(confirmEscrowFromTx({ clientUserId: String(intruder._id), bookingId: p.bookingId, txHash: TX }), "Rendez-vous introuvable.");
    await Booking.updateOne({ _id: p.booking._id }, { $set: { status: "CONFIRMED" } });
    await rejects(confirmEscrowFromTx({ clientUserId: p.clientUserId, bookingId: p.bookingId, txHash: TX }), "Cette réservation est déjà réglée.");
  });

  it("blockchain injoignable : rien n'est confirmé, le rendez-vous reste en attente", async () => {
    const p = await pendingBooking(at(10));
    await rejects(confirmEscrowFromTx({ clientUserId: p.clientUserId, bookingId: p.bookingId, txHash: TX }), NETWORK_ERROR);
    const after = await Booking.findById(p.booking._id).lean();
    assert.equal(after?.status, "PENDING");
    assert.equal(after?.escrow ?? null, null);
  });
});

describe("créneaux tenus en attente de MetaMask", () => {
  it("abandonEscrowIntent rend le créneau du client, jamais celui d'un autre", async () => {
    const p = await pendingBooking(at(10));
    const intruder = await User.create({ firstName: "Autre", lastName: "Client", email: "autre3@test.local", passwordHash: "x", role: "CLIENT" });
    await rejects(abandonEscrowIntent({ clientUserId: String(intruder._id), bookingId: p.bookingId }), "Rendez-vous introuvable.");
    assert.equal(await Booking.countDocuments({ _id: p.booking._id }), 1);
    await abandonEscrowIntent({ clientUserId: p.clientUserId, bookingId: p.bookingId });
    assert.equal(await Booking.countDocuments({ _id: p.booking._id }), 0);
  });

  it("releaseExpiredHolds libère seulement les attentes expirées, jamais un rendez-vous confirmé", async () => {
    const expired = await pendingBooking(at(10));
    const fresh = await pendingBooking(at(11));
    const confirmed = await pendingBooking(at(12));
    const past = new Date(Date.now() - 60_000);
    await Booking.updateOne({ _id: expired.booking._id }, { $set: { escrowHoldUntil: past } });
    await Booking.updateOne({ _id: fresh.booking._id }, { $set: { escrowHoldUntil: new Date(Date.now() + 600_000) } });
    await Booking.updateOne({ _id: confirmed.booking._id }, { $set: { status: "CONFIRMED", escrowHoldUntil: past } });
    assert.equal(await releaseExpiredHolds(), 1);
    assert.equal(await Booking.countDocuments({ _id: expired.booking._id }), 0);
    assert.equal(await Booking.countDocuments({ _id: { $in: [fresh.booking._id, confirmed.booking._id] } }), 2);
  });
});

describe("rollbackUnpaidBooking", () => {
  it("retire le rendez-vous, sa notification et rend l'utilisation du code promo", async () => {
    const s = await salon();
    const promo = await Promotion.create({
      organizationId: s.org._id,
      name: "Promo",
      code: "BIENVENUE",
      type: "PERCENTAGE",
      value: 10,
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2040-01-01"),
      usedCount: 1,
    });
    const booking = await s.book(at(10));
    await Booking.updateOne({ _id: booking._id }, { $set: { promotionId: promo._id } });
    await Notification.create({ organizationId: s.org._id, bookingId: booking._id, customerId: s.customer._id, kind: "CONFIRMATION", to: "20000000", message: "ok" });

    await rollbackUnpaidBooking(s.organizationId, String(booking._id));

    assert.equal(await Booking.countDocuments({ _id: booking._id }), 0);
    assert.equal(await Notification.countDocuments({ bookingId: booking._id }), 0);
    assert.equal((await Promotion.findById(promo._id).lean())?.usedCount, 0);
  });

  it("ne retire jamais un rendez-vous dont l'acompte est bloqué, ni celui d'une autre organisation", async () => {
    const s = await salon();
    const other = await salon();
    const paid = await s.book(at(10));
    await Booking.updateOne(
      { _id: paid._id },
      { $set: { escrow: { network: "hardhat", chainBookingId: 1, centerChainId: 7, practitionerChainId: 1, depositUnits: "30000000", clientAddress: "0x0", createTxHash: "0x1" } } },
    );
    const unpaid = await s.book(at(11));
    await rollbackUnpaidBooking(s.organizationId, String(paid._id));
    await rollbackUnpaidBooking(other.organizationId, String(unpaid._id));
    assert.equal(await Booking.countDocuments({ _id: { $in: [paid._id, unpaid._id] } }), 2);
  });
});

const ESCROW = { network: "hardhat", chainBookingId: 1, centerChainId: 7, practitionerChainId: 1, depositUnits: "30000000", clientAddress: "0x0", createTxHash: "0x1" };

// Rendez-vous avec acompte bloqué, relié au compte client `client`.
async function escrowBooking(start: Date) {
  const s = await salon();
  const client = await User.create({ firstName: "Sarra", lastName: "Test", email: `c${Date.now()}${Math.random()}@test.local`, passwordHash: "x", role: "CLIENT" });
  await Customer.updateOne({ _id: s.customer._id }, { $set: { userId: client._id } });
  const booking = await s.book(start);
  await Booking.updateOne({ _id: booking._id }, { $set: { escrow: ESCROW } });
  return { ...s, client, booking, clientUserId: String(client._id), bookingId: String(booking._id) };
}

const inHours = (h: number) => new Date(Math.ceil((Date.now() + h * 3_600_000) / 1_800_000) * 1_800_000);

describe("confirmCancelFromTx (annulation MetaMask) : vérifications avant de toucher la base", () => {
  it("refuse un hash invalide et le rendez-vous d'un autre client", async () => {
    const e = await escrowBooking(inHours(48));
    await rejects(confirmCancelFromTx({ clientUserId: e.clientUserId, bookingId: e.bookingId, txHash: "0x12" }), "Transaction introuvable ou refusée par le contrat.");
    const intruder = await User.create({ firstName: "Autre", lastName: "Client", email: "autre@test.local", passwordHash: "x", role: "CLIENT" });
    await rejects(confirmCancelFromTx({ clientUserId: String(intruder._id), bookingId: e.bookingId, txHash: TX }), "Rendez-vous introuvable.");
    assert.equal((await Booking.findById(e.booking._id).lean())?.status, "CONFIRMED");
  });

  it("refuse un rendez-vous sans acompte sécurisé ou enregistré sur un autre réseau", async () => {
    const e = await escrowBooking(inHours(48));
    await Booking.updateOne({ _id: e.booking._id }, { $set: { "escrow.network": "sepolia" } });
    await rejects(confirmCancelFromTx({ clientUserId: e.clientUserId, bookingId: e.bookingId, txHash: TX }), "L'acompte sécurisé n'est pas activé sur ce serveur.");
    await Booking.updateOne({ _id: e.booking._id }, { $set: { escrow: null } });
    await rejects(confirmCancelFromTx({ clientUserId: e.clientUserId, bookingId: e.bookingId, txHash: TX }), "Ce rendez-vous n'a pas d'acompte sécurisé.");
  });

  it("blockchain injoignable : le rendez-vous reste confirmé", async () => {
    const e = await escrowBooking(inHours(48));
    await rejects(confirmCancelFromTx({ clientUserId: e.clientUserId, bookingId: e.bookingId, txHash: TX }), NETWORK_ERROR);
    assert.equal((await Booking.findById(e.booking._id).lean())?.status, "CONFIRMED");
  });
});

describe("readEscrowStatuses", () => {
  it("null pour un autre réseau ou une chaîne injoignable : l'écran garde la copie de la base", async () => {
    const statuses = await readEscrowStatuses([
      { id: "a", network: "sepolia", chainBookingId: 1 },
      { id: "b", network: "hardhat", chainBookingId: 1 },
    ]);
    assert.deepEqual(statuses, { a: null, b: null });
  });
});

describe("settleEscrowBookingByStaff : refus avant toute transaction", () => {
  it("refuse avant l'heure de début (validation) et avant 15 minutes (absence)", async () => {
    const e = await escrowBooking(inHours(2));
    const base = { organizationId: e.organizationId, bookingId: e.bookingId, staffUserId: String(e.staff._id) };
    const early = "Trop tôt : validation possible dès l'heure du rendez-vous, absence 15 minutes après.";
    await rejects(settleEscrowBookingByStaff({ ...base, outcome: "COMPLETED" }), early);
    const started = await escrowBooking(new Date(Date.now() - 5 * 60_000));
    await rejects(
      settleEscrowBookingByStaff({ organizationId: started.organizationId, bookingId: started.bookingId, staffUserId: String(started.staff._id), outcome: "NO_SHOW" }),
      early,
    );
  });

  it("refuse un acompte déjà réglé, un rendez-vous sans acompte, ou d'une autre organisation", async () => {
    const e = await escrowBooking(new Date(Date.now() - 60 * 60_000));
    const other = await salon();
    const base = { bookingId: e.bookingId, staffUserId: String(e.staff._id), outcome: "COMPLETED" as const };
    await rejects(settleEscrowBookingByStaff({ ...base, organizationId: other.organizationId }), "Rendez-vous introuvable.");
    await Booking.updateOne({ _id: e.booking._id }, { $set: { status: "COMPLETED", "escrow.status": "COMPLETED" } });
    await rejects(settleEscrowBookingByStaff({ ...base, organizationId: e.organizationId }), "Cette réservation est déjà réglée.");
    await Booking.updateOne({ _id: e.booking._id }, { $set: { escrow: null } });
    await rejects(settleEscrowBookingByStaff({ ...base, organizationId: e.organizationId }), "Ce rendez-vous n'a pas d'acompte sécurisé.");
  });
});
