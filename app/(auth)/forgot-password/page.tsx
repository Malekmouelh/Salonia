import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title={
        <>
          Mot de passe <span className="text-gradient italic">oublié ?</span>
        </>
      }
      subtitle="Pas de souci. Indiquez votre e-mail ou téléphone, nous vous envoyons un lien."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
