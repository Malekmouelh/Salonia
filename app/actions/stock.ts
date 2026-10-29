"use server";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { requireRole } from "@/lib/dal";
import {
  equipmentAuditDetail,
  levelAuditDetail,
  maintenanceAuditDetail,
  movementAuditDetail,
  orderAuditDetail,
  orderStatusAuditDetail,
  productAuditDetail,
  receiptAuditDetail,
  recipeAuditDetail,
  scheduleAuditDetail,
  supplierAuditDetail,
  transferAuditDetail,
} from "@/lib/stock/audit";
import {
  archiveEquipment,
  createEquipment,
  listEquipment,
  listMaintenanceHistory,
  listMaintenanceSchedule,
  recordMaintenance,
  updateEquipment,
  type EquipmentView,
  type MaintenanceRecordView,
} from "@/lib/stock/equipment";
import {
  activateProductInCenter,
  archiveProduct,
  createProduct,
  listProducts,
  listStockLevels,
  recordStockMovement,
  rawField,
  repairStockLevels,
  updateAlertThreshold,
  updateProduct,
  type ActivationResult,
  type MovementResult,
  type StockLevelRow,
  type StockResult,
} from "@/lib/stock/service";
import type { RepairStatus } from "@/lib/stock/ledger";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  placePurchaseOrder,
  updateDraftPurchaseOrder,
  type PurchaseOrderView,
} from "@/lib/stock/purchase-orders";
import { listStockMovements, type MovementHistory } from "@/lib/stock/movements";
import { receivePurchaseOrder, type ReceiveResult } from "@/lib/stock/receipts";
import { addRecipeLine, listServiceRecipe, removeRecipeLine, updateRecipeLine, type RecipeLineView } from "@/lib/stock/recipes";
import { archiveSupplier, createSupplier, listSuppliers, updateSupplier, type SupplierView } from "@/lib/stock/suppliers";
import { listTransfers, resumeTransfer, transferEquipment, transferProduct, type TransferHistory, type TransferResult } from "@/lib/stock/transfers";

// Module 5 — Server Actions du stock. Les droits, le périmètre des centres et la validation sont dans lib/stock/service.ts
// (frontière de sécurité métier) ; l'action authentifie, appelle le service, journalise et renvoie un résultat.
//
// INVALIDATION : chaque action d'écriture invalide les pages du Module 5 qui affichent ses données (revalidatePath, comme team.ts et
// catalog.ts), uniquement après un changement réel. Aucun updateTag : la vitrine publique n'affiche pas le stock. La correspondance
// action → chemins est vérifiée par lib/stock/actions-guard.test.ts.
//
// Seuls les refus attendus (droits, règles métier, validation) sont renvoyés au client. Toute autre erreur est journalisée
// sur la console du serveur et remplacée par un message générique : ni trace ni détail de base de données ne sort.

const MSG_NO_ORGANIZATION = "Organisation introuvable.";
const MSG_UNEXPECTED = "Une erreur est survenue. Réessayez.";

async function run<T>(call: () => Promise<StockResult<T>>): Promise<StockResult<T>> {
  try {
    return await call();
  } catch (error) {
    console.error("Action de stock en échec :", error);
    return { ok: false, message: MSG_UNEXPECTED };
  }
}

type WithMessage<T> = StockResult<T> & { message?: string };
type Product = { id: string; name: string; unit: "PIECE" | "ML" | "G"; active: boolean };
type LevelView = { productId: string; centerId: string; alertThreshold: number; quantity: number; seq: number };

// ── Définitions de produits : propriétaire seulement ──

export async function createStockProductAction(raw: unknown): Promise<WithMessage<{ product: Product }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => createProduct(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_PRODUCT_CREATED", { userId: user.id, organizationId: user.organization.id, detail: productAuditDetail(result.product.id) });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/recettes");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Produit créé." };
}

export async function updateStockProductAction(raw: unknown): Promise<WithMessage<{ product: Product }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateProduct(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_PRODUCT_UPDATED", { userId: user.id, organizationId: user.organization.id, detail: productAuditDetail(result.product.id) });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/recettes");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Produit modifié." };
}

export async function archiveStockProductAction(raw: unknown): Promise<WithMessage<{ product: Product }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => archiveProduct(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_PRODUCT_ARCHIVED", { userId: user.id, organizationId: user.organization.id, detail: productAuditDetail(result.product.id) });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/recettes");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Produit archivé." };
}

// Lecture des définitions (propriétaire et gérant : un gérant choisit le produit à activer dans son centre). Ni audit ni invalidation.
export async function listStockProductsAction(): Promise<StockResult<{ products: Product[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listProducts(user));
}

