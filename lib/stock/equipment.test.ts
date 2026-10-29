// Module 5 (étape 5) — Matériel et maintenance : droits, périmètre multi-centres, isolation entre organisations, validation,
// historique ajouté-seulement. Base MongoDB éphémère en mémoire (lib/booking/test-support.ts, inchangé). Lancer : npm test
// Les actions serveur de ces services n'existent pas encore : seuls les services sont testés (aucune session, aucune interface).
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { addDays, dayKey } from "@/lib/booking/time";
import { startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Equipment, MaintenanceRecord } from "@/lib/models/stock";
import * as equipmentModule from "./equipment";
import {
  MSG_EQUIPMENT_ARCHIVED,
  MSG_EQUIPMENT_NOT_FOUND,
  MSG_MAINTENANCE_FUTURE,
  archiveEquipment,
  createEquipment,
  listEquipment,
  listMaintenanceHistory,
  listMaintenanceSchedule,
  recordMaintenance,
  updateEquipment,
} from "./equipment";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN } from "./scope";
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

const now = new Date();
const today = dayKey(now);
const yesterday = dayKey(addDays(now, -1));
const tomorrow = dayKey(addDays(now, 1));
const lastYear = dayKey(addDays(now, -365));
const nextYear = dayKey(addDays(now, 365));

const newEquipment = async (who = w.ownerA(), center = w.a1, extra: Record<string, unknown> = {}) =>
  expectOk(await createEquipment(who, { centerId: id(center), name: "Séchoir", category: "Séchoir", ...extra })).equipment;

