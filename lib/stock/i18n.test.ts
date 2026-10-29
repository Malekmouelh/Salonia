// Module 5 (étape 4) — Chaque texte public du stock a sa traduction arabe (messages d'erreur du serveur compris).
// Test pur, sans base. Un message de validation Zod par défaut (anglais) serait aussi détecté ici.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AR } from "@/lib/i18n-ar";
import { MSG_INSUFFICIENT_STOCK, MSG_LEDGER_BUSY } from "./errors";
import { EQUIPMENT_STATUS_LABELS, MAINTENANCE_STATE_LABELS, PURCHASE_ORDER_STATUS_LABELS, STOCK_MOVEMENT_KIND_LABELS, STOCK_UNIT_LABELS } from "./labels";
import {
  ActivateProductSchema,
  CreateEquipmentSchema,
  CreateProductSchema,
  CreatePurchaseOrderSchema,
  CreateSupplierSchema,
  EquipmentIdSchema,
  MaintenanceHistorySchema,
  MaintenanceInputSchema,
  MovementInputSchema,
  OrderIdSchema,
  OrderListSchema,
  ProductIdSchema,
  SupplierIdSchema,
  UpdateEquipmentSchema,
  UpdateProductSchema,
  UpdatePurchaseOrderSchema,
  UpdateSupplierSchema,
  UpdateThresholdSchema,
} from "./schemas";
import { MSG_EQUIPMENT_ARCHIVED, MSG_EQUIPMENT_NOT_FOUND, MSG_MAINTENANCE_FUTURE } from "./equipment";
import { MSG_ORDER_NOT_CANCELLABLE, MSG_ORDER_NOT_EDITABLE, MSG_ORDER_NOT_FOUND, MSG_ORDER_NOT_ORDERABLE, MSG_ORDER_RECEIVING } from "./purchase-orders";
import { MSG_ORDER_INCONSISTENT, MSG_ORDER_NOT_RECEIVABLE, MSG_RECEIPT_INCOMPLETE, MSG_RECEIPT_NOT_PROJECTED, MSG_UNIT_CHANGED } from "./receipts";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN } from "./scope";
import { MSG_SUPPLIER_ARCHIVED, MSG_SUPPLIER_NAME_TAKEN, MSG_SUPPLIER_NOT_FOUND } from "./suppliers";
import { MSG_INVALID, MSG_NAME_TAKEN, MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, MSG_UNIT_LOCKED } from "./service";

const root = process.cwd();
const missing = (texts: Iterable<string>) => [...new Set(texts)].filter((t) => !(t in AR));

// Messages de validation réellement produits par les schémas sur des saisies fautives.
function schemaMessages() {
  const messages: string[] = [];
  const hex = "665f1c2e8b3a4d0012ab34cd";
  const bad: unknown[] = [undefined, null, "", "   ", 0, -1, 1.5, "5", {}, { $ne: "" }, [], true, "x".repeat(200)];
  const collect = (schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } }, input: unknown) => {
    const r = schema.safeParse(input);
    if (!r.success) messages.push(...r.error!.issues.map((i) => i.message));
  };
  for (const v of bad) {
    collect(CreateProductSchema, { name: v, unit: v });
    collect(UpdateProductSchema, { productId: v, name: v, unit: v });
    collect(ProductIdSchema, { productId: v });
    collect(ActivateProductSchema, { productId: v, alertThreshold: v, initialQuantity: v });
    collect(UpdateThresholdSchema, { productId: v, alertThreshold: v });
    for (const kind of ["IN", "OUT", "ADJUSTMENT", v]) collect(MovementInputSchema, { productId: v, kind, quantity: v, note: v });
  }
  collect(UpdateProductSchema, { productId: hex });
  collect(MovementInputSchema, { productId: hex, kind: "ADJUSTMENT", quantity: 0 });
  collect(MovementInputSchema, { productId: hex, kind: "IN", quantity: 0 });
  collect(MovementInputSchema, { productId: hex, kind: "IN", quantity: 2_000_000_000 });
  collect(MovementInputSchema, { productId: hex, kind: "IN", quantity: 1, note: "x".repeat(121) });
  return messages;
}