// ── Niveaux par centre : propriétaire, et gérant dans ses centres ──

// Rejouer l'activation d'un niveau existant ne crédite rien : sans changement réel, aucun événement d'audit.
export async function activateStockProductAction(raw: unknown): Promise<WithMessage<ActivationResult>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => activateProductInCenter(user, raw));
  if (!result.ok) return result;
  if (!result.levelCreated && result.initialStock !== "RECORDED") {
    return { ...result, message: "Ce produit était déjà activé : le stock initial n'a pas été modifié." };
  }

  await logEvent("STOCK_LEVEL_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: levelAuditDetail({ productId: result.level.productId, centerId: result.level.centerId, action: "activate" }),
  });
  revalidatePath("/dashboard/stock");
  return { ...result, message: "Produit activé dans le centre." };
}

export async function updateStockThresholdAction(raw: unknown): Promise<WithMessage<{ level: LevelView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateAlertThreshold(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_LEVEL_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: levelAuditDetail({ productId: result.level.productId, centerId: result.level.centerId, action: "threshold" }),
  });
  revalidatePath("/dashboard/stock");
  return { ...result, message: "Seuil d'alerte modifié." };
}

// Entrée, sortie ou correction manuelle. Le détail d'audit ne contient jamais la note saisie.
export async function recordStockMovementAction(raw: unknown): Promise<WithMessage<MovementResult>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => recordStockMovement(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_MOVEMENT_RECORDED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: movementAuditDetail({ productId: result.productId, centerId: result.centerId, kind: result.movement.kind, delta: result.movement.delta, seq: result.movement.seq }),
  });
  revalidatePath("/dashboard/stock");
  return { ...result, message: result.projectionPending ? "Mouvement enregistré ; le niveau sera réaligné à la prochaine lecture." : "Mouvement enregistré." };
}

// Lecture : ni audit ni invalidation. Le centre demandé (facultatif) est validé par le service.
export async function listStockLevelsAction(centerId?: unknown): Promise<StockResult<{ levels: StockLevelRow[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listStockLevels(user, centerId));
}

// Historique des mouvements d'un produit dans un centre autorisé, du plus récent au plus ancien, paginé par rang (`before`) et borné.
// Lecture seule : ni audit ni invalidation. Le centre est validé par le service (même message pour tout centre inaccessible).
export async function listStockMovementsAction(raw: unknown): Promise<StockResult<MovementHistory>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listStockMovements(user, raw));
}

// Réalignement de la projection sur le journal (aucun mouvement créé) : pas d'événement d'audit, comme prévu au schéma.
export async function repairStockLevelsAction(items: unknown): Promise<WithMessage<{ repaired: { productId: string; centerId: string; status: RepairStatus }[]; skipped: number }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => repairStockLevels(user, items));
  if (!result.ok) return result;
  const repaired = result.repaired.some((r) => r.status === "REPAIRED");
  revalidatePath("/dashboard/stock");
  return { ...result, message: repaired ? "Niveaux réalignés." : "Aucune réparation nécessaire." };
}

// ── Réception d'une commande d'achat : propriétaire, et gérant dans ses centres ──

// Droits, périmètre, cohérence de la commande, idempotence et reprise : voir lib/stock/receipts.ts. Rappeler cette action après
// une interruption est sans danger (aucun double crédit). Un événement d'audit n'est écrit que lorsque l'appel a fait avancer
// la commande ; une commande déjà reçue renvoie un succès sans audit. Les crédits eux-mêmes sont tracés par les mouvements RECEIPT.
export async function receiveStockPurchaseOrderAction(raw: unknown): Promise<WithMessage<ReceiveResult>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => receivePurchaseOrder(user, raw));
  if (!result.ok) return result;

  const detail = receiptAuditDetail(result);
  if (detail === null) return { ...result, message: "Cette commande était déjà reçue." };

  await logEvent("STOCK_ORDER_RECEIVED", { userId: user.id, organizationId: user.organization.id, detail });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Commande reçue." };
}

// ── Matériel (F5.1) et maintenance (F5.4) : propriétaire, et gérant dans ses centres ──
// Droits, périmètre des centres, validation et historique ajouté-seulement : voir lib/stock/equipment.ts. Un équipement hors
// périmètre, d'une autre organisation ou inexistant reçoit toujours « Équipement introuvable. ». Les détails d'audit ne contiennent
// que des identifiants et des dates : jamais le nom, la catégorie ni la note d'intervention. Sans changement réel, ni audit ni écriture.

