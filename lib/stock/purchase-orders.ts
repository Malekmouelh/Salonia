import { connectDB } from "@/lib/db";
import type { PurchaseOrderStatus, StockUnit } from "@/lib/enums";
import { PurchaseOrder, StockLevel, StockProduct, Supplier } from "@/lib/models/stock";
import { CAN_CANCEL_FROM, CAN_ORDER_FROM } from "./orders";
import {
  CreatePurchaseOrderSchema,
  OrderIdSchema,
  OrderListSchema,
  UpdatePurchaseOrderSchema,
} from "./schemas";
import { MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, guard, invalid, rawField, type StockActor, type StockResult } from "./service";
import { requireStockCenter, stockFilter, stockScope } from "./scope";
import { MSG_SUPPLIER_ARCHIVED, MSG_SUPPLIER_NOT_FOUND } from "./suppliers";

// Module 5 (étape 5) — Commandes d'achat (F5.5). OWNER (tous les centres) et MANAGER (ses centres).
// Créer, modifier, passer ou annuler une commande ne modifie JAMAIS le stock : seule la réception (lib/stock/receipts.ts) le fait.
// Le nom du produit, son unité et le nom du fournisseur sont recopiés depuis la base, jamais lus dans la saisie.
// Chaque transition est une mise à jour atomique conditionnelle sur le statut d'origine : deux demandes simultanées
// ne peuvent pas produire un état invalide.

export const MSG_ORDER_NOT_FOUND = "Commande introuvable.";
export const MSG_ORDER_NOT_EDITABLE = "Cette commande n'est plus modifiable.";
export const MSG_ORDER_NOT_ORDERABLE = "Seul un brouillon peut être passé en commande.";
export const MSG_ORDER_NOT_CANCELLABLE = "Cette commande ne peut plus être annulée.";
export const MSG_ORDER_RECEIVING = "Cette commande est en cours de réception : elle ne peut plus être annulée.";

export type PurchaseOrderLineView = { productId: string; productName: string; unit: StockUnit; quantity: number };
export type PurchaseOrderView = {
  id: string;
  centerId: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLineView[];
  orderedAt: string | null;
  cancelledAt: string | null;
  receivedAt: string | null;
  // true quand la réception a commencé sans être terminée : l'annulation n'est plus possible, la réception se reprend.
  receiving: boolean;
  createdAt: string;
};

type OrderDoc = {
  _id: unknown;
  centerId: unknown;
  supplierId: unknown;
  supplierName: string;
  status: string;
  lines: { productId: unknown; productName: string; unit: string; quantity: number }[];
  orderedAt?: Date | null;
  cancelledAt?: Date | null;
  receivedAt?: Date | null;
  receiptStartedAt?: Date | null;
  createdAt?: Date;
};
export const orderView = (o: OrderDoc): PurchaseOrderView => ({
  id: String(o._id),
  centerId: String(o.centerId),
  supplierId: String(o.supplierId),
  supplierName: o.supplierName,
  status: o.status as PurchaseOrderStatus,
  lines: o.lines.map((l) => ({ productId: String(l.productId), productName: l.productName, unit: l.unit as StockUnit, quantity: l.quantity })),
  orderedAt: o.orderedAt?.toISOString() ?? null,
  cancelledAt: o.cancelledAt?.toISOString() ?? null,
  receivedAt: o.receivedAt?.toISOString() ?? null,
  receiving: o.status === "ORDERED" && !!o.receiptStartedAt,
  createdAt: (o.createdAt ?? new Date(0)).toISOString(),
});

type Refusal = { ok: false; message: string };
type Line = { productId: string; quantity: number };

