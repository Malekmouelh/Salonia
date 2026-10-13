import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm, type DemoAccount } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Connexion" };

// Comptes créés par « npm run db:seed », affichés uniquement en développement.
const DEMO_ACCOUNTS: DemoAccount[] =
  process.env.NODE_ENV === "production"
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
      title={
        <>
          Bon retour <span className="text-gradient italic">parmi nous</span>
        </>
      }
      subtitle="Connectez-vous pour retrouver votre salon."
    >
      <Suspense>
        <LoginForm demoAccounts={DEMO_ACCOUNTS} />
      </Suspense>
    </AuthCard>
  );
}
