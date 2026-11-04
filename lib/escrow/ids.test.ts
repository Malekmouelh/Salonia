// Attribution des numéros SalonEscrow (chainId, walletIndex). Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Center, User } from "@/lib/models/core";
import { createCenter, createOrg, createUser, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { EscrowError, ensureCenterChainId, ensurePractitionerChainId, ensureWalletIndex } from "./ids";

let db: TestDb;
before(async () => {
  db = await startTestDb();
  // Index uniques (sparse) créés avant les tests de concurrence.
  await Promise.all([Center.syncIndexes(), User.syncIndexes()]);
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  await resetTestDb(db);
  await Promise.all([Center.syncIndexes(), User.syncIndexes()]);
});

const rejects = (promise: Promise<unknown>, message: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof EscrowError && e.message === message);

describe("ensureCenterChainId", () => {
  it("attribue 1, 2… puis renvoie toujours le même numéro pour un centre", async () => {
    const org = await createOrg();
    const a = await createCenter(org._id, "A");
    const b = await createCenter(org._id, "B");
    assert.equal(await ensureCenterChainId(String(org._id), String(a._id)), 1);
    assert.equal(await ensureCenterChainId(String(org._id), String(b._id)), 2);
    assert.equal(await ensureCenterChainId(String(org._id), String(a._id)), 1);
    assert.equal((await Center.findById(a._id).lean())?.chainId, 1);
  });

  it("dix demandes simultanées pour le même centre donnent un seul numéro", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const ids = await Promise.all(Array.from({ length: 10 }, () => ensureCenterChainId(String(org._id), String(center._id))));
    assert.equal(new Set(ids).size, 1);
    assert.equal((await Center.findById(center._id).lean())?.chainId, ids[0]);
  });

  it("refuse le centre d'une autre organisation (isolation)", async () => {
    const org = await createOrg();
    const other = await createOrg("Autre salon");
    const center = await createCenter(other._id);
    await rejects(ensureCenterChainId(String(org._id), String(center._id)), "Centre introuvable.");
    assert.equal((await Center.findById(center._id).lean())?.chainId, undefined);
  });
});

describe("ensurePractitionerChainId", () => {
  it("numérote un STAFF affecté au centre, indépendamment des centres", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    await ensureCenterChainId(String(org._id), String(center._id));
    const staff = await createUser(org._id, [center._id], "Amira");
    assert.equal(await ensurePractitionerChainId(String(org._id), String(center._id), String(staff._id)), 1);
  });

  it("refuse un staff d'un autre centre, un gérant ou un compte d'une autre organisation", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id, "A");
    const otherCenter = await createCenter(org._id, "B");
    const elsewhere = await createUser(org._id, [otherCenter._id], "Sami");
    const manager = await createUser(org._id, [center._id], "Rim", "MANAGER");
    const otherOrg = await createOrg("Autre salon");
    const foreign = await createUser(otherOrg._id, [center._id], "Nour");
    const message = "Ce praticien ne travaille pas dans ce centre.";
    for (const user of [elsewhere, manager, foreign]) {
      await rejects(ensurePractitionerChainId(String(org._id), String(center._id), String(user._id)), message);
    }
  });
});

describe("ensureWalletIndex", () => {
  it("donne un index distinct et stable à chaque compte (client, staff)", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const staff = await createUser(org._id, [center._id], "Amira");
    const client = await User.create({ firstName: "Client", lastName: "Test", email: "client@test.local", passwordHash: "x", role: "CLIENT" });

    const staffIndex = await ensureWalletIndex(String(staff._id));
    const clientIndex = await ensureWalletIndex(String(client._id));
    assert.notEqual(staffIndex, clientIndex);
    assert.equal(await ensureWalletIndex(String(staff._id)), staffIndex);
  });

  it("le chainId d'un praticien et son walletIndex sont deux numéros indépendants", async () => {
    const org = await createOrg();
    const center = await createCenter(org._id);
    const staff = await createUser(org._id, [center._id], "Amira");
    await ensureWalletIndex(String(staff._id));
    await ensureWalletIndex(String((await createUser(org._id, [center._id], "Sami"))._id));
    assert.equal(await ensurePractitionerChainId(String(org._id), String(center._id), String(staff._id)), 1);
    const saved = await User.findById(staff._id).lean();
    assert.deepEqual([saved?.chainId, saved?.walletIndex], [1, 1]);
  });
});