describe("droits : tout service refuse STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation", () => {
  it("aucune lecture ni écriture, et rien n'est écrit", async () => {
    const e = await newEquipment();
    const before = [await Equipment.countDocuments(), await MaintenanceRecord.countDocuments()];
    for (const [label, who] of forbiddenActors(w)) {
      const calls: [string, Promise<unknown>][] = [
        ["createEquipment", createEquipment(who, { centerId: id(w.a1), name: "X", category: "Y" })],
        ["updateEquipment", updateEquipment(who, { equipmentId: e.id, name: "Z" })],
        ["archiveEquipment", archiveEquipment(who, { equipmentId: e.id })],
        ["listEquipment", listEquipment(who)],
        ["listMaintenanceSchedule", listMaintenanceSchedule(who)],
        ["recordMaintenance", recordMaintenance(who, { equipmentId: e.id, performedAt: yesterday })],
        ["listMaintenanceHistory", listMaintenanceHistory(who, { equipmentId: e.id })],
      ];
      for (const [name, call] of calls) assert.equal(expectFail((await call) as never, MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, `${label} : ${name}`);
    }
    assert.deepEqual([await Equipment.countDocuments(), await MaintenanceRecord.countDocuments()], before);
  });
});

describe("création (F5.1)", () => {
  it("le propriétaire crée dans n'importe quel centre, le gérant dans les siens ; l'organisation du client est ignorée", async () => {
    const owner = await newEquipment(w.ownerA(), w.a3, { organizationId: id(w.orgB), active: false, status: "OUT_OF_SERVICE" });
    assert.deepEqual([owner.centerId, owner.status, owner.active], [id(w.a3), "OUT_OF_SERVICE", true]);
    const manager = await newEquipment(w.managerA(w.a1), w.a1);
    assert.equal(manager.status, "IN_SERVICE");
    assert.equal(String((await Equipment.findById(owner.id).lean())!.organizationId), id(w.orgA));
  });

  it("10. centre hors périmètre, d'une autre organisation, inexistant ou mal formé : même message, rien d'écrit", async () => {
    const manager = w.managerA(w.a1);
    for (const centerId of [id(w.a2), id(w.b1), newId(), "pas-un-id", "", { $ne: "" }, undefined, null]) {
      expectFail(await createEquipment(manager, { centerId, name: "X", category: "Y" }), MSG_STOCK_CENTER_NOT_FOUND);
    }
    expectFail(await createEquipment(w.ownerA(), { centerId: id(w.b1), name: "X", category: "Y" }), MSG_STOCK_CENTER_NOT_FOUND);
    assert.equal(await Equipment.countDocuments(), 0);
  });

  it("enregistre les dates (jour de Tunis) et refuse les saisies invalides", async () => {
    const e = await newEquipment(w.ownerA(), w.a1, { acquiredAt: "2029-12-01", nextMaintenanceAt: nextYear });
    assert.deepEqual([e.acquiredAt, e.nextMaintenanceAt, e.maintenanceState], ["2029-12-01", nextYear, "SCHEDULED"]);
    const bad: Record<string, unknown>[] = [
      { name: "" },
      { name: "x".repeat(81) },
      { category: "" },
      { category: 5 },
      { status: "BROKEN" },
      { acquiredAt: "2030-02-30" },
      { acquiredAt: "01/12/2029" },
      { nextMaintenanceAt: 20300101 },
      { name: { $ne: "" } },
    ];
    for (const extra of bad) expectFail(await createEquipment(w.ownerA(), { centerId: id(w.a1), name: "X", category: "Y", ...extra }));
    assert.equal(await Equipment.countDocuments({ organizationId: w.orgA._id }), 1);
    expectFail(await createEquipment(w.ownerA(), null));
  });
});

describe("modification et archivage", () => {
  it("modifie nom, catégorie, état et dates ; null efface une date ; le centre ne change pas", async () => {
    const e = await newEquipment(w.managerA(w.a1), w.a1, { nextMaintenanceAt: nextYear, acquiredAt: "2029-01-01" });
    const manager = w.managerA(w.a1);
    const u = expectOk(await updateEquipment(manager, { equipmentId: e.id, name: "Fauteuil", category: "Mobilier", status: "IN_MAINTENANCE", centerId: id(w.a2), organizationId: id(w.orgB) })).equipment;
    assert.deepEqual([u.name, u.category, u.status, u.centerId], ["Fauteuil", "Mobilier", "IN_MAINTENANCE", id(w.a1)]);
    const cleared = expectOk(await updateEquipment(manager, { equipmentId: e.id, nextMaintenanceAt: null, acquiredAt: null })).equipment;
    assert.deepEqual([cleared.nextMaintenanceAt, cleared.acquiredAt, cleared.maintenanceState], [null, null, "NONE"]);
    assert.equal(String((await Equipment.findById(e.id).lean())!.organizationId), id(w.orgA));
    for (const status of ["OUT_OF_SERVICE", "IN_SERVICE"]) assert.equal(expectOk(await updateEquipment(manager, { equipmentId: e.id, status })).equipment.status, status);
  });

  it("`changed` : faux quand la saisie ne modifie rien (aucune écriture), vrai sinon ; l'archivage rejoué est sans effet", async () => {
    const e = await newEquipment(w.ownerA(), w.a1, { name: "Séchoir", category: "Appareil", nextMaintenanceAt: nextYear });
    const owner = w.ownerA();
    const stamp = async () => (await Equipment.findById(e.id).lean())!.updatedAt?.getTime();
    const before = await stamp();
    const same = expectOk(await updateEquipment(owner, { equipmentId: e.id, name: "Séchoir", category: "Appareil", nextMaintenanceAt: nextYear, status: "IN_SERVICE" }));
    assert.equal(same.changed, false);
    assert.equal(await stamp(), before); // aucune écriture
    assert.equal(expectOk(await updateEquipment(owner, { equipmentId: e.id, nextMaintenanceAt: tomorrow })).changed, true);
    assert.equal(expectOk(await updateEquipment(owner, { equipmentId: e.id, status: "IN_MAINTENANCE" })).changed, true);
    assert.equal(expectOk(await archiveEquipment(owner, { equipmentId: e.id })).changed, true);
    assert.equal(expectOk(await archiveEquipment(owner, { equipmentId: e.id })).changed, false);
  });

  it("programmer la maintenance (date seule) ne touche pas aux autres champs ; null déprogramme", async () => {
    const e = await newEquipment(w.managerA(w.a1), w.a1, { name: "Fauteuil", category: "Mobilier", status: "IN_MAINTENANCE", acquiredAt: "2029-01-01" });
    const manager = w.managerA(w.a1);
    const scheduled = expectOk(await updateEquipment(manager, { equipmentId: e.id, nextMaintenanceAt: nextYear })).equipment;
    assert.deepEqual([scheduled.name, scheduled.category, scheduled.status, scheduled.acquiredAt, scheduled.nextMaintenanceAt], ["Fauteuil", "Mobilier", "IN_MAINTENANCE", "2029-01-01", nextYear]);
    const cleared = expectOk(await updateEquipment(manager, { equipmentId: e.id, nextMaintenanceAt: null })).equipment;
    assert.deepEqual([cleared.nextMaintenanceAt, cleared.maintenanceState], [null, "NONE"]);
  });

  it("10. équipement d'un autre centre du gérant, d'une autre organisation, inexistant : « introuvable », rien de modifié", async () => {
    const inA2 = await newEquipment(w.ownerA(), w.a2, { name: "Casque" });
    const inB = await newEquipment(w.ownerB(), w.b1, { name: "Matériel B" });
    const manager = w.managerA(w.a1);
    for (const equipmentId of [inA2.id, inB.id, newId()]) {
      expectFail(await updateEquipment(manager, { equipmentId, name: "Piraté" }), MSG_EQUIPMENT_NOT_FOUND);
      expectFail(await archiveEquipment(manager, { equipmentId }), MSG_EQUIPMENT_NOT_FOUND);
    }
    expectFail(await updateEquipment(w.ownerA(), { equipmentId: inB.id, name: "Piraté" }), MSG_EQUIPMENT_NOT_FOUND);
    expectFail(await updateEquipment(manager, { equipmentId: "n'importe quoi", name: "x" }));
    expectFail(await updateEquipment(manager, { equipmentId: inA2.id }));
    assert.deepEqual([(await Equipment.findById(inA2.id).lean())!.name, (await Equipment.findById(inB.id).lean())!.name], ["Casque", "Matériel B"]);
  });

  it("valide les modifications (état inconnu, date invalide)", async () => {
    const e = await newEquipment();
    expectFail(await updateEquipment(w.ownerA(), { equipmentId: e.id, status: "CASSÉ" }));
    expectFail(await updateEquipment(w.ownerA(), { equipmentId: e.id, nextMaintenanceAt: "2030-13-01" }));
    expectFail(await updateEquipment(w.ownerA(), { equipmentId: e.id, name: "" }));
  });

  it("l'archivage est idempotent, conserve l'historique, bloque la modification et la maintenance", async () => {
    const e = await newEquipment();
    expectOk(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: yesterday, note: "Révision" }));
    expectOk(await archiveEquipment(w.ownerA(), { equipmentId: e.id }));
    expectOk(await archiveEquipment(w.ownerA(), { equipmentId: e.id }));
    assert.equal((await Equipment.findById(e.id).lean())!.active, false);
    expectFail(await updateEquipment(w.ownerA(), { equipmentId: e.id, name: "x" }), MSG_EQUIPMENT_ARCHIVED);
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: today }), MSG_EQUIPMENT_ARCHIVED);
    assert.equal(expectOk(await listMaintenanceHistory(w.ownerA(), { equipmentId: e.id })).history.length, 1); // historique lisible
    assert.equal(await MaintenanceRecord.countDocuments({ equipmentId: e.id }), 1);
  });
});