// Valide les lignes côté serveur : produits de l'organisation, actifs, déjà activés dans le centre de livraison.
// Renvoie les lignes avec nom et unité lus en base.
async function resolveLines(organizationId: string, centerId: string, lines: Line[]): Promise<Refusal | { lines: PurchaseOrderLineView[] }> {
  const ids = lines.map((l) => l.productId);
  const products = await StockProduct.find({ organizationId, _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  if (ids.some((id) => !byId.has(id.toLowerCase()))) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
  if (products.some((p) => !p.active)) return { ok: false, message: MSG_PRODUCT_ARCHIVED };
  // Une commande livrée dans un centre où le produit n'a pas de niveau ne pourrait jamais être reçue.
  const levels = await StockLevel.find({ organizationId, centerId, productId: { $in: ids } }).select("productId").lean();
  if (levels.length !== new Set(ids.map((i) => i.toLowerCase())).size) return { ok: false, message: MSG_NOT_ACTIVATED };
  return {
    lines: lines.map((l) => {
      const p = byId.get(l.productId.toLowerCase())!;
      return { productId: String(p._id), productName: p.name, unit: p.unit as StockUnit, quantity: l.quantity };
    }),
  };
}

async function activeSupplier(organizationId: string, supplierId: string): Promise<Refusal | { name: string; id: string }> {
  const supplier = await Supplier.findOne({ _id: supplierId, organizationId }).lean();
  if (!supplier) return { ok: false, message: MSG_SUPPLIER_NOT_FOUND };
  if (!supplier.active) return { ok: false, message: MSG_SUPPLIER_ARCHIVED };
  return { name: supplier.name, id: String(supplier._id) };
}

export function createPurchaseOrder(actor: StockActor, input: unknown): Promise<StockResult<{ order: PurchaseOrderView }>> {
  return guard(async () => {
    const { organizationId, centerId } = requireStockCenter(actor, rawField(input, "centerId"));
    const parsed = CreatePurchaseOrderSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const supplier = await activeSupplier(organizationId, parsed.data.supplierId);
    if ("ok" in supplier) return supplier;
    const resolved = await resolveLines(organizationId, centerId, parsed.data.lines);
    if ("ok" in resolved) return resolved;

    const order = await PurchaseOrder.create({ organizationId, centerId, supplierId: supplier.id, supplierName: supplier.name, status: "DRAFT", lines: resolved.lines, createdBy: actor.id });
    return { ok: true, order: orderView(order) };
  });
}

// Modifie le fournisseur et/ou les lignes d'un BROUILLON seulement. Le centre de livraison ne change pas.
// `changed` est faux si le fournisseur et les lignes demandés sont ceux déjà enregistrés (aucune écriture, aucun audit côté action).
export function updateDraftPurchaseOrder(actor: StockActor, input: unknown): Promise<StockResult<{ order: PurchaseOrderView; changed: boolean }>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = UpdatePurchaseOrderSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const order = await PurchaseOrder.findOne({ _id: parsed.data.orderId, ...stockFilter(scope) }).lean();
    if (!order) return { ok: false, message: MSG_ORDER_NOT_FOUND };
    if (order.status !== "DRAFT") return { ok: false, message: MSG_ORDER_NOT_EDITABLE };

    const set: Record<string, unknown> = {};
    if (parsed.data.supplierId) {
      const supplier = await activeSupplier(scope.organizationId, parsed.data.supplierId);
      if ("ok" in supplier) return supplier;
      set.supplierId = supplier.id;
      set.supplierName = supplier.name;
    }
    if (parsed.data.lines) {
      const resolved = await resolveLines(scope.organizationId, String(order.centerId), parsed.data.lines);
      if ("ok" in resolved) return resolved;
      set.lines = resolved.lines;
    }
    const sameSupplier = set.supplierId === undefined || String(order.supplierId) === set.supplierId;
    const newLines = set.lines as PurchaseOrderLineView[] | undefined;
    const sameLines =
      newLines === undefined ||
      (newLines.length === order.lines.length &&
        newLines.every((l, i) => {
          const old = order.lines[i];
          return String(old.productId) === l.productId && old.quantity === l.quantity && old.productName === l.productName && old.unit === l.unit;
        }));
    if (sameSupplier && sameLines) return { ok: true, order: orderView(order), changed: false };

    // Atomique : refusé si la commande a quitté l'état brouillon entre-temps (passée ou annulée par une autre requête).
    const updated = await PurchaseOrder.findOneAndUpdate({ _id: order._id, ...stockFilter(scope), status: "DRAFT" }, { $set: set }, { returnDocument: "after", runValidators: true }).lean();
    if (!updated) return { ok: false, message: MSG_ORDER_NOT_EDITABLE };
    return { ok: true, order: orderView(updated), changed: true };
  });
}

