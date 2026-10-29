// Module 5 (étape 2) — Droits et périmètre multi-centres. Tests purs, sans base ni session.
// Ils vérifient les décisions de lib/stock/scope.ts ; l'application dans les services et les actions (filtre
// organizationId, relecture des enregistrements) est à tester aux étapes suivantes, avec une base en mémoire.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentUser } from "@/lib/dal";
import type { Role } from "@/lib/enums";
import {
  MSG_STOCK_CENTER_NOT_FOUND,
  MSG_STOCK_FORBIDDEN,
  StockAccessError,
  canAdministerStock,
  canManageProductDefinitions,
  isInStockScope,
  requireProductDefinitionsAdmin,
  requireStockAdmin,
  requireStockCenter,
  resolveStockCenter,
  stockCenters,
  stockFilter,
  stockScope,
} from "./scope";

const centers = [
  { id: "c1", name: "Tunis", governorate: "TUNIS" as const },
  { id: "c2", name: "Sousse", governorate: "SOUSSE" as const },
  { id: "c3", name: "Djerba", governorate: "MEDENINE" as const },
];
const user = (role: Role, centerIds: string[], withOrg = true): Pick<CurrentUser, "role" | "organization" | "centerIds"> => ({
  role,
  centerIds,
  organization: withOrg ? { id: "o1", name: "Salon", slug: "salon", centers } : null,
});
const ids = (list: { id: string }[]) => list.map((c) => c.id);
const OTHERS = ["STAFF", "CLIENT", "SUPER_ADMIN"] as const;