describe("consultation et échéances", () => {
  it("le propriétaire voit tous ses centres, le gérant les siens, personne ne voit une autre organisation", async () => {
    await newEquipment(w.ownerA(), w.a1, { name: "A1" });
    await newEquipment(w.ownerA(), w.a2, { name: "A2" });
    await newEquipment(w.ownerA(), w.a3, { name: "A3" });
    await newEquipment(w.ownerB(), w.b1, { name: "B1" });
    const names = async (who: ReturnType<World["ownerA"]>, center?: unknown) => expectOk(await listEquipment(who, center)).equipment.map((e) => e.name).sort();
    assert.deepEqual(await names(w.ownerA()), ["A1", "A2", "A3"]);
    assert.deepEqual(await names(w.managerA(w.a1, w.a3)), ["A1", "A3"]);
    assert.deepEqual(await names(w.managerA()), []);
    assert.deepEqual(await names(w.ownerB()), ["B1"]);
    assert.deepEqual(await names(w.managerA(w.a1, w.a3), id(w.a3)), ["A3"]);
    for (const requested of [id(w.a2), id(w.b1), newId(), "", { $ne: "" }]) expectFail(await listEquipment(w.managerA(w.a1), requested), MSG_STOCK_CENTER_NOT_FOUND);
  });

  it("exclut les équipements archivés sauf demande", async () => {
    const e = await newEquipment(w.ownerA(), w.a1, { name: "Ancien" });
    await newEquipment(w.ownerA(), w.a1, { name: "Récent" });
    expectOk(await archiveEquipment(w.ownerA(), { equipmentId: e.id }));
    assert.deepEqual(expectOk(await listEquipment(w.ownerA())).equipment.map((x) => x.name), ["Récent"]);
    assert.equal(expectOk(await listEquipment(w.ownerA(), undefined, true)).equipment.length, 2);
  });

  it("l'échéancier trie du plus en retard au plus lointain, exclut sans date et archivés, et qualifie chaque échéance", async () => {
    await newEquipment(w.ownerA(), w.a1, { name: "Lointain", nextMaintenanceAt: nextYear });
    await newEquipment(w.ownerA(), w.a1, { name: "En retard", nextMaintenanceAt: lastYear });
    await newEquipment(w.ownerA(), w.a2, { name: "Aujourd'hui", nextMaintenanceAt: today });
    await newEquipment(w.ownerA(), w.a1, { name: "Sans date" });
    const old = await newEquipment(w.ownerA(), w.a1, { name: "Archivé", nextMaintenanceAt: yesterday });
    expectOk(await archiveEquipment(w.ownerA(), { equipmentId: old.id }));
    await newEquipment(w.ownerB(), w.b1, { name: "Autre organisation", nextMaintenanceAt: lastYear });

    const schedule = expectOk(await listMaintenanceSchedule(w.ownerA())).schedule;
    assert.deepEqual(schedule.map((e) => [e.name, e.maintenanceState]), [
      ["En retard", "OVERDUE"],
      ["Aujourd'hui", "DUE_TODAY"],
      ["Lointain", "SCHEDULED"],
    ]);
    assert.deepEqual(expectOk(await listMaintenanceSchedule(w.managerA(w.a2))).schedule.map((e) => e.name), ["Aujourd'hui"]);
    expectFail(await listMaintenanceSchedule(w.managerA(w.a2), id(w.a1)), MSG_STOCK_CENTER_NOT_FOUND);
  });
});

