import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm, type DemoAccount } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Connexion" };

// Comptes créés par « npm run db:seed », affichés en développement ou si DEMO_MODE=true.
const DEMO_ACCOUNTS: DemoAccount[] =
  process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true"
    ? []
    : [
        { label: "Propriétaire", identifier: "owner@salonia.tn", password: "Demo1234" },
        { label: "Gérant Sousse", identifier: "manager@salonia.tn", password: "Demo1234" },
        { label: "Staff (tél.)", identifier: "22 345 678", password: "Demo1234" },
        { label: "Client", identifier: "client@salonia.tn", password: "Demo1234" },
        { label: "Super admin", identifier: "admin@salonia.tn", password: "Demo1234" },
      ];

export default function LoginPage() {
  return (
    <AuthCard
      title={["Bon retour", "parmi nous"]}
      subtitle="Connectez-vous pour retrouver votre salon."
    >
      <Suspense>
        <LoginForm demoAccounts={DEMO_ACCOUNTS} />
      </Suspense>
    </AuthCard>
  );
}