export async function createEquipmentAction(raw: unknown): Promise<WithMessage<{ equipment: EquipmentView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => createEquipment(user, raw));
  if (!result.ok) return result;

  await logEvent("EQUIPMENT_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: equipmentAuditDetail({ equipmentId: result.equipment.id, centerId: result.equipment.centerId }),
  });
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Équipement créé." };
}

export async function updateEquipmentAction(raw: unknown): Promise<WithMessage<{ equipment: EquipmentView; changed: boolean }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateEquipment(user, raw));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("EQUIPMENT_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: equipmentAuditDetail({ equipmentId: result.equipment.id, centerId: result.equipment.centerId }),
  });
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Équipement modifié." };
}

// Archivage : l'historique de maintenance est conservé. Rejoué sur un équipement déjà archivé : succès sans audit.
export async function archiveEquipmentAction(raw: unknown): Promise<WithMessage<{ equipment: EquipmentView; changed: boolean }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => archiveEquipment(user, raw));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Équipement archivé." };

  await logEvent("EQUIPMENT_ARCHIVED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: equipmentAuditDetail({ equipmentId: result.equipment.id, centerId: result.equipment.centerId }),
  });
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Équipement archivé." };
}

// Programme (ou efface avec null) la prochaine maintenance d'un équipement. Seuls l'identifiant et la date sont transmis au
// service : aucun autre champ de la fiche ne peut être modifié par cette action.
export async function scheduleMaintenanceAction(raw: unknown): Promise<WithMessage<{ equipment: EquipmentView; changed: boolean }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateEquipment(user, { equipmentId: rawField(raw, "equipmentId"), nextMaintenanceAt: rawField(raw, "nextMaintenanceAt") }));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("MAINTENANCE_SCHEDULED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: scheduleAuditDetail({ equipmentId: result.equipment.id, centerId: result.equipment.centerId, nextMaintenanceAt: result.equipment.nextMaintenanceAt }),
  });
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Maintenance programmée." };
}

// Enregistre une intervention (historique ajouté-seulement) ; la prochaine échéance de la fiche est mise à jour par le service.
export async function recordMaintenanceAction(raw: unknown): Promise<WithMessage<{ record: MaintenanceRecordView; equipment: EquipmentView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => recordMaintenance(user, raw));
  if (!result.ok) return result;

  await logEvent("MAINTENANCE_RECORDED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: maintenanceAuditDetail({ equipmentId: result.record.equipmentId, centerId: result.equipment.centerId, performedAt: result.record.performedAt, nextDueAt: result.record.nextDueAt }),
  });
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Intervention enregistrée." };
}

// Lectures : ni audit ni invalidation. Le centre demandé (facultatif) est validé par le service ; includeArchived n'est vrai que pour `true`.
export async function listEquipmentAction(centerId?: unknown, includeArchived?: unknown): Promise<StockResult<{ equipment: EquipmentView[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listEquipment(user, centerId, includeArchived === true));
}

export async function listMaintenanceScheduleAction(centerId?: unknown): Promise<StockResult<{ schedule: EquipmentView[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listMaintenanceSchedule(user, centerId));
}

export async function listMaintenanceHistoryAction(raw: unknown): Promise<StockResult<{ history: MaintenanceRecordView[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listMaintenanceHistory(user, raw));
}

// ── Fournisseurs (F5.5) : écriture réservée au propriétaire, lecture pour le gérant ──
// Droits et validation : voir lib/stock/suppliers.ts. Le détail d'audit ne contient que l'identifiant du fournisseur : jamais son nom,
// son téléphone ni son e-mail. Sans changement réel, ni écriture ni audit.

export async function createSupplierAction(raw: unknown): Promise<WithMessage<{ supplier: SupplierView }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => createSupplier(user, raw));
  if (!result.ok) return result;

  await logEvent("SUPPLIER_CREATED", { userId: user.id, organizationId: user.organization.id, detail: supplierAuditDetail({ supplierId: result.supplier.id }) });
  revalidatePath("/dashboard/stock/fournisseurs");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Fournisseur créé." };
}

export async function updateSupplierAction(raw: unknown): Promise<WithMessage<{ supplier: SupplierView; changed: boolean }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateSupplier(user, raw));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("SUPPLIER_UPDATED", { userId: user.id, organizationId: user.organization.id, detail: supplierAuditDetail({ supplierId: result.supplier.id }) });
  revalidatePath("/dashboard/stock/fournisseurs");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Fournisseur modifié." };
}

