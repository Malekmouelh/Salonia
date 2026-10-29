// Module 5 — Erreurs métier du stock (messages affichables, en français = clé de traduction arabe).

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockError";
  }
}

export const MSG_INSUFFICIENT_STOCK = "Stock insuffisant pour cette sortie.";
export const MSG_ORDER_INCONSISTENT = "Cette commande est incohérente : réception impossible.";
export const MSG_LEDGER_BUSY = "Un autre mouvement est en cours sur ce produit : réessayez.";

// Erreur MongoDB de doublon sur un index unique. `field` précise l'index en cause (ex. « seq » pour une collision de rang).
export function isDuplicateKey(error: unknown, field?: string) {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
  if (!e || e.code !== 11000) return false;
  return field ? Object.keys(e.keyPattern ?? {}).includes(field) : true;
}
