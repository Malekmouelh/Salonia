import type { CurrentUser } from "@/lib/dal";

// F4 — Centres sur lesquels un utilisateur peut gérer le personnel.
// Propriétaire : tous les centres de l'organisation. Gérant : ses centres d'affectation.
// Tout autre rôle, ou un utilisateur sans organisation : aucun.
// Même règle que accessibleCenterIds (lib/dal.ts), réécrite ici pour rester testable sans la couche
// d'authentification (lib/dal.ts importe next-auth). À garder alignée si cette règle évolue.
export function teamCenters(user: Pick<CurrentUser, "role" | "organization" | "centerIds">) {
  if (!user.organization || (user.role !== "OWNER" && user.role !== "MANAGER")) return [];
  return user.organization.centers
    .filter((c) => user.role === "OWNER" || user.centerIds.includes(c.id))
    .map((c) => ({ id: c.id, name: c.name }));
}

// Un propriétaire peut modifier les horaires de tout employé de son organisation affecté à l'un de ses centres.
// Un gérant seulement si TOUS les centres de l'employé sont dans son périmètre : les horaires sont propres à
// l'employé et valent pour chacun de ses centres, un gérant ne doit pas changer ce que voit un autre centre.
export function canEditStaffHours(user: Pick<CurrentUser, "role" | "organization" | "centerIds">, staffCenterIds: readonly string[]) {
  const scope = new Set(teamCenters(user).map((c) => c.id));
  const inScope = staffCenterIds.filter((id) => scope.has(id));
  if (inScope.length === 0) return false;
  return user.role === "OWNER" || inScope.length === staffCenterIds.length;
}
