// Module 5 (étape 5) — Fournisseurs : droits (écriture réservée au propriétaire), isolation entre organisations, validation,
// unicité du nom, archivage. Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Supplier } from "@/lib/models/stock";
import { MSG_STOCK_FORBIDDEN } from "./scope";
import { MSG_SUPPLIER_ARCHIVED, MSG_SUPPLIER_NAME_TAKEN, MSG_SUPPLIER_NOT_FOUND, archiveSupplier, createSupplier, listSuppliers, updateSupplier } from "./suppliers";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, newId, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  w = await makeWorld(db);
});

const supplier = async (who = w.ownerA(), name = "Distri Beauté", extra: Record<string, unknown> = {}) => expectOk(await createSupplier(who, { name, ...extra })).supplier;

describe("droits", () => {
  it("STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation sont refusés partout, sans écriture", async () => {
    const s = await supplier();
    for (const [label, who] of forbiddenActors(w)) {
      for (const [name, result] of [
        ["createSupplier", await createSupplier(who, { name: "X" })],
        ["updateSupplier", await updateSupplier(who, { supplierId: s.id, name: "Y" })],
        ["archiveSupplier", await archiveSupplier(who, { supplierId: s.id })],
        ["listSuppliers", await listSuppliers(who)],
      ] as const) assert.equal(expectFail(result, MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, `${label} : ${name}`);
    }
    assert.equal(await Supplier.countDocuments(), 1);
    assert.equal((await Supplier.findById(s.id).lean())!.name, "Distri Beauté");
  });

  it("le gérant lit les fournisseurs mais ne les crée, modifie ni archive", async () => {
    const s = await supplier();
    const manager = w.managerA(w.a1);
    expectFail(await createSupplier(manager, { name: "Autre" }), MSG_STOCK_FORBIDDEN);
    expectFail(await updateSupplier(manager, { supplierId: s.id, name: "Autre" }), MSG_STOCK_FORBIDDEN);
    expectFail(await archiveSupplier(manager, { supplierId: s.id }), MSG_STOCK_FORBIDDEN);
    assert.deepEqual(expectOk(await listSuppliers(manager)).suppliers.map((x) => x.name), ["Distri Beauté"]);
    assert.deepEqual(expectOk(await listSuppliers(w.managerA())).suppliers.map((x) => x.name), ["Distri Beauté"]); // gérant sans centre : lecture permise, comme les définitions de produits
  });
});

describe("création et validation", () => {
  it("crée un fournisseur de l'organisation de l'acteur ; téléphone normalisé, e-mail en minuscules ; organisation du client ignorée", async () => {
    const s = await supplier(w.ownerA(), " L'Oréal Pro ", { phone: "+216 22 345 678", email: "Contact@Loreal.TN", leadTimeDays: 7, organizationId: id(w.orgB), active: false });
    assert.deepEqual([s.name, s.phone, s.email, s.leadTimeDays, s.active], ["L'Oréal Pro", "22345678", "contact@loreal.tn", 7, true]);
    assert.equal(String((await Supplier.findById(s.id).lean())!.organizationId), id(w.orgA));
  });

  it("coordonnées facultatives, délai par défaut 0", async () => {
    const s = await supplier(w.ownerA(), "Sans coordonnées");
    assert.deepEqual([s.phone, s.email, s.leadTimeDays], [null, null, 0]);
  });

  it("refuse les saisies invalides sans rien créer", async () => {
    const bad: Record<string, unknown>[] = [
      { name: "" },
      { name: "x".repeat(81) },
      { name: { $ne: "" } },
      { phone: "12345" },
      { phone: "11111111" },
      { phone: 22345678 },
      { email: "pas-un-mail" },
      { email: ["a@b.tn"] },
      { leadTimeDays: -1 },
      { leadTimeDays: 366 },
      { leadTimeDays: 2.5 },
      { leadTimeDays: "7" },
    ];
    for (const extra of bad) expectFail(await createSupplier(w.ownerA(), { name: "Valide", ...extra }));
    expectFail(await createSupplier(w.ownerA(), null));
    assert.equal(await Supplier.countDocuments(), 0);
  });

  it("le nom d'un fournisseur actif est unique par organisation (insensible à la casse) ; un archivé libère le nom ; une autre organisation n'est pas concernée", async () => {
    const first = await supplier(w.ownerA(), "Distri");
    assert.deepEqual(expectFail(await createSupplier(w.ownerA(), { name: "DISTRI" })).errors?.name, [MSG_SUPPLIER_NAME_TAKEN]);
    expectOk(await createSupplier(w.ownerB(), { name: "Distri" }));
    expectOk(await archiveSupplier(w.ownerA(), { supplierId: first.id }));
    expectOk(await createSupplier(w.ownerA(), { name: "distri" }));
  });
});

describe("modification et archivage", () => {
  it("modifie partiellement ; null efface une coordonnée ; renommer vers un nom pris est refusé", async () => {
    const s = await supplier(w.ownerA(), "Distri", { phone: "22345678", email: "a@b.tn", leadTimeDays: 3 });
    await supplier(w.ownerA(), "Autre");
    const u = expectOk(await updateSupplier(w.ownerA(), { supplierId: s.id, leadTimeDays: 10, phone: null })).supplier;
    assert.deepEqual([u.name, u.phone, u.email, u.leadTimeDays], ["Distri", null, "a@b.tn", 10]);
    assert.deepEqual(expectFail(await updateSupplier(w.ownerA(), { supplierId: s.id, name: "AUTRE" })).errors?.name, [MSG_SUPPLIER_NAME_TAKEN]);
    expectFail(await updateSupplier(w.ownerA(), { supplierId: s.id }));
    expectFail(await updateSupplier(w.ownerA(), { supplierId: s.id, email: "nope" }));
    assert.equal((await Supplier.findById(s.id).lean())!.name, "Distri");
  });

  it("`changed` : faux quand la saisie ne modifie rien (aucune écriture), vrai sinon ; l'archivage rejoué est sans effet", async () => {
    const s = await supplier(w.ownerA(), "Distri", { phone: "22345678", email: "a@b.tn", leadTimeDays: 3 });
    const stamp = async () => (await Supplier.findById(s.id).lean())!.updatedAt?.getTime();
    const before = await stamp();
    const same = expectOk(await updateSupplier(w.ownerA(), { supplierId: s.id, name: "Distri", phone: "+216 22 345 678", email: "A@B.TN", leadTimeDays: 3 }));
    assert.equal(same.changed, false);
    assert.equal(await stamp(), before); // aucune écriture
    assert.equal(expectOk(await updateSupplier(w.ownerA(), { supplierId: s.id, leadTimeDays: 4 })).changed, true);
    assert.equal(expectOk(await archiveSupplier(w.ownerA(), { supplierId: s.id })).changed, true);
    assert.equal(expectOk(await archiveSupplier(w.ownerA(), { supplierId: s.id })).changed, false);
  });

  it("10. fournisseur d'une autre organisation, inexistant ou mal formé : « introuvable », rien de modifié", async () => {
    const foreign = await supplier(w.ownerB(), "Fournisseur B");
    for (const supplierId of [foreign.id, newId()]) {
      expectFail(await updateSupplier(w.ownerA(), { supplierId, name: "Piraté" }), MSG_SUPPLIER_NOT_FOUND);
      expectFail(await archiveSupplier(w.ownerA(), { supplierId }), MSG_SUPPLIER_NOT_FOUND);
    }
    expectFail(await updateSupplier(w.ownerA(), { supplierId: "x", name: "y" }));
    assert.deepEqual([(await Supplier.findById(foreign.id).lean())!.name, (await Supplier.findById(foreign.id).lean())!.active], ["Fournisseur B", true]);
  });

  it("l'archivage est idempotent, conserve la fiche et interdit ensuite la modification", async () => {
    const s = await supplier();
    expectOk(await archiveSupplier(w.ownerA(), { supplierId: s.id }));
    assert.equal(expectOk(await archiveSupplier(w.ownerA(), { supplierId: s.id })).supplier.active, false);
    assert.equal(await Supplier.countDocuments({ _id: s.id }), 1);
    expectFail(await updateSupplier(w.ownerA(), { supplierId: s.id, name: "x" }), MSG_SUPPLIER_ARCHIVED);
  });
});

describe("consultation", () => {
  it("liste les fournisseurs actifs de l'organisation (archivés sur demande), jamais ceux d'une autre", async () => {
    const a = await supplier(w.ownerA(), "Alpha");
    await supplier(w.ownerA(), "Beta");
    await supplier(w.ownerB(), "Gamma");
    expectOk(await archiveSupplier(w.ownerA(), { supplierId: a.id }));
    assert.deepEqual(expectOk(await listSuppliers(w.ownerA())).suppliers.map((s) => s.name), ["Beta"]);
    assert.deepEqual(expectOk(await listSuppliers(w.ownerA(), true)).suppliers.map((s) => s.name), ["Alpha", "Beta"]);
    assert.deepEqual(expectOk(await listSuppliers(w.ownerB())).suppliers.map((s) => s.name), ["Gamma"]);
  });

  it("ne renvoie aucun identifiant d'organisation", async () => {
    await supplier();
    assert.ok(!JSON.stringify(expectOk(await listSuppliers(w.ownerA()))).includes(id(w.orgA)));
  });
});
