import "server-only";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

export type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

// Centres visibles par l'utilisateur : tous ceux de l'organisation pour le propriétaire,
// sinon uniquement ceux auxquels il est affecté (isolation par rôle).
export async function getVisibleCenters(user: CurrentUser) {
  const scope =
    user.role === "OWNER"
      ? { organizationId: user.organization?.id ?? "__none__" }
      : { members: { some: { userId: user.id } } };

  return prisma.center.findMany({
    where: scope,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      governorate: true,
      openingHours: true,
      members: {
        select: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      },
    },
  });
}

export type VisibleCenter = Awaited<ReturnType<typeof getVisibleCenters>>[number];

// Journal de sécurité : le propriétaire voit celui de toute son organisation, les autres le leur.
export async function getSecurityEvents(user: CurrentUser, take = 8) {
  const where =
    user.role === "OWNER" && user.organization
      ? { organizationId: user.organization.id }
      : { userId: user.id };

  return prisma.authEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
}