// Les commandes existantes gardent la référence et le nom du fournisseur archivé. Rejoué sur un fournisseur déjà archivé : succès sans audit.
export async function archiveSupplierAction(raw: unknown): Promise<WithMessage<{ supplier: SupplierView; changed: boolean }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => archiveSupplier(user, raw));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Fournisseur archivé." };

  await logEvent("SUPPLIER_ARCHIVED", { userId: user.id, organizationId: user.organization.id, detail: supplierAuditDetail({ supplierId: result.supplier.id }) });
  revalidatePath("/dashboard/stock/fournisseurs");
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Fournisseur archivé." };
}

// Lecture : propriétaire et gérant (un gérant choisit un fournisseur pour une commande de son centre). includeArchived n'est vrai que pour `true`.
export async function listSuppliersAction(includeArchived?: unknown): Promise<StockResult<{ suppliers: SupplierView[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listSuppliers(user, includeArchived === true));
}

// ── Commandes d'achat (F5.5) : propriétaire, et gérant dans ses centres ──
// Transitions de statut, périmètre de centres et validation des lignes : voir lib/stock/purchase-orders.ts. La RÉCEPTION n'est pas
// ici : receiveStockPurchaseOrderAction est le seul point d'entrée serveur qui reçoit une commande. Aucune de ces actions ne modifie le stock.

export async function createPurchaseOrderAction(raw: unknown): Promise<WithMessage<{ order: PurchaseOrderView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => createPurchaseOrder(user, raw));
  if (!result.ok) return result;

  await logEvent("PURCHASE_ORDER_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: orderAuditDetail({ orderId: result.order.id, centerId: result.order.centerId, supplierId: result.order.supplierId, lines: result.order.lines.length }),
  });
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Commande créée." };
}

export async function updateDraftPurchaseOrderAction(raw: unknown): Promise<WithMessage<{ order: PurchaseOrderView; changed: boolean }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateDraftPurchaseOrder(user, raw));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("PURCHASE_ORDER_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: orderAuditDetail({ orderId: result.order.id, centerId: result.order.centerId, supplierId: result.order.supplierId, lines: result.order.lines.length }),
  });
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Brouillon modifié." };
}

export async function placePurchaseOrderAction(raw: unknown): Promise<WithMessage<{ order: PurchaseOrderView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => placePurchaseOrder(user, raw));
  if (!result.ok) return result;

  await logEvent("PURCHASE_ORDER_PLACED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: orderStatusAuditDetail({ orderId: result.order.id, centerId: result.order.centerId, status: result.order.status }),
  });
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Commande passée." };
}

// Refusée par le service une fois la réception commencée, reçue ou déjà annulée : aucun audit dans ces cas.
export async function cancelPurchaseOrderAction(raw: unknown): Promise<WithMessage<{ order: PurchaseOrderView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => cancelPurchaseOrder(user, raw));
  if (!result.ok) return result;

  await logEvent("PURCHASE_ORDER_CANCELLED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: orderStatusAuditDetail({ orderId: result.order.id, centerId: result.order.centerId, status: result.order.status }),
  });
  revalidatePath("/dashboard/stock/commandes");
  return { ...result, message: "Commande annulée." };
}

// Lectures : ni audit ni invalidation.
export async function getPurchaseOrderAction(raw: unknown): Promise<StockResult<{ order: PurchaseOrderView }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => getPurchaseOrder(user, raw));
}

export async function listPurchaseOrdersAction(centerId?: unknown, filter?: unknown): Promise<StockResult<{ orders: PurchaseOrderView[] }>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listPurchaseOrders(user, centerId, filter));
}

// ── Recettes de consommation par service (F5.3) : propriétaire seulement ──
// Configuration seule : aucune de ces actions ne crée de mouvement de stock ni ne touche un rendez-vous. Droits, existence du service
// dans l'organisation, produit actif et quantité : voir lib/stock/recipes.ts. Le détail d'audit ne contient que des identifiants et des
// quantités ; sans changement réel, ni écriture ni audit.

export async function addRecipeLineAction(raw: unknown): Promise<WithMessage<{ line: RecipeLineView }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => addRecipeLine(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_RECIPE_ADDED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: recipeAuditDetail({ serviceId: result.line.serviceId, productId: result.line.productId, quantity: result.line.quantityPerService }),
  });
  revalidatePath("/dashboard/stock/recettes");
  return { ...result, message: "Ligne de recette ajoutée." };
}

