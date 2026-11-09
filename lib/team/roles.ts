// F4 — Rôles prédéfinis de l'équipe, proposés dans « Ajouter un membre ».
// Chaque entrée porte le rôle d'accès (User.role) qu'elle crée : le serveur le déduit de la clé reçue, jamais du client.
// Le libellé est enregistré comme poste (User.jobTitle) et affiché sur la carte ; l'arabe passe par t().

export const TEAM_ROLES = [
  { key: "MANAGER", label: "Gérant(e) de centre", systemRole: "MANAGER" },
  { key: "HAIRDRESSER", label: "Coiffeur / Coiffeuse", systemRole: "STAFF" },
  { key: "ESTHETICIAN", label: "Esthéticienne", systemRole: "STAFF" },
  { key: "MAKEUP_ARTIST", label: "Maquilleuse", systemRole: "STAFF" },
  { key: "NAIL_TECHNICIAN", label: "Prothésiste ongulaire", systemRole: "STAFF" },
  { key: "MASSEUSE", label: "Masseuse", systemRole: "STAFF" },
  { key: "RECEPTIONIST", label: "Réceptionniste", systemRole: "STAFF" },
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];
export type TeamRoleKey = TeamRole["key"];
export const TEAM_ROLE_KEYS = TEAM_ROLES.map((r) => r.key) as [TeamRoleKey, ...TeamRoleKey[]];

export function teamRoleByKey(key: unknown): TeamRole | null {
  return TEAM_ROLES.find((r) => r.key === key) ?? null;
}

// Seul le propriétaire crée un gérant ; le propriétaire et le gérant créent du personnel.
// Tout autre rôle ne crée rien.
export function canCreateTeamRole(actorRole: string, role: TeamRole) {
  if (actorRole === "OWNER") return true;
  return actorRole === "MANAGER" && role.systemRole === "STAFF";
}

export function creatableTeamRoles(actorRole: string) {
  return TEAM_ROLES.filter((r) => canCreateTeamRole(actorRole, r)).map((r) => ({ key: r.key, label: r.label }));
}
