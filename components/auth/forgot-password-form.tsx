"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword } from "@/app/actions/auth";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, SubmitButton } from "@/components/ui/form";
import { ArrowLeftIcon, MailIcon } from "@/components/ui/icons";

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(forgotPassword, undefined);

  if (state?.success) {
    return (
      <div className="space-y-5 text-center animate-fade-up">
        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          <span className="absolute inset-0 rounded-full bg-rose-gold/30" style={{ animation: "pulse-ring 1.8s ease-out infinite" }} />
          <span className="relative grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-blush to-champagne text-plum-950">
            <MailIcon width={34} height={34} />
          </span>
        </div>
        <Alert tone="success">{t(state.success)}</Alert>
        {state.devLink && (
          <Link
            href={state.devLink}
            className="block rounded-2xl border border-dashed border-champagne/40 bg-champagne/5 px-4 py-3 text-sm text-champagne transition hover:bg-champagne/10"
          >
            {t("Mode démo : ouvrir le lien de réinitialisation →")}
          </Link>
        )}
        <BackToLogin />
      </div>
    );
  }

  return (
    <form action={action} className="stagger space-y-5" noValidate>
      {state?.message && <Alert>{t(state.message)}</Alert>}
      <Field
        label="E-mail ou téléphone"
        name="identifier"
        icon={MailIcon}
        autoComplete="username"
        dir="ltr"
        defaultValue={state?.values?.identifier}
        error={state?.errors?.identifier}
        autoFocus
      />
      <SubmitButton pending={pending}>{t("Envoyer le lien")}</SubmitButton>
      <BackToLogin />
    </form>
  );
}

function BackToLogin() {
  const { t } = useI18n();
  return (
    <Link href="/login" className="group flex items-center justify-center gap-2 text-sm text-white/60 transition hover:text-white">
      <ArrowLeftIcon width={16} height={16} className="transition-transform rtl:-scale-x-100 group-hover:-translate-x-1 rtl:group-hover:translate-x-1" /> {t("Retour à la connexion")}
    </Link>
  );
}
