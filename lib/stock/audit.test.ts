// Module 5 (étape 4) — Détails du journal de sécurité : identifiants et quantités uniquement. Test pur, sans base.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { equipmentAuditDetail, levelAuditDetail, maintenanceAuditDetail, movementAuditDetail, orderAuditDetail, orderStatusAuditDetail, productAuditDetail, receiptAuditDetail, recipeAuditDetail, scheduleAuditDetail, supplierAuditDetail } from "./audit";

const product = "665f1c2e8b3a4d0012ab34cd";
const center = "665f1c2e8b3a4d0012ab34ce";

describe("détails d'audit du stock", () => {
  it("décrivent l'objet concerné sans donnée saisie", () => {
    assert.equal(productAuditDetail(product), `product:${product}`);
    assert.equal(levelAuditDetail({ productId: product, centerId: center, action: "activate" }), `product:${product} center:${center} activate`);
    assert.equal(movementAuditDetail({ productId: product, centerId: center, kind: "OUT", delta: -20, seq: 3 }), `product:${product} center:${center} OUT -20 #3`);
    assert.equal(movementAuditDetail({ productId: product, centerId: center, kind: "IN", delta: 5, seq: 4 }), `product:${product} center:${center} IN +5 #4`);
  });

  it("restent sous la limite de 200 caractères du journal (logEvent tronque au-delà)", () => {
    const longest = movementAuditDetail({ productId: product, centerId: center, kind: "ADJUSTMENT", delta: -1_000_000_000, seq: 999_999_999 });
    assert.ok(longest.length <= 200, String(longest.length));
  });

  it("n'acceptent aucune note : la signature ne le permet pas", () => {
    assert.equal(movementAuditDetail.length, 1);
    assert.doesNotMatch(movementAuditDetail.toString(), /note/);
  });
});

describe("détail d'audit de la réception d'une commande", () => {
  const order = { id: "665f1c2e8b3a4d0012ab34cf", centerId: center, lines: [{}, {}] };
  it("décrit la commande, le centre, le nombre de lignes et de mouvements créés par cet appel", () => {
    assert.equal(receiptAuditDetail({ alreadyReceived: false, recorded: 2, order }), `order:${order.id} center:${center} lines:2 recorded:2`);
  });
  it("une reprise qui ne crée aucun mouvement mais termine la commande est journalisée", () => {
    assert.equal(receiptAuditDetail({ alreadyReceived: false, recorded: 0, order }), `order:${order.id} center:${center} lines:2 recorded:0`);
  });
  it("une commande déjà reçue ne produit aucun événement", () => {
    assert.equal(receiptAuditDetail({ alreadyReceived: true, recorded: 0, order }), null);
  });
  it("ne contient que des identifiants et des nombres", () => {
    assert.match(receiptAuditDetail({ alreadyReceived: false, recorded: 1, order })!, /^order:[0-9a-f]{24} center:[0-9a-f]{24} lines:\d+ recorded:\d+$/);
  });
});

describe("détails d'audit du matériel et de la maintenance", () => {
  const equipment = "665f1c2e8b3a4d0012ab34d0";
  it("décrivent l'équipement, le centre et les dates, jamais de saisie libre", () => {
    assert.equal(equipmentAuditDetail({ equipmentId: equipment, centerId: center }), `equipment:${equipment} center:${center}`);
    assert.equal(scheduleAuditDetail({ equipmentId: equipment, centerId: center, nextMaintenanceAt: "2030-06-01" }), `equipment:${equipment} center:${center} next:2030-06-01`);
    assert.equal(scheduleAuditDetail({ equipmentId: equipment, centerId: center, nextMaintenanceAt: null }), `equipment:${equipment} center:${center} next:none`);
    assert.equal(
      maintenanceAuditDetail({ equipmentId: equipment, centerId: center, performedAt: "2030-03-10", nextDueAt: "2030-09-10" }),
      `equipment:${equipment} center:${center} performed:2030-03-10 next:2030-09-10`,
    );
    assert.equal(maintenanceAuditDetail({ equipmentId: equipment, centerId: center, performedAt: "2030-03-10", nextDueAt: null }), `equipment:${equipment} center:${center} performed:2030-03-10 next:none`);
  });
  it("les signatures n'acceptent ni note ni nom", () => {
    for (const fn of [equipmentAuditDetail, scheduleAuditDetail, maintenanceAuditDetail]) {
      assert.equal(fn.length, 1);
      assert.doesNotMatch(fn.toString(), /note|name|category/);
    }
  });
});

describe("détails d'audit des fournisseurs et des commandes d'achat", () => {
  const supplier = "665f1c2e8b3a4d0012ab34d1";
  const order = "665f1c2e8b3a4d0012ab34d2";
  it("décrivent des identifiants, un nombre de lignes et un statut", () => {
    assert.equal(supplierAuditDetail({ supplierId: supplier }), `supplier:${supplier}`);
    assert.equal(orderAuditDetail({ orderId: order, centerId: center, supplierId: supplier, lines: 3 }), `order:${order} center:${center} supplier:${supplier} lines:3`);
    assert.equal(orderStatusAuditDetail({ orderId: order, centerId: center, status: "ORDERED" }), `order:${order} center:${center} status:ORDERED`);
  });
  it("restent sous 200 caractères et ne prennent aucune saisie libre", () => {
    assert.ok(orderAuditDetail({ orderId: order, centerId: center, supplierId: supplier, lines: 50 }).length <= 200);
    for (const fn of [supplierAuditDetail, orderAuditDetail, orderStatusAuditDetail]) {
      assert.equal(fn.length, 1);
      assert.doesNotMatch(fn.toString(), /name|phone|email|note/i);
    }
  });
});

describe("détail d'audit des recettes de service", () => {
  const service = "665f1c2e8b3a4d0012ab34d3";
  const product = "665f1c2e8b3a4d0012ab34d4";
  it("décrit des identifiants et des quantités, avec l'ancienne quantité en cas de modification", () => {
    assert.equal(recipeAuditDetail({ serviceId: service, productId: product, quantity: 30 }), `service:${service} product:${product} qty:30`);
    assert.equal(recipeAuditDetail({ serviceId: service, productId: product, quantity: 55, previousQuantity: 40 }), `service:${service} product:${product} qty:40->55`);
  });
  it("ne prend aucune saisie libre", () => {
    assert.equal(recipeAuditDetail.length, 1);
    assert.doesNotMatch(recipeAuditDetail.toString(), /name|note|unit/i);
  });
});
