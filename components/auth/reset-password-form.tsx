"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resetPassword } from "@/app/actions/auth";
import { Alert, Field, PasswordStrength, SubmitButton } from "@/components/ui/form";
import { LockIcon } from "@/components/ui/icons";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  const [password, setPassword] = useState("");
  const token = useSearchParams().get("token");

  if (!token) {
    return (
      <div className="space-y-5">
        <Alert>Lien invalide : le jeton de réinitialisation est manquant.</Alert>
        <Link href="/forgot-password" className="block text-center text-sm text-rose-gold hover:text-champagne">
          Demander un nouveau lien
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="stagger space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      {state?.message && (
        <Alert>
          {state.message}{" "}
          <Link href="/forgot-password" className="underline">Nouveau lien</Link>
        </Alert>
      )}
      <Field
        label="Nouveau mot de passe"
        name="password"
        type="password"
        icon={LockIcon}
        autoComplete="new-password"
        onChange={(e) => setPassword(e.target.value)}
        error={state?.errors?.password}
        hint={<PasswordStrength value={password} />}
        autoFocus
      />
      <Field label="Confirmer" name="confirmPassword" type="password" icon={LockIcon} autoComplete="new-password" error={state?.errors?.confirmPassword} />
      <SubmitButton pending={pending}>Enregistrer</SubmitButton>
    </form>
  );
}
