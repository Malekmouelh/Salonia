// Module 5 — Détails du journal de sécurité pour le stock (identifiants et quantités uniquement).
// Jamais de note de mouvement (texte libre) : le détail ne contient aucune donnée saisie par l'utilisateur.

export function productAuditDetail(productId: string) {
  return `product:${productId}`;
}

export function levelAuditDetail(p: { productId: string; centerId: string; action: "activate" | "threshold" }) {
  return `product:${p.productId} center:${p.centerId} ${p.action}`;
}

export function movementAuditDetail(p: { productId: string; centerId: string; kind: string; delta: number; seq: number }) {
  return `product:${p.productId} center:${p.centerId} ${p.kind} ${p.delta > 0 ? "+" : ""}${p.delta} #${p.seq}`;
}

// Réception d'une commande d'achat : un événement n'est écrit que si cet appel a réellement fait avancer la commande
// (mouvements créés ou passage à RECEIVED). Un nouvel envoi sur une commande déjà reçue renvoie null : rien n'est journalisé.
// Les mouvements RECEIPT du registre (avec leur auteur) restent la trace des crédits, même d'une réception qui échoue en cours de route.
export function receiptAuditDetail(result: { alreadyReceived: boolean; recorded: number; order: { id: string; centerId: string; lines: unknown[] } }): string | null {
  if (result.alreadyReceived) return null;
  return `order:${result.order.id} center:${result.order.centerId} lines:${result.order.lines.length} recorded:${result.recorded}`;
}

// Matériel et maintenance : identifiants et dates uniquement. Jamais le nom, la catégorie ni la note d'intervention (saisies libres).
export function equipmentAuditDetail(p: { equipmentId: string; centerId: string }) {
  return `equipment:${p.equipmentId} center:${p.centerId}`;
}

export function scheduleAuditDetail(p: { equipmentId: string; centerId: string; nextMaintenanceAt: string | null }) {
  return `equipment:${p.equipmentId} center:${p.centerId} next:${p.nextMaintenanceAt ?? "none"}`;
}

export function maintenanceAuditDetail(p: { equipmentId: string; centerId: string; performedAt: string; nextDueAt: string | null }) {
  return `equipment:${p.equipmentId} center:${p.centerId} performed:${p.performedAt} next:${p.nextDueAt ?? "none"}`;
}

// Fournisseurs et commandes d'achat : identifiants, nombre de lignes et statut uniquement. Jamais le nom, les coordonnées du fournisseur,
// ni les noms de produits (saisies libres ou données personnelles de tiers).
export function supplierAuditDetail(p: { supplierId: string }) {
  return `supplier:${p.supplierId}`;
}

export function orderAuditDetail(p: { orderId: string; centerId: string; supplierId: string; lines: number }) {
  return `order:${p.orderId} center:${p.centerId} supplier:${p.supplierId} lines:${p.lines}`;
}

export function orderStatusAuditDetail(p: { orderId: string; centerId: string; status: string }) {
  return `order:${p.orderId} center:${p.centerId} status:${p.status}`;
}

// Recettes de service : identifiants et quantités entières uniquement.
export function recipeAuditDetail(p: { serviceId: string; productId: string; quantity: number; previousQuantity?: number }) {
  const qty = p.previousQuantity === undefined ? `${p.quantity}` : `${p.previousQuantity}->${p.quantity}`;
  return `service:${p.serviceId} product:${p.productId} qty:${qty}`;
}

// Transferts entre centres : identifiants et quantité entière uniquement (jamais le nom du produit ni de l'équipement).
export function transferAuditDetail(p: { transferId: string; fromCenterId: string; toCenterId: string; productId?: string; equipmentId?: string; quantity?: number }) {
  const subject = p.productId ? `product:${p.productId} qty:${p.quantity ?? 0}` : `equipment:${p.equipmentId}`;
  return `transfer:${p.transferId} from:${p.fromCenterId} to:${p.toCenterId} ${subject}`;
}
