"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Toast } from "@/components/ui/modal";
import type { Role, StockUnit } from "@/lib/enums";
import { STOCK_UNIT_LABELS } from "@/lib/stock/labels";

// Éléments d'interface partagés du Module 5 (matériel et stock) : sous-navigation, formats, pastilles et gestion des envois.
// Les classes de champ viennent de components/calendar/status et finance-ui (mêmes styles que les autres modules).

export type ProductItem = { id: string; name: string; unit: StockUnit; active: boolean };
export type CenterItem = { id: string; name: string };
export type Errors = Record<string, string[] | undefined>;
export type ActionOutcome = { ok: true; message?: string } | { ok: false; message?: string; errors?: Record<string, string[]> };

const TABS = [
  { href: "/dashboard/stock", label: "Vue d'ensemble", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/stock/materiel", label: "Matériel", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/stock/fournisseurs", label: "Fournisseurs", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/stock/commandes", label: "Commandes", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/stock/recettes", label: "Recettes", roles: ["OWNER"] },
] as const;

// Sous-navigation du module (même présentation que FinanceTabs). « Recettes » : propriétaire seulement.
export function StockTabs({ role }: { role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => (tab.roles as readonly string[]).includes(role));
  return (
    <div className="mt-6 flex gap-1 overflow-x-auto border-b border-white/10 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = tab.href === "/dashboard/stock" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
              active ? "border-champagne font-semibold text-white" : "border-transparent text-white/55 hover:text-white"
            }`}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </div>
  );
}

// Nombre entier selon la langue (chiffres latins dans les deux langues, comme le reste de l'application).
export function fmtQty(value: number, lang: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-TN" : "fr-TN").format(value);
}

// Quantité + unité de base. La valeur et l'unité sont isolées (<bdi>) pour rester lisibles en arabe (RTL).
export function Qty({ value, unit, signed = false }: { value: number; unit: StockUnit; signed?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <span className="tabular-nums">
      <bdi>
        {signed && value > 0 ? "+" : ""}
        {fmtQty(value, lang)}
      </bdi>{" "}
      <span className="text-white/50">{t(STOCK_UNIT_LABELS[unit])}</span>
    </span>
  );
}

// Date « jour » (AAAA-MM-JJ) ou horodatage ISO, isolée pour le RTL.
export function DateText({ value, withTime = false }: { value: string; withTime?: boolean }) {
  const { lang } = useI18n();
  const iso = value.length === 10 ? `${value}T12:00:00Z` : value;
  const options: Intl.DateTimeFormatOptions = withTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Tunis" }
    : { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Tunis" };
  return <bdi className="tabular-nums">{new Intl.DateTimeFormat(lang === "ar" ? "ar-TN" : "fr-TN", options).format(new Date(iso))}</bdi>;
}

const CHIP_TONES = {
  ok: "bg-emerald-400/15 text-emerald-200",
  warn: "bg-amber-400/15 text-amber-200",
  bad: "bg-red-400/15 text-red-200",
  info: "bg-sky-400/15 text-sky-200",
  muted: "bg-white/10 text-white/60",
} as const;
export type ChipTone = keyof typeof CHIP_TONES;

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs ${CHIP_TONES[tone]}`}>{children}</span>;
}

export function FieldError({ errors, name, id }: { errors: Errors; name: string; id?: string }) {
  const { t } = useI18n();
  const message = errors[name]?.[0];
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-300">
      {t(message)}
    </p>
  );
}

// Envoi d'un formulaire : désactive le bouton pendant l'appel (pas de double envoi), range les erreurs de champ et le message.
export function useSubmit(onSuccess: (message: string) => void) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const submit = (call: () => Promise<ActionOutcome>) => {
    setErrors({});
    setMessage(null);
    start(async () => {
      const result = await call();
      if (result.ok) onSuccess(result.message ?? "");
      else {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? (result.errors ? null : "Une erreur est survenue. Réessayez."));
      }
    });
  };
  return { pending, errors, message, submit };
}

// Notification de réussite ou d'erreur (même Toast que les autres modules).
export function useFeedback() {
  const { t } = useI18n();
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const node = toast ? (
    <Toast tone={toast.tone} onDone={() => setToast(null)}>
      {t(toast.text)}
    </Toast>
  ) : null;
  return { show: (text: string, tone: "success" | "error" = "success") => setToast({ tone, text }), node };
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="glass rounded-[2rem] p-10 text-center text-white/50">{children}</p>;
}

// Sélecteur de centre en lien (?center=…), même présentation que la liste de l'équipe.
export function CenterFilter({ centers, selectedId, basePath }: { centers: CenterItem[]; selectedId: string | null; basePath: string }) {
  const { t } = useI18n();
  if (centers.length < 2) return null;
  return (
    <nav aria-label={t("Choisir un centre")} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <div className="inline-flex gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1.5">
        {[{ id: null as string | null, name: t("Tous les centres") }, ...centers].map((c) => {
          const active = c.id === selectedId;
          return (
            <Link
              key={c.id ?? "all"}
              href={c.id ? `${basePath}?center=${c.id}` : basePath}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm transition ${
                active ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950" : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              {c.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function centerName(centers: CenterItem[], id: string) {
  return centers.find((c) => c.id === id)?.name ?? "—";
}

export function PageIntro({ title, accent, subtitle }: { title: string; accent: string; subtitle: string }) {
  const { t } = useI18n();
  return (
    <div className="mt-6 animate-fade-up">
      <h1 className="font-display text-4xl text-white">
        {t(title)} <span className="text-gradient italic">{t(accent)}</span>
      </h1>
      <p className="mt-1 text-white/55">{t(subtitle)}</p>
    </div>
  );
}
