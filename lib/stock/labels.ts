// Libellés du Module 5 (français = clé de traduction arabe). Utilisables côté client.
import type { EquipmentStatus, PurchaseOrderStatus, StockMovementKind, StockTransferKind, StockTransferStatus, StockUnit } from "@/lib/enums";

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  IN_SERVICE: "En service",
  IN_MAINTENANCE: "En maintenance",
  OUT_OF_SERVICE: "Hors service",
};

export const STOCK_UNIT_LABELS: Record<StockUnit, string> = {
  PIECE: "Pièce",
  ML: "ml",
  G: "g",
};

export const STOCK_MOVEMENT_KIND_LABELS: Record<StockMovementKind, string> = {
  OPENING: "Stock initial",
  IN: "Entrée",
  OUT: "Sortie",
  ADJUSTMENT: "Correction",
  CONSUMPTION: "Consommation",
  RECEIPT: "Réception",
  TRANSFER_OUT: "Transfert sortant",
  TRANSFER_IN: "Transfert entrant",
};

export const STOCK_TRANSFER_KIND_LABELS: Record<StockTransferKind, string> = {
  PRODUCT: "Produit",
  EQUIPMENT: "Matériel",
};

export const STOCK_TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  PENDING: "En cours",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
};

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Brouillon",
  ORDERED: "Commandée",
  RECEIVED: "Reçue",
  CANCELLED: "Annulée",
};

export const MAINTENANCE_STATE_LABELS = {
  NONE: "Aucune échéance",
  OVERDUE: "En retard",
  DUE_TODAY: "Échéance aujourd'hui",
  SCHEDULED: "Planifiée",
} as const;
