// Règles SalonEscrow recopiées côté serveur : elles doivent donner le même résultat que le contrat. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromLocal } from "@/lib/booking/time";
import {
  bookingStatusForEscrow,
  cancellationOutcome,
  escrowStatusFromChain,
  isEscrowSlot,
  isUint32,
  staffActions,
  toChainTime,
  unitsToTnd,
} from "./rules";

const START = fromLocal(2030, 1, 7, 10, 0); // lundi 7 janvier 2030, 10:00 à Tunis
const before = (ms: number) => new Date(START.getTime() - ms);
const after = (ms: number) => new Date(START.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("isEscrowSlot : heure de début alignée sur 30 minutes", () => {
  it("accepte 10:00 et 10:30 (heure de Tunis)", () => {
    assert.equal(isEscrowSlot(START), true);
    assert.equal(isEscrowSlot(fromLocal(2030, 1, 7, 10, 30)), true);
  });

  it("refuse 10:15, 10:45 et une heure avec des secondes", () => {
    assert.equal(isEscrowSlot(fromLocal(2030, 1, 7, 10, 15)), false);
    assert.equal(isEscrowSlot(fromLocal(2030, 1, 7, 10, 45)), false);
    assert.equal(isEscrowSlot(after(1 * SECOND)), false);
    assert.equal(isEscrowSlot(after(500)), false);
  });

  it("convertit en secondes Unix comme block.timestamp", () => {
    assert.equal(toChainTime(START), Date.UTC(2030, 0, 7, 9, 0) / 1000);
  });
});

describe("cancellationOutcome : règle des 24 heures", () => {
  it("30 h avant : remboursé ; 24 h pile : remboursé", () => {
    assert.equal(cancellationOutcome(START, before(30 * HOUR)), "REFUND");
    assert.equal(cancellationOutcome(START, before(24 * HOUR)), "REFUND");
  });

  it("1 seconde de moins que 24 h, ou 2 h avant : acompte au salon", () => {
    assert.equal(cancellationOutcome(START, before(24 * HOUR - SECOND)), "SALON");
    assert.equal(cancellationOutcome(START, before(2 * HOUR)), "SALON");
    assert.equal(cancellationOutcome(START, before(SECOND)), "SALON");
  });

  it("à partir de l'heure de début : annulation impossible", () => {
    assert.equal(cancellationOutcome(START, START), "STARTED");
    assert.equal(cancellationOutcome(START, after(MINUTE)), "STARTED");
  });

  it("ignore les millisecondes, comme le contrat (secondes entières)", () => {
    assert.equal(cancellationOutcome(START, before(24 * HOUR - 500)), "REFUND");
  });
});

describe("staffActions : validation au début, absence 15 minutes après", () => {
  it("avant le début : rien n'est possible", () => {
    assert.deepEqual(staffActions(START, before(SECOND)), { canComplete: false, canNoShow: false });
  });

  it("au début : validation possible, absence pas encore", () => {
    assert.deepEqual(staffActions(START, START), { canComplete: true, canNoShow: false });
    assert.deepEqual(staffActions(START, after(15 * MINUTE - SECOND)), { canComplete: true, canNoShow: false });
  });

  it("à 15 minutes : les deux sont possibles", () => {
    assert.deepEqual(staffActions(START, after(15 * MINUTE)), { canComplete: true, canNoShow: true });
  });
});

describe("statuts de la chaîne", () => {
  it("suit l'ordre de l'enum de SlotBooking.sol (0 à 4)", () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(escrowStatusFromChain), ["NONE", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]);
    assert.equal(escrowStatusFromChain(BigInt(3)), "COMPLETED");
  });

  it("refuse une valeur inconnue", () => {
    assert.throws(() => escrowStatusFromChain(5), /inconnu/);
  });

  it("donne le statut Salonia du rendez-vous", () => {
    assert.equal(bookingStatusForEscrow("CANCELLED"), "CANCELLED");
    assert.equal(bookingStatusForEscrow("COMPLETED"), "COMPLETED");
    assert.equal(bookingStatusForEscrow("NO_SHOW"), "NO_SHOW");
    assert.equal(bookingStatusForEscrow("CONFIRMED"), "CONFIRMED");
  });
});

describe("montants et identifiants", () => {
  it("unitsToTnd : 6 décimales", () => {
    assert.equal(unitsToTnd(BigInt(30_000_000)), "30");
    assert.equal(unitsToTnd("12500000"), "12.5");
    assert.equal(unitsToTnd(BigInt(1)), "0.000001");
    assert.equal(unitsToTnd(BigInt(0)), "0");
  });

  it("isUint32 : entier entre 1 et 2^32 - 1", () => {
    assert.equal(isUint32(1), true);
    assert.equal(isUint32(4_294_967_295), true);
    assert.equal(isUint32(0), false);
    assert.equal(isUint32(4_294_967_296), false);
    assert.equal(isUint32(1.5), false);
    assert.equal(isUint32("3"), false);
  });
});
