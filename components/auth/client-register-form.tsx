"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { registerClient } from "@/app/actions/auth";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, PasswordStrength, SubmitButton } from "@/components/ui/form";
import { LockIcon, MailIcon, PhoneIcon, UserIcon } from "@/components/ui/icons";

// Inscription d'un client : un seul écran, puis retour à la réservation en cours (next).
export function ClientRegisterForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(registerClient, undefined);
  const [password, setPassword] = useState("");
  const errors = state?.errors ?? {};
  const v = state?.values ?? {};
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      {state?.message && <div className="mb-5"><Alert>{t(state.message)}</Alert></div>}

      <div className="stagger space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom" name="firstName" icon={UserIcon} autoComplete="given-name" defaultValue={v.firstName} error={errors.firstName} />
          <Field label="Nom" name="lastName" autoComplete="family-name" defaultValue={v.lastName} error={errors.lastName} />
        </div>
        <Field
          label="Téléphone"
          name="phone"
          type="tel"
          dir="ltr"
          icon={PhoneIcon}
          autoComplete="tel"
          defaultValue={v.phone}
          error={errors.phone}
          hint="Pour la confirmation et le rappel de vos rendez-vous."
        />
        <Field label="E-mail" name="email" type="email" icon={MailIcon} autoComplete="email" dir="ltr" defaultValue={v.email} error={errors.email} />
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          icon={LockIcon}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={<PasswordStrength value={password} />}
        />
        <Field label="Confirmer le mot de passe" name="confirmPassword" type="password" icon={LockIcon} autoComplete="new-password" error={errors.confirmPassword} />
        <SubmitButton pending={pending}>{t(next ? "Créer mon compte et continuer" : "Créer mon compte")}</SubmitButton>
      </div>

      <p className="mt-6 text-center text-sm text-white/55">
        {t("Déjà inscrit ?")}{" "}
        <Link href={loginHref} className="font-medium text-white underline decoration-rose-gold/60 underline-offset-4 hover:decoration-champagne">
          {t("Se connecter")}
        </Link>
      </p>
    </form>
  );
}
