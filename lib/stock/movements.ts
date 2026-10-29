import { connectDB } from "@/lib/db";
import type { StockMovementKind, StockUnit } from "@/lib/enums";
import { StockMovement, StockProduct } from "@/lib/models/stock";
import { MovementHistorySchema, RecentMovementsSchema } from "./schemas";
import { MSG_PRODUCT_NOT_FOUND, guard, invalid, rawField, type StockActor, type StockResult } from "./service";
import { requireStockCenter, stockFilter, stockScope } from "./scope";

// Module 5 — Historique des mouvements d'un produit dans un centre (lecture seule). OWNER (tous les centres) et MANAGER (ses centres).
// Le centre est validé par lib/stock/scope.ts, l'organisation vient de l'acteur : jamais de données d'une autre organisation ni d'un
// centre non autorisé. Un produit inconnu ou d'une autre organisation reçoit « Produit introuvable. » (un produit archivé reste lisible).
// Aucun identifiant d'organisation ni d'utilisateur n'est renvoyé.

export type MovementHistoryRow = {
  seq: number;
  kind: StockMovementKind;
  // Variation réellement appliquée (négative pour une sortie) et solde après le mouvement, dans l'unité du produit.
  delta: number;
  balanceAfter: number;
  createdAt: string;
  note: string | null;
  // Références : commande d'achat (réception) ou rendez-vous (consommation), quand elles existent.
  purchaseOrderId: string | null;
  bookingId: string | null;
  // Consommation seulement : quantité demandée par la recette et quantité manquante.
  requested: number | null;
  shortfall: number | null;
};

export type MovementHistory = {
  productId: string;
  productName: string;
  unit: StockUnit;
  centerId: string;
  movements: MovementHistoryRow[];
  // Rang à passer comme `before` pour obtenir la page suivante (plus anciens) ; null = fin de l'historique.
  nextBefore: number | null;
};

export function listStockMovements(actor: StockActor, input: unknown): Promise<StockResult<MovementHistory>> {
  return guard(async () => {
    const { organizationId, centerId } = requireStockCenter(actor, rawField(input, "centerId"));
    const parsed = MovementHistorySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { productId, limit, before } = parsed.data;
    const product = await StockProduct.findOne({ _id: productId, organizationId }).lean();
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };

    // limit + 1 : savoir s'il reste des mouvements plus anciens sans second aller-retour.
    const rows = await StockMovement.find({ organizationId, centerId, productId, ...(before ? { seq: { $lt: before } } : {}) })
      .sort({ seq: -1 })
      .limit(limit + 1)
      .lean();
    const page = rows.slice(0, limit);
    return {
      ok: true,
      productId,
      productName: product.name,
      unit: product.unit as StockUnit,
      centerId,
      nextBefore: rows.length > limit ? page[page.length - 1].seq : null,
      movements: page.map((m) => ({
        seq: m.seq,
        kind: m.kind as StockMovementKind,
        delta: m.delta,
        balanceAfter: m.balanceAfter,
        createdAt: (m.createdAt ?? new Date(0)).toISOString(),
        note: m.note ?? null,
        purchaseOrderId: m.purchaseOrderId ? String(m.purchaseOrderId) : null,
        bookingId: m.bookingId ? String(m.bookingId) : null,
        requested: m.requested ?? null,
        shortfall: m.shortfall ?? null,
      })),
    };
  });
}

export type RecentMovementRow = MovementHistoryRow & { productId: string; productName: string; unit: StockUnit; centerId: string };

// Derniers mouvements, tous produits confondus, des centres autorisés (un seul centre si demandé et autorisé), du plus récent au
// plus ancien. Ordre déterministe : date puis identifiant. Borné à 50. Lecture seule, sans identifiant d'organisation.
export function listRecentStockMovements(actor: StockActor, requestedCenterId?: unknown, input?: unknown): Promise<StockResult<{ movements: RecentMovementRow[] }>> {
  return guard(async () => {
    const scope = stockScope(actor, requestedCenterId);
    const parsed = RecentMovementsSchema.safeParse(input ?? {});
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const rows = await StockMovement.find(stockFilter(scope)).sort({ createdAt: -1, _id: -1 }).limit(parsed.data.limit).lean();
    const products = await StockProduct.find({ organizationId: scope.organizationId, _id: { $in: rows.map((m) => m.productId) } }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    return {
      ok: true,
      movements: rows.flatMap((m) => {
        const product = byId.get(String(m.productId));
        if (!product) return [];
        return [
          {
            productId: String(m.productId),
            productName: product.name,
            unit: product.unit as StockUnit,
            centerId: String(m.centerId),
            seq: m.seq,
            kind: m.kind as StockMovementKind,
            delta: m.delta,
            balanceAfter: m.balanceAfter,
            createdAt: (m.createdAt ?? new Date(0)).toISOString(),
            note: m.note ?? null,
            purchaseOrderId: m.purchaseOrderId ? String(m.purchaseOrderId) : null,
            bookingId: m.bookingId ? String(m.bookingId) : null,
            requested: m.requested ?? null,
            shortfall: m.shortfall ?? null,
          },
        ];
      }),
    };
  });
}
