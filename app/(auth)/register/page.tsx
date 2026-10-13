import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Créer mon salon" };

export default function RegisterPage() {
  return (
    <AuthCard
      title={["Créez votre", "espace"]}
      subtitle="Votre salon en ligne en moins de 10 minutes. Gratuit pour démarrer."
    >
      <RegisterForm />
    </AuthCard>
  );
}
