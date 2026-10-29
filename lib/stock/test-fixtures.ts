// Outils des tests de services du Module 5 (matériel, maintenance, fournisseurs, commandes). Ce fichier n'est pas un test :
// il n'est importé que par les fichiers *.test.ts. Il réutilise lib/booking/test-support.ts sans le modifier (base MongoDB
// éphémère en mémoire, jamais .env).
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { createCenter, createOrg, resetTestDb, type TestDb } from "@/lib/booking/test-support";
import type { Role } from "@/lib/enums";
import { Equipment, MaintenanceRecord, PurchaseOrder, ServiceRecipe, StockLevel, StockMovement, StockProduct, Supplier } from "@/lib/models/stock";
import type { StockActor, StockFailure, StockResult } from "./service";

type Org = Awaited<ReturnType<typeof createOrg>>;
type Center = Awaited<ReturnType<typeof createCenter>>;

export type World = {
  orgA: Org;
  orgB: Org;
  a1: Center;
  a2: Center;
  a3: Center;
  b1: Center;
  actor: (role: Role, org: Org | null, assigned?: Center[]) => StockActor;
  ownerA: () => StockActor;
  managerA: (...centers: Center[]) => StockActor;
  ownerB: () => StockActor;
  managerB: (...centers: Center[]) => StockActor;
};

// Vide la base de test et reconstruit les index (la base est supprimée entre les tests), puis crée deux organisations.
export async function makeWorld(db: TestDb): Promise<World> {
  await resetTestDb(db);
  await Promise.all([Equipment, StockProduct, StockLevel, ServiceRecipe, StockMovement, MaintenanceRecord, Supplier, PurchaseOrder].map((m) => m.syncIndexes()));
  const orgA = await createOrg("Salon A");
  const orgB = await createOrg("Salon B");
  const a1 = await createCenter(orgA._id, "Tunis");
  const a2 = await createCenter(orgA._id, "Sousse");
  const a3 = await createCenter(orgA._id, "Djerba");
  const b1 = await createCenter(orgB._id, "Sfax");
  const centersOf = (org: Org | null) => (org === orgA ? [a1, a2, a3] : org === orgB ? [b1] : []);

  const actor = (role: Role, org: Org | null, assigned: Center[] = []): StockActor => ({
    id: String(new Types.ObjectId()),
    role,
    centerIds: assigned.map((c) => String(c._id)),
    organization: org ? { id: String(org._id), name: org.name, slug: org.slug, centers: centersOf(org).map((c) => ({ id: String(c._id), name: c.name, governorate: "TUNIS" as const })) } : null,
  });
  return {
    orgA,
    orgB,
    a1,
    a2,
    a3,
    b1,
    actor,
    ownerA: () => actor("OWNER", orgA),
    managerA: (...centers) => actor("MANAGER", orgA, centers),
    ownerB: () => actor("OWNER", orgB),
    managerB: (...centers) => actor("MANAGER", orgB, centers),
  };
}

export const id = (doc: { _id: unknown }) => String(doc._id);
export const newId = () => String(new Types.ObjectId());

export function expectOk<T>(result: StockResult<T>) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as Extract<StockResult<T>, { ok: true }>;
}

export function expectFail<T>(result: StockResult<T>, message?: string) {
  assert.equal(result.ok, false, "une réussite était inattendue");
  const failure = result as StockFailure;
  if (message) assert.equal(failure.message, message);
  return failure;
}

// Acteurs qui n'ont aucun droit d'administration du stock.
export function forbiddenActors(w: World): [string, StockActor][] {
  return [
    ["STAFF", w.actor("STAFF", w.orgA, [w.a1])],
    ["CLIENT", w.actor("CLIENT", w.orgA, [w.a1])],
    ["SUPER_ADMIN", w.actor("SUPER_ADMIN", w.orgA, [w.a1])],
    ["OWNER sans organisation", w.actor("OWNER", null)],
    ["MANAGER sans organisation", w.actor("MANAGER", null)],
  ];
}
