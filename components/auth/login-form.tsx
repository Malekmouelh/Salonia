"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "@/app/actions/auth";
import { Alert, Field, SubmitButton } from "@/components/ui/form";
import { LockIcon, MailIcon, PhoneIcon } from "@/components/ui/icons";
import { isPhone } from "@/lib/definitions";

export type DemoAccount = { label: string; identifier: string; password: string };

export function LoginForm({ demoAccounts = [] }: { demoAccounts?: DemoAccount[] }) {
  const [state, action, pending] = useActionState(login, undefined);
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const looksLikePhone = /^[+\d\s]+$/.test(identifier) && identifier.length > 2;

  function fillDemo(account: DemoAccount) {
    const form = formRef.current;
    if (!form) return;
    setIdentifier(account.identifier);
    (form.elements.namedItem("password") as HTMLInputElement).value = account.password;
  }

  return (
    <form ref={formRef} action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />

      {searchParams.get("reset") && !state && (
        <Alert tone="success">Mot de passe modifié. Vous pouvez vous connecter.</Alert>
      )}
      {state?.message && <Alert>{state.message}</Alert>}

      <div className="stagger space-y-5">
        <Field
          label="E-mail ou téléphone"
          name="identifier"
          icon={looksLikePhone ? PhoneIcon : MailIcon}
          autoComplete="username"
          inputMode={looksLikePhone ? "tel" : "email"}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={state?.errors?.identifier}
          hint={identifier && isPhone(identifier) ? "Numéro tunisien détecté (+216)" : undefined}
          autoFocus
        />
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          icon={LockIcon}
          autoComplete="current-password"
          error={state?.errors?.password}
        />

        <div className="flex items-center justify-between text-sm">
          <label className="group flex cursor-pointer items-center gap-2.5 text-white/60 select-none">
            <input type="checkbox" name="remember" defaultChecked className="peer sr-only" />
            <span className="grid h-5 w-5 place-items-center rounded-md border border-white/20 bg-white/5 transition peer-checked:border-rose-gold peer-checked:bg-rose-gold peer-focus-visible:ring-2 peer-focus-visible:ring-rose-gold/50 [&>svg]:scale-0 peer-checked:[&>svg]:scale-100">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-plum-950 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth={3}>
                <path d="m5 12 5 5 9-10" />
              </svg>
            </span>
            Se souvenir de moi
          </label>
          <Link href="/forgot-password" className="text-rose-gold/90 underline-offset-4 transition hover:text-champagne hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>

        <SubmitButton pending={pending}>Se connecter</SubmitButton>

        <p className="text-center text-sm text-white/55">
          Nouveau salon ?{" "}
          <Link href="/register" className="font-medium text-white underline decoration-rose-gold/60 underline-offset-4 transition hover:decoration-champagne">
            Créer mon espace gratuitement
          </Link>
        </p>
      </div>

      {demoAccounts.length > 0 && (
        <div className="animate-fade-up [animation-delay:0.6s] border-t border-white/10 pt-5">
          <p className="mb-3 text-center text-xs uppercase tracking-[0.18em] text-white/35">Comptes de démonstration</p>
          <div className="flex flex-wrap justify-center gap-2">
            {demoAccounts.map((a) => (
              <button
                key={a.identifier}
                type="button"
                onClick={() => fillDemo(a)}
                className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/70 transition hover:-translate-y-0.5 hover:border-rose-gold/50 hover:bg-rose-gold/10 hover:text-white"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