describe("maintenance (F5.4) : historique ajouté-seulement", () => {
  it("enregistre une intervention, trace l'auteur, et reporte l'échéance suivante sur la fiche", async () => {
    const e = await newEquipment(w.ownerA(), w.a1, { nextMaintenanceAt: yesterday });
    const manager = w.managerA(w.a1);
    const r = expectOk(await recordMaintenance(manager, { equipmentId: e.id, performedAt: today, note: "  Remplacement résistance  ", nextDueAt: nextYear, centerId: id(w.a2), organizationId: id(w.orgB) }));
    assert.deepEqual([r.record.performedAt, r.record.note, r.record.nextDueAt, r.equipment.nextMaintenanceAt, r.equipment.maintenanceState], [today, "Remplacement résistance", nextYear, nextYear, "SCHEDULED"]);
    const stored = (await MaintenanceRecord.findOne({ equipmentId: e.id }).lean())!;
    assert.equal(String(stored.createdBy), manager.id);
    assert.equal(String(stored.organizationId), id(w.orgA)); // organisation et centre viennent de l'équipement, pas de la saisie
    assert.equal(String(stored.centerId), id(w.a1));
  });

  it("l'intervention la plus récente fixe l'échéance (ou l'efface) ; une intervention plus ancienne saisie après coup n'y touche pas", async () => {
    const e = await newEquipment();
    const owner = w.ownerA();
    expectOk(await recordMaintenance(owner, { equipmentId: e.id, performedAt: yesterday, nextDueAt: nextYear }));
    expectOk(await recordMaintenance(owner, { equipmentId: e.id, performedAt: lastYear, nextDueAt: tomorrow })); // plus ancienne
    assert.equal(expectOk(await listEquipment(owner)).equipment[0].nextMaintenanceAt, nextYear);
    expectOk(await recordMaintenance(owner, { equipmentId: e.id, performedAt: today })); // la plus récente, sans échéance : plus d'échéance
    assert.equal(expectOk(await listEquipment(owner)).equipment[0].nextMaintenanceAt, null);
    assert.equal(await MaintenanceRecord.countDocuments({ equipmentId: e.id }), 3);
  });

  it("refuse une date future, une échéance antérieure à l'intervention, une note trop longue, des types incorrects", async () => {
    const e = await newEquipment();
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: tomorrow }));
    assert.deepEqual(expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: tomorrow })).errors?.performedAt, [MSG_MAINTENANCE_FUTURE]);
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: today, nextDueAt: yesterday }));
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: today, note: "x".repeat(201) }));
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: "hier" }));
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: today, note: { $ne: "" } }));
    expectFail(await recordMaintenance(w.ownerA(), { performedAt: today }));
    assert.equal(await MaintenanceRecord.countDocuments(), 0);
  });

  it("10. équipement d'un autre centre, d'une autre organisation ou inexistant : « introuvable », aucune intervention créée", async () => {
    const inA2 = await newEquipment(w.ownerA(), w.a2);
    const inB = await newEquipment(w.ownerB(), w.b1);
    for (const equipmentId of [inA2.id, inB.id, newId()]) {
      expectFail(await recordMaintenance(w.managerA(w.a1), { equipmentId, performedAt: today }), MSG_EQUIPMENT_NOT_FOUND);
      expectFail(await listMaintenanceHistory(w.managerA(w.a1), { equipmentId }), MSG_EQUIPMENT_NOT_FOUND);
    }
    expectFail(await recordMaintenance(w.ownerA(), { equipmentId: inB.id, performedAt: today }), MSG_EQUIPMENT_NOT_FOUND);
    assert.equal(await MaintenanceRecord.countDocuments(), 0);
  });

  it("historique : du plus récent au plus ancien, limité, isolé", async () => {
    const e = await newEquipment();
    for (const day of [lastYear, yesterday, today]) expectOk(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: day, note: day }));
    const history = expectOk(await listMaintenanceHistory(w.ownerA(), { equipmentId: e.id })).history;
    assert.deepEqual(history.map((h) => h.performedAt), [today, yesterday, lastYear]);
    assert.equal(expectOk(await listMaintenanceHistory(w.ownerA(), { equipmentId: e.id, limit: 2 })).history.length, 2);
    for (const limit of [0, 201, 1.5, "10"]) expectFail(await listMaintenanceHistory(w.ownerA(), { equipmentId: e.id, limit }));
    assert.deepEqual(expectOk(await listMaintenanceHistory(w.managerA(w.a1), { equipmentId: e.id })).history.length, 3);
  });

  it("aucune modification ni suppression de l'historique n'est exposée, et le modèle refuse de modifier un enregistrement", async () => {
    const names = Object.keys(equipmentModule).filter((k) => typeof (equipmentModule as Record<string, unknown>)[k] === "function");
    assert.deepEqual(names.filter((n) => /maintenance/i.test(n)).sort(), ["listMaintenanceHistory", "listMaintenanceSchedule", "recordMaintenance"]);
    assert.ok(!names.some((n) => /delete|remove|edit/i.test(n)));
    const e = await newEquipment();
    expectOk(await recordMaintenance(w.ownerA(), { equipmentId: e.id, performedAt: yesterday, note: "Révision" }));
    const rec = (await MaintenanceRecord.findOne({ equipmentId: e.id }).lean())!;
    await MaintenanceRecord.updateOne({ _id: rec._id }, { $set: { note: "Réécrit", performedAt: new Date(0) } }).catch(() => {});
    const after = (await MaintenanceRecord.findById(rec._id).lean())!;
    assert.deepEqual([after.note, after.performedAt.toISOString()], ["Révision", rec.performedAt.toISOString()]);
  });
});
