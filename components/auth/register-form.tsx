"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { register } from "@/app/actions/auth";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, PasswordStrength, SubmitButton } from "@/components/ui/form";
import { ArrowLeftIcon, ArrowRightIcon, LockIcon, MailIcon, PhoneIcon, PinIcon, StoreIcon, UserIcon } from "@/components/ui/icons";
import { GOVERNORATES } from "@/lib/definitions";

const STEP_1_FIELDS = ["firstName", "lastName", "email", "phone"];
const STEPS = ["Vous", "Votre salon"];

export function RegisterForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(register, undefined);
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string[]>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errors = { ...state?.errors, ...localErrors };
  const v = state?.values ?? {};

  // Si le serveur renvoie une erreur sur l'étape 1, on y revient.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.errors && STEP_1_FIELDS.some((f) => state.errors?.[f])) setStep(0);
  }

  function next() {
    const form = formRef.current!;
    const get = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value.trim();
    const errs: Record<string, string[]> = {};
    if (get("firstName").length < 2) errs.firstName = ["Prénom trop court."];
    if (get("lastName").length < 2) errs.lastName = ["Nom trop court."];
    if (!/^\S+@\S+\.\S+$/.test(get("email"))) errs.email = ["Adresse e-mail invalide."];
    setLocalErrors(errs);
    if (Object.keys(errs).length === 0) setStep(1);
  }

  return (
    <form ref={formRef} action={action} noValidate onChange={() => Object.keys(localErrors).length && setLocalErrors({})}>
      {/* Progression */}
      <div className="mb-7 flex items-center gap-3">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-3">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition-all duration-500 ${
                i <= step ? "bg-gradient-to-br from-blush to-champagne text-plum-950 shadow-[0_0_20px_rgb(232_180_160/0.5)]" : "border border-white/15 text-white/40"
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm transition-colors ${i <= step ? "text-white" : "text-white/40"}`}>{t(label)}</span>
            {i < STEPS.length - 1 && (
              <span className="relative h-px flex-1 overflow-hidden bg-white/10">
                <span className="absolute inset-y-0 start-0 bg-gradient-to-r rtl:bg-gradient-to-l from-blush to-champagne transition-all duration-700" style={{ width: step > i ? "100%" : "0%" }} />
              </span>
            )}
          </div>
        ))}
      </div>

      {state?.message && <div className="mb-5"><Alert>{t(state.message)}</Alert></div>}

      {/* Les deux étapes restent montées pour conserver les valeurs saisies. */}
      <div className={step === 0 ? "block animate-[slide-in-left_0.5s_ease_both] rtl:animate-[slide-in-right_0.5s_ease_both]" : "hidden"}>
        <div className="stagger space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom" name="firstName" icon={UserIcon} autoComplete="given-name" defaultValue={v.firstName} error={errors.firstName} />
            <Field label="Nom" name="lastName" autoComplete="family-name" defaultValue={v.lastName} error={errors.lastName} />
          </div>
          <Field label="E-mail professionnel" name="email" type="email" icon={MailIcon} autoComplete="email" dir="ltr" defaultValue={v.email} error={errors.email} />
          <Field
            label="Téléphone (optionnel)"
            name="phone"
            type="tel"
            dir="ltr"
            icon={PhoneIcon}
            autoComplete="tel"
            defaultValue={v.phone}
            error={errors.phone}
            hint="Pour vous connecter aussi par téléphone et recevoir les rappels."
          />
          <button
            type="button"
            onClick={next}
            className="btn-shine group flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-plum-950"
          >
            {t("Continuer")} <ArrowRightIcon className="transition-transform duration-300 rtl:-scale-x-100 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
          </button>
        </div>
      </div>

      <div className={step === 1 ? "block animate-[slide-in-right_0.5s_ease_both] rtl:animate-[slide-in-left_0.5s_ease_both]" : "hidden"}>
        <div className="stagger space-y-4">
          <Field label="Nom de votre salon / marque" name="salonName" icon={StoreIcon} defaultValue={v.salonName} error={errors.salonName} />
          <div>
            <div className={`group relative rounded-2xl border bg-white/[0.04] transition focus-within:border-rose-gold/70 focus-within:shadow-[0_0_0_4px_rgb(232_180_160/0.12)] ${errors.governorate ? "border-red-400/60" : "border-white/10 hover:border-white/20"}`}>
              <PinIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-rose-gold" />
              <label htmlFor="governorate" className="pointer-events-none absolute start-12 top-2 text-[11.5px] text-rose-gold">
                {t("Gouvernorat du premier centre")}
              </label>
              <select
                id="governorate"
                name="governorate"
                defaultValue={v.governorate ?? ""}
                className="block w-full appearance-none bg-transparent pb-2.5 ps-12 pe-10 pt-6 text-[15px] text-white outline-none"
              >
                <option value="" disabled>{t("Choisir…")}</option>
                {GOVERNORATES.map((g) => (
                  <option key={g.value} value={g.value}>{t(g.label)}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-white/40" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
            </div>
            {errors.governorate && <p className="mt-1.5 ps-1 text-[13px] text-red-300">{t(errors.governorate[0])}</p>}
          </div>
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

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(0)}
              aria-label={t("Étape précédente")}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/70 transition hover:border-white/25 hover:text-white"
            >
              <ArrowLeftIcon className="rtl:-scale-x-100" />
            </button>
            <SubmitButton pending={pending}>{t("Créer mon salon")}</SubmitButton>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-white/55">
        {t("Déjà inscrit ?")}{" "}
        <Link href="/login" className="font-medium text-white underline decoration-rose-gold/60 underline-offset-4 hover:decoration-champagne">
          {t("Se connecter")}
        </Link>
      </p>
    </form>
  );
}