export async function updateRecipeLineAction(raw: unknown): Promise<WithMessage<{ line: RecipeLineView; previousQuantity: number; changed: boolean }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => updateRecipeLine(user, raw));
  if (!result.ok) return result;
  if (!result.changed) return { ...result, message: "Aucune modification." };

  await logEvent("STOCK_RECIPE_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: recipeAuditDetail({ serviceId: result.line.serviceId, productId: result.line.productId, quantity: result.line.quantityPerService, previousQuantity: result.previousQuantity }),
  });
  revalidatePath("/dashboard/stock/recettes");
  return { ...result, message: "Ligne de recette modifiée." };
}

export async function removeRecipeLineAction(raw: unknown): Promise<WithMessage<{ serviceId: string; productId: string; removedQuantity: number }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => removeRecipeLine(user, raw));
  if (!result.ok) return result;

  await logEvent("STOCK_RECIPE_REMOVED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: recipeAuditDetail({ serviceId: result.serviceId, productId: result.productId, quantity: result.removedQuantity }),
  });
  revalidatePath("/dashboard/stock/recettes");
  return { ...result, message: "Ligne de recette supprimée." };
}

// Lecture : propriétaire seulement (comme l'écriture). Ni audit ni invalidation.
export async function listServiceRecipeAction(raw: unknown): Promise<StockResult<{ serviceId: string; serviceName: string; lines: RecipeLineView[] }>> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listServiceRecipe(user, raw));
}

// ── Transferts entre centres (F5.6) : propriétaire (tous les centres), gérant (source : ses centres ; destination : tout centre de l'organisation) ──
// Droits, centres, plafonnement au stock disponible, idempotence (requestId) et reprise : voir lib/stock/transfers.ts. Un événement d'audit n'est
// écrit que lorsque l'appel a fait avancer le transfert ; un transfert déjà terminé renvoie un succès sans audit. Les détails d'audit ne
// contiennent que des identifiants et la quantité. Les mouvements TRANSFER_OUT / TRANSFER_IN du journal sont la trace des quantités.

export async function transferStockProductAction(raw: unknown): Promise<WithMessage<TransferResult>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => transferProduct(user, raw));
  if (!result.ok) return result;
  if (!result.advanced) return { ...result, message: "Ce transfert avait déjà été effectué." };

  await logEvent("STOCK_TRANSFERRED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: transferAuditDetail({ transferId: result.transfer.id, fromCenterId: result.transfer.fromCenterId, toCenterId: result.transfer.toCenterId, productId: result.transfer.productId ?? undefined, quantity: result.transferred ?? 0 }),
  });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/commandes");
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: result.capped ? "Transfert effectué : la quantité a été plafonnée au stock disponible." : "Transfert effectué." };
}

export async function transferEquipmentAction(raw: unknown): Promise<WithMessage<TransferResult>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => transferEquipment(user, raw));
  if (!result.ok) return result;
  if (!result.advanced) return { ...result, message: "Ce transfert avait déjà été effectué." };

  await logEvent("EQUIPMENT_TRANSFERRED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: transferAuditDetail({ transferId: result.transfer.id, fromCenterId: result.transfer.fromCenterId, toCenterId: result.transfer.toCenterId, equipmentId: result.transfer.equipmentId ?? undefined }),
  });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/commandes");
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Transfert effectué." };
}

// Reprise d'un transfert resté incomplet : termine les étapes manquantes sans jamais sortir ni entrer deux fois la même quantité.
export async function resumeStockTransferAction(raw: unknown): Promise<WithMessage<TransferResult>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };

  const result = await run(() => resumeTransfer(user, raw));
  if (!result.ok) return result;
  if (!result.advanced) return { ...result, message: "Ce transfert avait déjà été effectué." };

  const detail = transferAuditDetail({
    transferId: result.transfer.id,
    fromCenterId: result.transfer.fromCenterId,
    toCenterId: result.transfer.toCenterId,
    productId: result.transfer.productId ?? undefined,
    equipmentId: result.transfer.equipmentId ?? undefined,
    quantity: result.transferred ?? 0,
  });
  if (result.transfer.kind === "PRODUCT") await logEvent("STOCK_TRANSFERRED", { userId: user.id, organizationId: user.organization.id, detail });
  else await logEvent("EQUIPMENT_TRANSFERRED", { userId: user.id, organizationId: user.organization.id, detail });
  revalidatePath("/dashboard/stock");
  revalidatePath("/dashboard/stock/commandes");
  revalidatePath("/dashboard/stock/materiel");
  return { ...result, message: "Transfert repris et terminé." };
}

// Historique des transferts des centres autorisés, paginé par curseur. Lecture seule : ni audit ni invalidation.
export async function listStockTransfersAction(raw?: unknown): Promise<StockResult<TransferHistory>> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION };
  return run(() => listTransfers(user, raw));
}
