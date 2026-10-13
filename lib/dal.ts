import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, decrypt } from "@/lib/session";
import type { Role } from "@/app/generated/prisma/enums";

// Data Access Layer : toute lecture protégée passe par ici.
export const verifySession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await decrypt(token);
  if (!session?.userId) redirect("/login");
  return session;
});

export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      lastLoginAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          centers: { select: { id: true, name: true, governorate: true }, orderBy: { createdAt: "asc" } },
        },
      },
      centers: { select: { center: { select: { id: true, name: true, governorate: true } } } },
    },
  });
  if (!user) redirect("/api/auth/signout");
  return user;
});

export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}
