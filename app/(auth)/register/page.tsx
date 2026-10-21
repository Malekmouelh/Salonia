import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterSwitch } from "@/components/auth/register-switch";

export const metadata: Metadata = { title: "Créer un compte" };

export default function RegisterPage() {
  return (
    <AuthCard
      title={["Créez votre", "espace"]}
      subtitle="Client : réservez et payez en ligne. Salon : votre vitrine en moins de 10 minutes."
    >
      <Suspense>
        <RegisterSwitch />
      </Suspense>
    </AuthCard>
  );
}