describe("traductions arabes du Module 5", () => {
  it("les messages du service, du périmètre et du registre sont traduits", () => {
    const messages = [MSG_STOCK_FORBIDDEN, MSG_STOCK_CENTER_NOT_FOUND, MSG_PRODUCT_NOT_FOUND, MSG_PRODUCT_ARCHIVED, MSG_NAME_TAKEN, MSG_NOT_ACTIVATED, MSG_UNIT_LOCKED, MSG_INVALID, MSG_INSUFFICIENT_STOCK, MSG_LEDGER_BUSY];
    assert.deepEqual(missing(messages), []);
  });

  it("tous les messages de validation produits par les schémas sont en français et traduits", () => {
    const messages = schemaMessages();
    assert.ok(messages.length > 10);
    assert.deepEqual(missing(messages), []);
  });

  it("les libellés d'états, d'unités et de mouvements sont traduits", () => {
    assert.deepEqual(missing([...Object.values(EQUIPMENT_STATUS_LABELS), ...Object.values(STOCK_UNIT_LABELS), ...Object.values(STOCK_MOVEMENT_KIND_LABELS)]), []);
  });

  it("les messages de réponse des actions et les libellés du journal de sécurité sont traduits", () => {
    const actions = readFileSync(join(root, "app/actions/stock.ts"), "utf8");
    // Toute phrase française terminée par un point dans le code (hors commentaires) : messages de réponse, constantes, ternaires.
    const code = actions.replace(/^\s*\/\/.*$/gm, "");
    const sentences = [...code.matchAll(/"([A-ZÀ-Ý][^"\n]*\.)"/g)].map((m) => m[1]);
    // Et tout littéral placé dans une expression « message: … » ou une constante MSG_… (même sans point final).
    const inMessages = [...code.matchAll(/(?:message: |MSG_\w+ = )([^\n}]*)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    const texts = [...new Set([...sentences, ...inMessages])];
    assert.ok(texts.length >= 10);
    const securityLog = readFileSync(join(root, "components/dashboard/security-log.tsx"), "utf8");
    const labels = [...securityLog.matchAll(/STOCK_\w+: \{ label: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labels.length, 10); // 6 (produits, niveaux, mouvements, réception) + 3 (recettes) + 1 (transfert de produit, F5.6)
    assert.deepEqual(missing([...texts, ...labels]), []);
  });

  it("aucune traduction du Module 5 n'est vide", () => {
    for (const key of ["Centre introuvable.", "Action non autorisée.", "Stock insuffisant pour cette sortie."]) assert.ok(AR[key]?.trim().length > 0, key);
  });
});

describe("traductions arabes : matériel, maintenance, fournisseurs, commandes (étape 5)", () => {
  it("les messages des services sont traduits", () => {
    const messages = [
      MSG_EQUIPMENT_NOT_FOUND, MSG_EQUIPMENT_ARCHIVED, MSG_MAINTENANCE_FUTURE,
      MSG_SUPPLIER_NOT_FOUND, MSG_SUPPLIER_ARCHIVED, MSG_SUPPLIER_NAME_TAKEN,
      MSG_ORDER_NOT_FOUND, MSG_ORDER_NOT_EDITABLE, MSG_ORDER_NOT_ORDERABLE, MSG_ORDER_NOT_CANCELLABLE, MSG_ORDER_RECEIVING,
      MSG_ORDER_INCONSISTENT, MSG_ORDER_NOT_RECEIVABLE, MSG_RECEIPT_INCOMPLETE, MSG_RECEIPT_NOT_PROJECTED, MSG_UNIT_CHANGED,
    ];
    assert.deepEqual(missing(messages), []);
  });

  it("tous les messages de validation des nouveaux schémas sont en français et traduits", () => {
    const messages: string[] = [];
    const hex = "665f1c2e8b3a4d0012ab34cd";
    const bad: unknown[] = [undefined, null, "", "   ", 0, -1, 1.5, 366, "5", {}, { $ne: "" }, [], true, "x".repeat(300), "2030-02-30", "pas-un-mail", "123"];
    const collect = (schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { message: string }[] } } }, input: unknown) => {
      const r = schema.safeParse(input);
      if (!r.success) messages.push(...r.error!.issues.map((i) => i.message));
    };
    for (const v of bad) {
      collect(CreateEquipmentSchema, { name: v, category: v, status: v, acquiredAt: v, nextMaintenanceAt: v });
      collect(UpdateEquipmentSchema, { equipmentId: v, name: v, category: v, status: v, acquiredAt: v, nextMaintenanceAt: v });
      collect(EquipmentIdSchema, { equipmentId: v });
      collect(MaintenanceInputSchema, { equipmentId: v, performedAt: v, note: v, nextDueAt: v });
      collect(MaintenanceHistorySchema, { equipmentId: v, limit: v });
      collect(CreateSupplierSchema, { name: v, phone: v, email: v, leadTimeDays: v });
      collect(UpdateSupplierSchema, { supplierId: v, name: v, phone: v, email: v, leadTimeDays: v });
      collect(SupplierIdSchema, { supplierId: v });
      collect(CreatePurchaseOrderSchema, { supplierId: v, lines: v });
      collect(CreatePurchaseOrderSchema, { supplierId: hex, lines: [{ productId: v, quantity: v }] });
      collect(UpdatePurchaseOrderSchema, { orderId: v, supplierId: v, lines: v });
      collect(OrderIdSchema, { orderId: v });
      collect(OrderListSchema, { status: v });
    }
    collect(MaintenanceInputSchema, { equipmentId: hex, performedAt: "2030-03-10", nextDueAt: "2030-03-09" });
    collect(UpdateEquipmentSchema, { equipmentId: hex });
    collect(CreatePurchaseOrderSchema, { supplierId: hex, lines: [{ productId: hex, quantity: 1 }, { productId: hex, quantity: 2 }] });
    collect(CreatePurchaseOrderSchema, { supplierId: hex, lines: Array.from({ length: 51 }, () => ({ productId: hex, quantity: 1 })) });
    assert.ok(messages.length > 20);
    assert.deepEqual(missing(messages), []);
  });

  it("les libellés d'états de commande et d'échéances sont traduits", () => {
    assert.deepEqual(missing([...Object.values(PURCHASE_ORDER_STATUS_LABELS), ...Object.values(MAINTENANCE_STATE_LABELS)]), []);
  });
});

