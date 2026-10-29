import type { PurchaseOrderStatus } from "@/lib/enums";

// Module 5 (F5.5) — Cycle de vie d'une commande d'achat.
//   DRAFT     → ORDERED | CANCELLED
//   ORDERED   → CANCELLED | RECEIVED   (RECEIVED : réservé à l'étape de réception, qui n'existe pas encore)
//   RECEIVED, CANCELLED : états finaux.
// Créer, modifier, passer ou annuler une commande ne modifie JAMAIS le stock.
export const ORDER_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["CANCELLED", "RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

export const canTransitionOrder = (from: PurchaseOrderStatus, to: PurchaseOrderStatus) => ORDER_TRANSITIONS[from].includes(to);

// Statuts depuis lesquels chaque transition proposée par les services est permise (utilisés comme filtre atomique en base).
export const CAN_ORDER_FROM: readonly PurchaseOrderStatus[] = ["DRAFT"];
export const CAN_CANCEL_FROM: readonly PurchaseOrderStatus[] = ["DRAFT", "ORDERED"];

// ── Cohérence d'une commande avant et pendant la réception ──

export type ReceiptSnapshot = { productId: string; centerId: string; delta: number };
export type OrderForReceipt = {
  status: PurchaseOrderStatus;
  centerId: string;
  receiptStartedAt?: Date | null;
  lines: { productId: string; quantity: number }[];
};

// Renvoie null si la commande et ses réceptions déjà enregistrées sont cohérentes, sinon un code de raison (journalisé, jamais
// affiché tel quel). Une commande incohérente n'est jamais reçue : on ne « répare » pas un état douteux en créditant du stock.
//  - brouillon ou annulée : aucune réception ni début de réception ne doit exister ;
//  - chaque réception correspond à une ligne, au centre de la commande, pour la quantité commandée, sans doublon ;
//  - une commande reçue a une réception pour chacune de ses lignes.
export function checkReceiptConsistency(order: OrderForReceipt, receipts: ReceiptSnapshot[]): string | null {
  const lineByProduct = new Map(order.lines.map((l) => [l.productId, l]));
  if (lineByProduct.size !== order.lines.length) return "DUPLICATE_LINES";
  if ((order.status === "DRAFT" || order.status === "CANCELLED") && (receipts.length > 0 || order.receiptStartedAt)) return "RECEIPT_ON_UNPLACED_ORDER";
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const line = lineByProduct.get(receipt.productId);
    if (!line) return "RECEIPT_WITHOUT_LINE";
    if (seen.has(receipt.productId)) return "DUPLICATE_RECEIPT";
    seen.add(receipt.productId);
    if (receipt.centerId !== order.centerId) return "RECEIPT_WRONG_CENTER";
    if (receipt.delta !== line.quantity) return "RECEIPT_WRONG_QUANTITY";
  }
  if (order.status === "RECEIVED" && seen.size !== order.lines.length) return "RECEIVED_WITH_MISSING_RECEIPTS";
  return null;
}
