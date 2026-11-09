// Module 5 (F5.3) — Alerte de cohérence d'une ligne de recette avec le stock réel. Fonction pure : la page l'affiche, rien n'est refusé
// (une recette peut légitimement précéder une livraison) ; la consommation, elle, est toujours plafonnée au solde du centre du rendez-vous.
//
// La consommation se fait PAR CENTRE : la comparaison porte donc sur le centre le mieux fourni, pas sur le total (30 + 30 ml répartis dans
// deux centres ne permettent pas une prestation de 40 ml dans l'un ou l'autre).

export type StockCover = {
  // Somme des quantités de tous les centres du périmètre de l'utilisateur.
  total: number;
  // Quantité du centre le mieux fourni.
  best: number;
  // Nombre de centres où le produit est activé.
  centers: number;
};

export type RecipeStockWarning = "NOT_TRACKED" | "INSUFFICIENT" | null;

export function recipeStockWarning(cover: StockCover | undefined, quantityPerService: number): RecipeStockWarning {
  if (!Number.isInteger(quantityPerService) || quantityPerService <= 0) return null; // saisie incomplète : la validation du formulaire s'en charge
  if (!cover || cover.centers === 0) return "NOT_TRACKED";
  return quantityPerService > cover.best ? "INSUFFICIENT" : null;
}

export function addToCover(cover: StockCover | undefined, quantity: number): StockCover {
  const current = cover ?? { total: 0, best: 0, centers: 0 };
  return { total: current.total + quantity, best: Math.max(current.best, quantity), centers: current.centers + 1 };
}

// Nombre de prestations après lesquelles l'alerte de stock se déclenchera avec cette recette. L'alerte est levée quand la quantité
// atteint le seuil ou passe en dessous (quantity <= seuil) : on cherche le plus petit n tel que quantity - n × quantité <= seuil.
// 0 = le seuil est déjà atteint. null = saisie invalide (quantité par prestation nulle ou non entière).
export function servicesBeforeAlert(quantity: number, alertThreshold: number, quantityPerService: number): number | null {
  if (!Number.isInteger(quantityPerService) || quantityPerService <= 0) return null;
  if (quantity <= alertThreshold) return 0;
  return Math.ceil((quantity - alertThreshold) / quantityPerService);
}