describe("traductions arabes : actions du matériel et de la maintenance", () => {
  it("les libellés du journal de sécurité (équipement, maintenance) et les messages de réponse sont traduits", () => {
    const securityLog = readFileSync(join(root, "components/dashboard/security-log.tsx"), "utf8");
    const labels = [...securityLog.matchAll(/(?:EQUIPMENT|MAINTENANCE)_\w+: \{ label: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labels.length, 6); // + EQUIPMENT_TRANSFERRED (F5.6)
    const code = readFileSync(join(root, "app/actions/stock.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const messages = [...code.matchAll(/message: "([^"]+)"/g)].map((m) => m[1]);
    for (const expected of ["Équipement créé.", "Équipement modifié.", "Équipement archivé.", "Maintenance programmée.", "Intervention enregistrée.", "Aucune modification."]) {
      assert.ok(messages.includes(expected), expected);
    }
    assert.deepEqual(missing([...labels, ...messages]), []);
  });
});

describe("traductions arabes : actions des fournisseurs et des commandes d'achat", () => {
  it("les libellés du journal de sécurité et les messages de réponse sont traduits", () => {
    const securityLog = readFileSync(join(root, "components/dashboard/security-log.tsx"), "utf8");
    const labels = [...securityLog.matchAll(/(?:SUPPLIER|PURCHASE_ORDER)_\w+: \{ label: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labels.length, 7);
    const code = readFileSync(join(root, "app/actions/stock.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const messages = [...code.matchAll(/message: "([^"]+)"/g)].map((m) => m[1]);
    for (const expected of ["Fournisseur créé.", "Fournisseur modifié.", "Fournisseur archivé.", "Commande créée.", "Brouillon modifié.", "Commande passée.", "Commande annulée.", "Aucune modification."]) {
      assert.ok(messages.includes(expected), expected);
    }
    assert.deepEqual(missing([...labels, ...messages]), []);
  });
});

describe("traductions arabes : recettes de service", () => {
  it("les libellés du journal, les messages de réponse et les messages du service sont traduits", async () => {
    const securityLog = readFileSync(join(root, "components/dashboard/security-log.tsx"), "utf8");
    const labels = [...securityLog.matchAll(/STOCK_RECIPE_\w+: \{ label: "([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labels.length, 3);
    const code = readFileSync(join(root, "app/actions/stock.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const messages = [...code.matchAll(/message: "([^"]+)"/g)].map((m) => m[1]);
    for (const expected of ["Ligne de recette ajoutée.", "Ligne de recette modifiée.", "Ligne de recette supprimée."]) assert.ok(messages.includes(expected), expected);
    const { MSG_RECIPE_DUPLICATE, MSG_RECIPE_LINE_NOT_FOUND, MSG_SERVICE_NOT_FOUND } = await import("./recipes");
    assert.deepEqual(missing([...labels, ...messages, MSG_RECIPE_DUPLICATE, MSG_RECIPE_LINE_NOT_FOUND, MSG_SERVICE_NOT_FOUND]), []);
  });

  it("les messages de validation des schémas de recette sont en français et traduits", async () => {
    const { RecipeLineSchema, RecipeLineKeySchema, RecipeServiceSchema } = await import("./schemas");
    const messages: string[] = [];
    const bad: unknown[] = [undefined, null, "", 0, -1, 1.5, "5", {}, { $ne: "" }, [], true, 2_000_000_000, "x".repeat(40)];
    for (const v of bad) {
      for (const schema of [RecipeLineSchema, RecipeLineKeySchema, RecipeServiceSchema]) {
        const r = schema.safeParse({ serviceId: v, productId: v, quantityPerService: v });
        if (!r.success) messages.push(...r.error.issues.map((i) => i.message));
      }
    }
    assert.ok(messages.length > 5);
    assert.deepEqual(missing(messages), []);
  });
});

describe("traductions arabes : historique des mouvements", () => {
  it("les messages de validation du schéma d'historique sont en français et traduits", async () => {
    const { MovementHistorySchema } = await import("./schemas");
    const messages: string[] = [];
    const bad: unknown[] = [undefined, null, "", 0, -1, 1.5, "5", {}, { $ne: "" }, [], true, 101, Number.NaN];
    for (const v of bad) {
      const r = MovementHistorySchema.safeParse({ productId: v, limit: v, before: v });
      if (!r.success) messages.push(...r.error.issues.map((i) => i.message));
    }
    assert.ok(messages.length > 3);
    assert.deepEqual(missing(messages), []);
  });
});
