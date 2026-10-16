import "server-only";
import { connectDB } from "@/lib/db";
import { accessibleCenterIds, type CurrentUser } from "@/lib/dal";
import type { Governorate, Role } from "@/lib/enums";
import { AuthEvent, Center, User } from "@/lib/models/core";

export type { CurrentUser };

export type VisibleCenter = {
  id: string;
  name: string;
  governorate: Governorate;
  openingHours: Record<string, string | null> | null;
  members: { user: { id: string; firstName: string; lastName: string; role: Role } }[];
};

// Centres visibles par l'utilisateur : tous ceux de l'organisation pour le propriétaire,
// sinon uniquement ceux auxquels il est affecté (isolation par rôle).
export async function getVisibleCenters(user: CurrentUser): Promise<VisibleCenter[]> {
  const ids = accessibleCenterIds(user);
  if (ids.length === 0) return [];
  await connectDB();
  const [centers, members] = await Promise.all([
    Center.find({ _id: { $in: ids }, organizationId: user.organization!.id }).sort({ createdAt: 1 }).lean(),
    User.find({ organizationId: user.organization!.id, centerIds: { $in: ids } })
      .select("firstName lastName role centerIds")
      .lean(),
  ]);

  return centers.map((c) => ({
    id: String(c._id),
    name: c.name,
    governorate: c.governorate as Governorate,
    openingHours: (c.openingHours as Record<string, string | null> | null) ?? null,
    members: members
      .filter((m) => m.centerIds.some((id) => String(id) === String(c._id)))
      .map((m) => ({ user: { id: String(m._id), firstName: m.firstName, lastName: m.lastName, role: m.role as Role } })),
  }));
}

// Journal de sécurité : le propriétaire voit celui de toute son organisation, les autres le leur.
export async function getSecurityEvents(user: CurrentUser, take = 8) {
  await connectDB();
  const where =
    user.role === "OWNER" && user.organization ? { organizationId: user.organization.id } : { userId: user.id };

  const events = await AuthEvent.find(where)
    .sort({ createdAt: -1 })
    .limit(take)
    .populate<{ userId: { firstName: string; lastName: string } | null }>("userId", "firstName lastName")
    .lean();

  return events.map((e) => ({
    id: String(e._id),
    type: e.type,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    createdAt: e.createdAt as Date,
    user: e.userId ? { firstName: e.userId.firstName, lastName: e.userId.lastName } : null,
  }));
}
