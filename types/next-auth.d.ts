import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/enums";

// Champs ajoutés à la session NextAuth (voir auth.config.ts).
declare module "next-auth" {
  interface User {
    role: Role;
    organizationId: string | null;
    remember?: boolean;
  }
  interface Session {
    user: { id: string; role: Role; organizationId: string | null } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    role: Role;
    organizationId: string | null;
    expiresAt?: number;
  }
}
