import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title={["Nouveau", "départ"]}
      subtitle="Choisissez un nouveau mot de passe sécurisé."
    >
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