function failure(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("droits d'administration", () => {
  it("propriétaire et gérant administrent le stock ; les autres rôles non, même affectés à des centres", () => {
    assert.equal(canAdministerStock(user("OWNER", [])), true);
    assert.equal(canAdministerStock(user("MANAGER", ["c1"])), true);
    for (const role of OTHERS) assert.equal(canAdministerStock(user(role, ["c1", "c2"])), false, role);
  });

  it("sans organisation, personne n'administre le stock", () => {
    for (const role of ["OWNER", "MANAGER", ...OTHERS] as const) assert.equal(canAdministerStock(user(role, ["c1"], false)), false, role);
  });

  it("les définitions de produits et les recettes sont réservées au propriétaire", () => {
    assert.equal(canManageProductDefinitions(user("OWNER", [])), true);
    for (const role of ["MANAGER", ...OTHERS] as const) assert.equal(canManageProductDefinitions(user(role, ["c1"])), false, role);
    assert.equal(canManageProductDefinitions(user("OWNER", [], false)), false);
  });
});

describe("stockCenters", () => {
  it("le propriétaire a tous les centres de son organisation, affecté ou non", () => {
    assert.deepEqual(ids(stockCenters(user("OWNER", []))), ["c1", "c2", "c3"]);
    assert.deepEqual(ids(stockCenters(user("OWNER", ["c1"]))), ["c1", "c2", "c3"]);
  });

  it("le gérant n'a que ses centres, dans l'ordre de l'organisation", () => {
    assert.deepEqual(ids(stockCenters(user("MANAGER", ["c3", "c1"]))), ["c1", "c3"]);
  });

  it("ignore un centre d'affectation étranger à l'organisation ; un gérant sans centre n'a rien", () => {
    assert.deepEqual(ids(stockCenters(user("MANAGER", ["c2", "centre-d-une-autre-organisation"]))), ["c2"]);
    assert.deepEqual(stockCenters(user("MANAGER", [])), []);
  });

  it("les autres rôles et un acteur sans organisation n'ont aucun centre", () => {
    for (const role of OTHERS) assert.deepEqual(stockCenters(user(role, ["c1"])), [], role);
    assert.deepEqual(stockCenters(user("OWNER", ["c1"], false)), []);
  });
});

describe("resolveStockCenter : un centre fourni par le client n'est jamais cru sur parole", () => {
  it("accepte un centre du périmètre", () => {
    assert.equal(resolveStockCenter(user("OWNER", []), "c3"), "c3");
    assert.equal(resolveStockCenter(user("MANAGER", ["c1"]), "c1"), "c1");
  });

  it("refuse un centre hors périmètre du gérant, un centre d'une autre organisation et un identifiant inexistant", () => {
    const manager = user("MANAGER", ["c1"]);
    assert.equal(resolveStockCenter(manager, "c2"), null);
    assert.equal(resolveStockCenter(manager, "centre-d-une-autre-organisation"), null);
    assert.equal(resolveStockCenter(user("OWNER", []), "centre-d-une-autre-organisation"), null);
    assert.equal(resolveStockCenter(user("OWNER", []), "000000000000000000000000"), null);
  });

  it("refuse tout ce qui n'est pas une chaîne non vide (absent, objet d'opérateur Mongo, tableau, nombre)", () => {
    const owner = user("OWNER", []);
    for (const bad of [undefined, null, "", 1, ["c1"], { $ne: "" }, { $in: ["c1"] }, true]) assert.equal(resolveStockCenter(owner, bad), null, JSON.stringify(bad));
  });

  it("ne tolère ni espaces ni variation de casse autour d'un identifiant valide", () => {
    assert.equal(resolveStockCenter(user("OWNER", []), " c1"), null);
    assert.equal(resolveStockCenter(user("OWNER", []), "C1"), null);
  });

  it("refuse tout pour STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation", () => {
    for (const role of OTHERS) assert.equal(resolveStockCenter(user(role, ["c1"]), "c1"), null, role);
    assert.equal(resolveStockCenter(user("OWNER", ["c1"], false), "c1"), null);
  });
});

describe("gardes (requireStockAdmin, requireProductDefinitionsAdmin, requireStockCenter)", () => {
  it("requireStockAdmin renvoie l'organisation de l'acteur pour un propriétaire ou un gérant", () => {
    assert.equal(requireStockAdmin(user("OWNER", [])), "o1");
    assert.equal(requireStockAdmin(user("MANAGER", ["c1"])), "o1");
  });

  it("requireStockAdmin refuse STAFF, CLIENT, SUPER_ADMIN et l'absence d'organisation", () => {
    for (const role of OTHERS) {
      const error = failure(() => requireStockAdmin(user(role, ["c1"])));
      assert.ok(error instanceof StockAccessError, role);
      assert.equal((error as Error).message, MSG_STOCK_FORBIDDEN);
    }
    assert.ok(failure(() => requireStockAdmin(user("OWNER", [], false))) instanceof StockAccessError);
  });

  it("requireProductDefinitionsAdmin : propriétaire seulement, le gérant est refusé", () => {
    assert.equal(requireProductDefinitionsAdmin(user("OWNER", [])), "o1");
    for (const role of ["MANAGER", ...OTHERS] as const) {
      const error = failure(() => requireProductDefinitionsAdmin(user(role, ["c1"])));
      assert.ok(error instanceof StockAccessError, role);
      assert.equal((error as Error).message, MSG_STOCK_FORBIDDEN);
    }
  });

  it("requireStockCenter renvoie l'organisation de l'acteur et le centre validé", () => {
    assert.deepEqual(requireStockCenter(user("MANAGER", ["c2"]), "c2"), { organizationId: "o1", centerId: "c2" });
    assert.deepEqual(requireStockCenter(user("OWNER", []), "c3"), { organizationId: "o1", centerId: "c3" });
  });

  it("requireStockCenter donne le MÊME message pour un centre hors périmètre, étranger ou inexistant", () => {
    const manager = user("MANAGER", ["c1"]);
    const messages = ["c2", "centre-d-une-autre-organisation", "000000000000000000000000", undefined, { $ne: "" }].map((bad) => {
      const error = failure(() => requireStockCenter(manager, bad));
      assert.ok(error instanceof StockAccessError, JSON.stringify(bad));
      return (error as Error).message;
    });
    assert.deepEqual(new Set(messages), new Set([MSG_STOCK_CENTER_NOT_FOUND]));
  });

  it("requireStockCenter refuse d'abord un rôle sans droit, même pour un centre valide", () => {
    for (const role of OTHERS) {
      const error = failure(() => requireStockCenter(user(role, ["c1"]), "c1"));
      assert.ok(error instanceof StockAccessError, role);
      assert.equal((error as Error).message, MSG_STOCK_FORBIDDEN);
    }
  });
});

describe("stockScope et stockFilter", () => {
  it("sans centre demandé : tous les centres autorisés de l'acteur", () => {
    assert.deepEqual(stockScope(user("OWNER", [])), { organizationId: "o1", centerIds: ["c1", "c2", "c3"] });
    assert.deepEqual(stockScope(user("MANAGER", ["c3", "c1"]), null), { organizationId: "o1", centerIds: ["c1", "c3"] });
  });

  it("avec un centre demandé : ce centre seulement, s'il est dans le périmètre", () => {
    assert.deepEqual(stockScope(user("MANAGER", ["c1", "c2"]), "c2"), { organizationId: "o1", centerIds: ["c2"] });
  });

  it("un centre demandé hors périmètre, étranger ou inexistant est refusé, jamais ignoré", () => {
    const manager = user("MANAGER", ["c1"]);
    for (const bad of ["c2", "centre-d-une-autre-organisation", "", { $ne: "" }, 0]) {
      const error = failure(() => stockScope(manager, bad));
      assert.ok(error instanceof StockAccessError, JSON.stringify(bad));
      assert.equal((error as Error).message, MSG_STOCK_CENTER_NOT_FOUND);
    }
  });

  it("refuse les rôles sans droit", () => {
    for (const role of OTHERS) assert.ok(failure(() => stockScope(user(role, ["c1"]))) instanceof StockAccessError, role);
  });

  it("le filtre porte toujours l'organisation de l'acteur et la liste des centres ; un gérant sans centre n'obtient rien", () => {
    assert.deepEqual(stockFilter(stockScope(user("MANAGER", ["c2"]))), { organizationId: "o1", centerId: { $in: ["c2"] } });
    assert.deepEqual(stockFilter(stockScope(user("MANAGER", []))), { organizationId: "o1", centerId: { $in: [] } });
  });
});

describe("isInStockScope : contrôle d'un enregistrement chargé", () => {
  it("accepte un enregistrement de la même organisation dans le périmètre", () => {
    assert.equal(isInStockScope(user("MANAGER", ["c1"]), { organizationId: "o1", centerId: "c1" }), true);
    assert.equal(isInStockScope(user("OWNER", []), { organizationId: "o1", centerId: "c3" }), true);
  });

  it("refuse une autre organisation, même si l'identifiant du centre est connu de l'acteur", () => {
    assert.equal(isInStockScope(user("OWNER", []), { organizationId: "o2", centerId: "c1" }), false);
  });

  it("refuse un centre hors périmètre du gérant ou inexistant", () => {
    assert.equal(isInStockScope(user("MANAGER", ["c1"]), { organizationId: "o1", centerId: "c2" }), false);
    assert.equal(isInStockScope(user("OWNER", []), { organizationId: "o1", centerId: "inconnu" }), false);
  });

  it("compare des identifiants non-chaînes (ex. ObjectId) par leur représentation texte", () => {
    const objectIdLike = (value: string) => ({ toString: () => value });
    assert.equal(isInStockScope(user("MANAGER", ["c1"]), { organizationId: objectIdLike("o1"), centerId: objectIdLike("c1") }), true);
    assert.equal(isInStockScope(user("MANAGER", ["c1"]), { organizationId: objectIdLike("o2"), centerId: objectIdLike("c1") }), false);
  });

  it("refuse STAFF, CLIENT, SUPER_ADMIN et l'absence d'organisation", () => {
    for (const role of OTHERS) assert.equal(isInStockScope(user(role, ["c1"]), { organizationId: "o1", centerId: "c1" }), false, role);
    assert.equal(isInStockScope(user("OWNER", [], false), { organizationId: "o1", centerId: "c1" }), false);
  });
});
