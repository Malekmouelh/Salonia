import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { connectDB } from "@/lib/db";
import { LoginSchema, isPhone, normalizePhone } from "@/lib/definitions";
import type { Role } from "@/lib/enums";
import { User } from "@/lib/models/core";

// Hash factice : on compare toujours un mot de passe, même si le compte n'existe pas,
// pour ne pas révéler par le temps de réponse quels comptes existent.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

export async function findByIdentifier(identifier: string) {
  await connectDB();
  return isPhone(identifier)
    ? User.findOne({ phone: normalizePhone(identifier) }).lean()
    : User.findOne({ email: identifier.toLowerCase() }).lean();
}

// NextAuth (Auth.js v5) : connexion par e-mail ou téléphone + mot de passe (fournisseur « credentials »).
// Le blocage après plusieurs échecs et le journal de sécurité sont gérés dans app/actions/auth.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { identifier: {}, password: {}, remember: {} },
      async authorize(credentials) {
        const parsed = LoginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await findByIdentifier(parsed.data.identifier);
        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) return null;
        return {
          id: String(user._id),
          name: `${user.firstName} ${user.lastName}`,
          email: user.email ?? null,
          role: user.role as Role,
          organizationId: user.organizationId ? String(user.organizationId) : null,
          remember: credentials.remember === "on",
        };
      },
    }),
  ],
});
