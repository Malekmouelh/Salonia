import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/enums";

// Configuration NextAuth (Auth.js v5) sans accès à la base : utilisée telle quelle par proxy.ts.
// Les fournisseurs (vérification du mot de passe dans MongoDB) sont ajoutés dans auth.ts.
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 jours (« Se souvenir de moi »)
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000; // 12 h sans « Se souvenir de moi »

export const authConfig = {
  // Même clé que l'ancienne session : les .env existants restent valables.
  secret: process.env.AUTH_SECRET ?? process.env.SESSION_SECRET,
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  providers: [],
  callbacks: {
    // Le jeton JWT (cookie httpOnly signé) porte l'identifiant, le rôle et l'organisation.
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id!;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.expiresAt = user.remember ? Date.now() + SESSION_MAX_AGE * 1000 : Date.now() + SHORT_SESSION_MS;
      }
      // Session courte expirée : NextAuth efface le cookie.
      if (token.expiresAt && Date.now() > token.expiresAt) return null;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid;
      session.user.role = token.role as Role;
      session.user.organizationId = token.organizationId ?? null;
      return session;
    },
  },
} satisfies NextAuthConfig;
