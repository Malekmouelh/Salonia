import type { CurrentUser } from "@/lib/dal";

// Module 5 (étape 2) — Droits et périmètre multi-centres du stock et du matériel.
// Fonctions pures, testables sans base ni session (lib/dal.ts importe next-auth) : même principe que lib/team/scope.ts,
// règle volontairement réécrite ici pour ne pas coupler le Module 5 à celui de l'équipe. À garder alignée avec
// accessibleCenterIds (lib/dal.ts) si cette règle évolue.
//
// Règles (cadrage D7) :
//  - OWNER : tous les centres de son organisation ; seul à gérer les définitions de produits et les recettes.
//  - MANAGER : uniquement ses centres d'affectation (matériel, niveaux, seuils, mouvements) ; pas les définitions de produits.
//  - STAFF, CLIENT, SUPER_ADMIN, ou utilisateur sans organisation : aucun accès à l'administration du stock.
//
// Ces fonctions décident ; elles n'exécutent aucune requête. Elles ne remplacent pas le filtre `organizationId` ni la
// relecture des enregistrements dans le futur service de stock : elles fournissent les centres et les messages à utiliser.

type Actor = Pick<CurrentUser, "role" | "organization" | "centerIds">;

export const MSG_STOCK_FORBIDDEN = "Action non autorisée.";
// Même message pour un centre inconnu, d'une autre organisation ou hors périmètre : on ne révèle pas son existence.
export const MSG_STOCK_CENTER_NOT_FOUND = "Centre introuvable.";

export class StockAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockAccessError";
  }
}

// Administration du stock et du matériel (hors définitions communes) : propriétaire et gérant d'une organisation.
export function canAdministerStock(user: Actor) {
  return !!user.organization && (user.role === "OWNER" || user.role === "MANAGER");
}

// Définitions communes des produits (StockProduct) et recettes (ServiceRecipe) : propriétaire seulement.
export function canManageProductDefinitions(user: Actor) {
  return !!user.organization && user.role === "OWNER";
}

// Centres sur lesquels l'utilisateur administre le stock, dans l'ordre de l'organisation.
// Un centre d'affectation qui n'appartient pas à l'organisation est ignoré.
export function stockCenters(user: Actor) {
  if (!canAdministerStock(user) || !user.organization) return [];
  return user.organization.centers
    .filter((c) => user.role === "OWNER" || user.centerIds.includes(c.id))
    .map((c) => ({ id: c.id, name: c.name }));
}

// Valide un centre fourni par le client : renvoie son identifiant s'il est dans le périmètre, sinon null.
// Seule une chaîne non vide est acceptée (un objet comme { $ne: "" } venu d'un corps de requête est refusé).
export function resolveStockCenter(user: Actor, centerId: unknown): string | null {
  if (typeof centerId !== "string" || centerId === "") return null;
  return stockCenters(user).find((c) => c.id === centerId)?.id ?? null;
}

// Garde d'écriture/lecture d'administration : renvoie l'organisation de l'acteur (jamais celle du client).
export function requireStockAdmin(user: Actor): string {
  if (!canAdministerStock(user) || !user.organization) throw new StockAccessError(MSG_STOCK_FORBIDDEN);
  return user.organization.id;
}

// Garde des définitions de produits et des recettes : propriétaire seulement.
export function requireProductDefinitionsAdmin(user: Actor): string {
  if (!canManageProductDefinitions(user) || !user.organization) throw new StockAccessError(MSG_STOCK_FORBIDDEN);
  return user.organization.id;
}

// Garde d'une opération sur UN centre fourni par le client : droit d'administration puis appartenance au périmètre.
export function requireStockCenter(user: Actor, centerId: unknown): { organizationId: string; centerId: string } {
  const organizationId = requireStockAdmin(user);
  const resolved = resolveStockCenter(user, centerId);
  if (!resolved) throw new StockAccessError(MSG_STOCK_CENTER_NOT_FOUND);
  return { organizationId, centerId: resolved };
}

export type StockScope = { organizationId: string; centerIds: string[] };

// Périmètre d'une lecture : tous les centres autorisés, ou un seul si le client en demande un (alors validé).
// `requestedCenterId` absent, null ou undefined = pas de filtre demandé. Toute autre valeur doit être un centre du périmètre.
export function stockScope(user: Actor, requestedCenterId?: unknown): StockScope {
  const organizationId = requireStockAdmin(user);
  if (requestedCenterId === undefined || requestedCenterId === null) {
    return { organizationId, centerIds: stockCenters(user).map((c) => c.id) };
  }
  const resolved = resolveStockCenter(user, requestedCenterId);
  if (!resolved) throw new StockAccessError(MSG_STOCK_CENTER_NOT_FOUND);
  return { organizationId, centerIds: [resolved] };
}

// Filtre de base à inclure dans toute requête sur des données de centre (Equipment, StockLevel, StockMovement…).
// Une liste de centres vide ne correspond à aucun document.
export function stockFilter(scope: StockScope) {
  return { organizationId: scope.organizationId, centerId: { $in: scope.centerIds } };
}

// Contrôle de défense en profondeur sur un enregistrement déjà chargé : même organisation et centre dans le périmètre.
export function isInStockScope(user: Actor, record: { organizationId: unknown; centerId: unknown }) {
  if (!canAdministerStock(user) || !user.organization) return false;
  if (String(record.organizationId) !== user.organization.id) return false;
  return resolveStockCenter(user, String(record.centerId)) !== null;
}

// Fournisseurs : données communes à l'organisation (comme les définitions de produits). Propriétaire seulement en écriture ;
// le gérant les lit pour choisir un fournisseur dans une commande de son centre.
export function requireSupplierAdmin(user: Actor): string {
  if (!canManageProductDefinitions(user) || !user.organization) throw new StockAccessError(MSG_STOCK_FORBIDDEN);
  return user.organization.id;
}
