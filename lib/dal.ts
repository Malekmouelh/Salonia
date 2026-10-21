import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import type { Governorate, Role } from "@/lib/enums";
import { Center, Organization, User } from "@/lib/models/core";
import { auth } from "@/auth";

// Data Access Layer : toute lecture protégée passe par ici.
// Session NextAuth (JWT signé dans un cookie httpOnly), revérifiée côté serveur à chaque requête.
export const verifySession = cache(async () => {
  await connection();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !isValidObjectId(userId)) redirect("/login");
  return { userId, role: session.user.role, organizationId: session.user.organizationId };
});

export type CurrentUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  lastLoginAt: Date | null;
  centerIds: string[];
  organization: {
    id: string;
    name: string;
    slug: string;
    centers: { id: string; name: string; governorate: Governorate }[];
  } | null;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const session = await verifySession();
  await connectDB();
  const user = await User.findById(session.userId).lean();
  // Compte supprimé : la route efface le cookie puis renvoie vers la connexion.
  if (!user) redirect("/api/auth/expired");

  const [organization, centers] = user.organizationId
    ? await Promise.all([
        Organization.findById(user.organizationId).lean(),
        Center.find({ organizationId: user.organizationId }).sort({ createdAt: 1 }).lean(),
      ])
    : [null, []];

  return {
    id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email ?? null,
    phone: user.phone ?? null,
    role: user.role as Role,
    lastLoginAt: user.lastLoginAt ?? null,
    centerIds: (user.centerIds ?? []).map(String),
    organization: organization
      ? {
          id: String(organization._id),
          name: organization.name,
          slug: organization.slug,
          centers: centers.map((c) => ({ id: String(c._id), name: c.name, governorate: c.governorate as Governorate })),
        }
      : null,
  };
});

export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

// Centres sur lesquels l'utilisateur a la main : tous pour le propriétaire, sinon ses affectations.
export function accessibleCenterIds(user: CurrentUser) {
  if (!user.organization) return [];
  if (user.role === "OWNER") return user.organization.centers.map((c) => c.id);
  return user.organization.centers.filter((c) => user.centerIds.includes(c.id)).map((c) => c.id);
}