// DRAFT → ORDERED. Le fournisseur doit être encore actif. Aucun effet sur le stock.
export function placePurchaseOrder(actor: StockActor, input: unknown): Promise<StockResult<{ order: PurchaseOrderView }>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = OrderIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const order = await PurchaseOrder.findOne({ _id: parsed.data.orderId, ...stockFilter(scope) }).lean();
    if (!order) return { ok: false, message: MSG_ORDER_NOT_FOUND };
    if (!CAN_ORDER_FROM.includes(order.status as PurchaseOrderStatus)) return { ok: false, message: MSG_ORDER_NOT_ORDERABLE };
    const supplier = await activeSupplier(scope.organizationId, String(order.supplierId));
    if ("ok" in supplier) return supplier;

    const updated = await PurchaseOrder.findOneAndUpdate(
      { _id: order._id, ...stockFilter(scope), status: { $in: CAN_ORDER_FROM } },
      { $set: { status: "ORDERED", orderedAt: new Date() } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!updated) return { ok: false, message: MSG_ORDER_NOT_ORDERABLE };
    return { ok: true, order: orderView(updated) };
  });
}

// DRAFT | ORDERED → CANCELLED. Une commande annulée n'est pas supprimée. Aucun effet sur le stock.
export function cancelPurchaseOrder(actor: StockActor, input: unknown): Promise<StockResult<{ order: PurchaseOrderView }>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = OrderIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const order = await PurchaseOrder.findOne({ _id: parsed.data.orderId, ...stockFilter(scope) }).lean();
    if (!order) return { ok: false, message: MSG_ORDER_NOT_FOUND };
    if (!CAN_CANCEL_FROM.includes(order.status as PurchaseOrderStatus)) return { ok: false, message: MSG_ORDER_NOT_CANCELLABLE };
    // Dès que la réception a commencé, des mouvements de stock peuvent exister : on ne l'annule plus, on la reprend jusqu'au bout.
    if (order.receiptStartedAt) return { ok: false, message: MSG_ORDER_RECEIVING };

    const updated = await PurchaseOrder.findOneAndUpdate(
      { _id: order._id, ...stockFilter(scope), status: { $in: CAN_CANCEL_FROM }, receiptStartedAt: null },
      { $set: { status: "CANCELLED", cancelledAt: new Date() } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!updated) {
      // Perdu face à une réception qui vient de commencer, ou commande déjà annulée/reçue entre-temps.
      const current = await PurchaseOrder.findOne({ _id: order._id, ...stockFilter(scope) }).select("status receiptStartedAt").lean();
      return { ok: false, message: current?.receiptStartedAt && current.status === "ORDERED" ? MSG_ORDER_RECEIVING : MSG_ORDER_NOT_CANCELLABLE };
    }
    return { ok: true, order: orderView(updated) };
  });
}

export function getPurchaseOrder(actor: StockActor, input: unknown): Promise<StockResult<{ order: PurchaseOrderView }>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = OrderIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const order = await PurchaseOrder.findOne({ _id: parsed.data.orderId, ...stockFilter(scope) }).lean();
    if (!order) return { ok: false, message: MSG_ORDER_NOT_FOUND };
    return { ok: true, order: orderView(order) };
  });
}

const MAX_LISTED_ORDERS = 200;

// Commandes des centres autorisés (un seul centre si demandé et autorisé), éventuellement filtrées par statut, plus récentes d'abord.
export function listPurchaseOrders(actor: StockActor, requestedCenterId?: unknown, filter?: unknown): Promise<StockResult<{ orders: PurchaseOrderView[] }>> {
  return guard(async () => {
    const scope = stockScope(actor, requestedCenterId);
    const parsed = OrderListSchema.safeParse(filter ?? {});
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const rows = await PurchaseOrder.find({ ...stockFilter(scope), ...(parsed.data.status ? { status: parsed.data.status } : {}) })
      .sort({ createdAt: -1 })
      .limit(MAX_LISTED_ORDERS)
      .lean();
    return { ok: true, orders: rows.map(orderView) };
  });
}
