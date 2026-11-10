import type { StockLevelRow } from "./service";

// Module 5 — État, filtres et tri de la liste « Niveaux par centre ». Fonctions PURES (aucune requête) : la page filtre les niveaux
// déjà chargés par les services du stock (rôle, organisation et centres déjà appliqués).
//
// État d'un niveau, dans l'ordre de priorité (même règle que les cartes) :
//  - ARCHIVED : le produit est archivé ;
//  - OUT      : quantité à zéro (rupture), même si le seuil est aussi atteint ;
//  - LOW      : quantité <= seuil d'alerte (stock bas) ;
//  - OK       : stock suffisant.

export type LevelState = "OUT" | "LOW" | "OK" | "ARCHIVED";
export type StateFilter = "ALL" | "WATCH" | "OUT" | "LOW" | "OK";
export type LevelSort = "NAME" | "QUANTITY" | "CRITICAL";

type LevelLike = Pick<StockLevelRow, "productId" | "productName" | "centerId" | "productActive" | "quantity" | "alertThreshold" | "lowStock">;

export function levelState(l: Pick<LevelLike, "productActive" | "quantity" | "lowStock">): LevelState {
  if (!l.productActive) return "ARCHIVED";
  if (l.quantity === 0) return "OUT";
  return l.lowStock ? "LOW" : "OK";
}

// « WATCH » = tout ce qui demande de l'attention : rupture ou stock bas (produits actifs seulement).
export function matchesState(l: LevelLike, filter: StateFilter): boolean {
  if (filter === "ALL") return true;
  const state = levelState(l);
  if (filter === "WATCH") return state === "OUT" || state === "LOW";
  return state === filter;
}

export type LevelFilters = {
  state: StateFilter;
  // Identifiant du fournisseur habituel, « NONE » = produits sans fournisseur, null = tous.
  supplierId: string | null;
  needle: string;
};

export function filterLevels<T extends LevelLike>(levels: T[], filters: LevelFilters, supplierOf: Record<string, string | null>): T[] {
  const needle = filters.needle.trim().toLowerCase();
  return levels.filter((l) => {
    if (!matchesState(l, filters.state)) return false;
    if (needle && !l.productName.toLowerCase().includes(needle)) return false;
    if (filters.supplierId !== null) {
      const supplier = supplierOf[l.productId] ?? null;
      if (filters.supplierId === "NONE" ? supplier !== null : supplier !== filters.supplierId) return false;
    }
    return true;
  });
}

// Rapport quantité / seuil : plus il est bas, plus le niveau est critique ; un seuil à 0 se lit sur la quantité seule.
const criticality = (l: LevelLike) => (l.alertThreshold > 0 ? l.quantity / l.alertThreshold : l.quantity);

export function sortLevels<T extends LevelLike>(levels: T[], sort: LevelSort): T[] {
  const byName = (a: T, b: T) => a.productName.localeCompare(b.productName, "fr") || a.centerId.localeCompare(b.centerId);
  const copy = [...levels];
  if (sort === "QUANTITY") return copy.sort((a, b) => a.quantity - b.quantity || byName(a, b));
  // Critique d'abord ; les produits archivés passent après les produits actifs.
  if (sort === "CRITICAL") return copy.sort((a, b) => Number(!a.productActive) - Number(!b.productActive) || criticality(a) - criticality(b) || byName(a, b));
  return copy.sort(byName);
}

export function countByState(levels: LevelLike[]): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = { ALL: levels.length, WATCH: 0, OUT: 0, LOW: 0, OK: 0 };
  for (const l of levels) {
    const state = levelState(l);
    if (state === "OUT") {
      counts.OUT++;
      counts.WATCH++;
    } else if (state === "LOW") {
      counts.LOW++;
      counts.WATCH++;
    } else if (state === "OK") counts.OK++;
  }
  return counts;
}

// Synthèse d'un produit sur tous les niveaux chargés (fiche détail) : total, nombre de centres, répartition par état.
export function summarizeProduct(levels: LevelLike[]) {
  const counts = countByState(levels);
  return { total: levels.reduce((n, l) => n + l.quantity, 0), centers: levels.length, out: counts.OUT, low: counts.LOW, ok: counts.OK };
}
