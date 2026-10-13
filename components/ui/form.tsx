"use client";

import { useState, type ComponentType, type InputHTMLAttributes, type ReactNode, type SVGProps } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { AlertIcon, ArrowRightIcon, CheckIcon, EyeIcon, EyeOffIcon } from "./icons";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "placeholder"> & {
  label: string;
  name: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  error?: string[];
  hint?: ReactNode;
};

export function Field({ label, name, icon: Icon, error, hint, type = "text", className, ...props }: FieldProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const hasError = !!error?.length;
  const id = `field-${name}`;

  return (
    <div className={className}>
      <div
        className={`group relative rounded-2xl border bg-white/[0.04] transition-all duration-300 focus-within:bg-white/[0.07] ${
          hasError
            ? "animate-shake border-red-400/60 shadow-[0_0_0_4px_rgb(248_113_113/0.12)]"
            : "border-white/10 hover:border-white/20 focus-within:border-rose-gold/70 focus-within:shadow-[0_0_0_4px_rgb(232_180_160/0.12),0_8px_30px_-10px_rgb(232_160_180/0.5)]"
        }`}
      >
        {Icon && (
          <Icon
            className={`pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 transition-colors duration-300 ${
              hasError ? "text-red-300" : "text-white/40 group-focus-within:text-rose-gold"
            }`}
          />
        )}
        <input
          id={id}
          name={name}
          type={isPassword && visible ? "text" : type}
          placeholder=" "
          aria-invalid={hasError}
          aria-describedby={hasError ? `${id}-error` : undefined}
          className={`field-input peer block w-full bg-transparent pb-2.5 pt-6 text-[15px] text-white outline-none ${
            Icon ? "ps-12" : "ps-4"
          } ${isPassword ? "pe-12" : "pe-4"}`}
          {...props}
        />
        <label
          htmlFor={id}
          className={`field-label pointer-events-none absolute top-1/2 ltr:origin-left rtl:origin-right -translate-y-1/2 text-[15px] text-white/50 transition-all duration-300 ${
            Icon ? "start-12" : "start-4"
          }`}
          style={{ marginTop: 0 }}
        >
          {t(label)}
        </label>
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={t(visible ? "Masquer le mot de passe" : "Afficher le mot de passe")}
            className="absolute end-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <span className="block transition-transform duration-300" style={{ transform: visible ? "rotateY(180deg)" : "none" }}>
              {visible ? <EyeOffIcon /> : <EyeIcon />}
            </span>
          </button>
        )}
      </div>
      {hasError ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1.5 ps-1 text-[13px] text-red-300 animate-fade-up">
          <AlertIcon width={14} height={14} /> {t(error[0])}
        </p>
      ) : (
        hint && <div className="mt-1.5 ps-1 text-[13px] text-white/45">{typeof hint === "string" ? t(hint) : hint}</div>
      )}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-shine group flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-plum-950 disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <span className="flex items-center gap-2.5">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-plum-950/30 border-t-plum-950" />
          {t("Un instant…")}
        </span>
      ) : (
        <>
          {children}
          <ArrowRightIcon className="transition-transform duration-300 rtl:-scale-x-100 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
        </>
      )}
    </button>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  const styles =
    tone === "error"
      ? "border-red-400/30 bg-red-500/10 text-red-200"
      : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  return (
    <div role="alert" className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm animate-fade-up ${styles} ${tone === "error" ? "animate-shake" : ""}`}>
      <span className="mt-0.5 shrink-0">{tone === "error" ? <AlertIcon width={18} height={18} /> : <CheckIcon width={18} height={18} />}</span>
      <div>{children}</div>
    </div>
  );
}

// Indicateur de robustesse du mot de passe.
export function PasswordStrength({ value }: { value: string }) {
  const { t } = useI18n();
  const checks = [value.length >= 8, /[a-zA-Z]/.test(value), /\d/.test(value), /[^a-zA-Z0-9]/.test(value) || value.length >= 12];
  const score = checks.filter(Boolean).length;
  const labels = ["Trop faible", "Faible", "Moyen", "Bon", "Excellent"];
  const colors = ["bg-white/15", "bg-red-400", "bg-amber-400", "bg-lime-300", "bg-emerald-400"];

  if (!value) return <span>{t("8 caractères minimum, avec lettres et chiffres.")}</span>;
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <span
              className={`block h-full rounded-full transition-all duration-500 ${colors[score]}`}
              style={{ width: i < score ? "100%" : "0%" }}
            />
          </span>
        ))}
      </div>
      <span className="w-20 text-end text-xs">{t(labels[score])}</span>
    </div>
  );
}
