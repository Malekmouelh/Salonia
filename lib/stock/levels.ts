// Module 5 — Règles pures sur les niveaux de stock.

// Garde-fou technique (entiers sûrs, saisies absurdes) : aucune quantité saisie ne dépasse cette valeur. Un milliard de ML = 1 000 m³.
export const MAX_STOCK_QUANTITY = 1_000_000_000;

// Alerte de stock bas : déclenchée AU seuil (D2), pas seulement en dessous.
export function isLowStock(quantity: number, alertThreshold: number) {
  return quantity <= alertThreshold;
}
