"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtMoney } from "@/lib/booking/format";
import type { Role } from "@/lib/enums";

// Éléments d'interface partagés du Module 6 : onglets, filtres, indicateurs, barres.

const TABS = [
  { href: "/dashboard/finances", label: "Tableau de bord", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/caisse", label: "Caisse", roles: ["OWNER", "MANAGER", "STAFF"] },
  { href: "/dashboard/finances/factures", label: "Factures", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/depenses", label: "Dépenses", roles: ["OWNER", "MANAGER"] },
];

export function FinanceTabs({ role }: { role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => tab.roles.includes(role));
  if (tabs.length < 2) return null;
  return (
    <div className="mt-6 flex gap-1 overflow-x-auto border-b border-white/10 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = tab.href === "/dashboard/finances" ? pathname === tab.href : pathname.startsWith(tab.href);
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

export const selectClass =
  "rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none transition focus:border-rose-gold/60 [&>option]:bg-plum-950";

// Filtres en une ligne au-dessus des graphiques : période et centre (dans l'URL, partageable).
export function FinanceFilters({
  periods,
  period,
  centers,
  center,
  children,
}: {
  periods: readonly { key: string; label: string }[];
  period: string;
  centers: { id: string; name: string }[];
  center: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <select aria-label={t("Période")} value={period} onChange={(e) => update("period", e.target.value)} className={selectClass}>
        {periods.map((p) => (
          <option key={p.key} value={p.key}>
            {t(p.label)}
          </option>
        ))}
      </select>
      {centers.length > 1 && (
        <select aria-label={t("Centre")} value={center} onChange={(e) => update("center", e.target.value)} className={selectClass}>
          <option value="all">{t("Tous les centres (vue consolidée)")}</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
      <div className="ms-auto flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Menu d'export (F6.6).
export function ExportMenu({ query }: { query: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const items = [
    { type: "report", format: "pdf", label: "Rapport financier (PDF)" },
    { type: "report", format: "csv", label: "Synthèse par centre (Excel/CSV)" },
    { type: "payments", format: "csv", label: "Paiements (Excel/CSV)" },
    { type: "invoices", format: "csv", label: "Factures (Excel/CSV)" },
    { type: "expenses", format: "csv", label: "Dépenses (Excel/CSV)" },
  ];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/80 transition hover:border-rose-gold/40 hover:text-white"
      >
        ⤓ {t("Exporter")}
      </button>
      {open && (
        <div className="absolute end-0 z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-plum-950/95 p-1.5 shadow-2xl backdrop-blur animate-fade-up">
          {items.map((i) => (
            <a
              key={`${i.type}-${i.format}`}
              href={`/api/finance/export?type=${i.type}&format=${i.format}&${query}`}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2.5 text-sm text-white/80 transition hover:bg-white/5 hover:text-white"
            >
              {t(i.label)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Indicateur : valeur, et variation signée vs période précédente (couleur = sens × « hausse = bien ? »).
export function StatTile({
  label,
  value,
  previous,
  current,
  upIsGood = true,
  hint,
}: {
  label: string;
  value: ReactNode;
  current?: number;
  previous?: number;
  upIsGood?: boolean;
  hint?: string;
}) {
  const { t } = useI18n();
  let delta: ReactNode = null;
  if (current !== undefined && previous !== undefined) {
    if (previous === 0) {
      delta = <span className="text-white/40">{t("pas de comparaison")}</span>;
    } else {
      const change = (current - previous) / Math.abs(previous);
      const good = change === 0 ? null : (change > 0) === upIsGood;
      delta = (
        <span className={good === null ? "text-white/50" : good ? "text-emerald-300" : "text-red-300"}>
          {change > 0 ? "▲" : change < 0 ? "▼" : "■"} {change > 0 ? "+" : ""}
          {Math.round(change * 100)} %
        </span>
      );
    }
  }
  return (
    <div className="glass rounded-3xl p-5">
      <p className="text-xs text-white/50">{t(label)}</p>
      <p className="mt-2 text-2xl font-semibold text-white sm:text-[1.7rem]">{value}</p>
      <p className="mt-1.5 text-xs">
        {delta}
        {delta && <span className="text-white/35"> {t("vs période précédente")}</span>}
        {!delta && hint && <span className="text-white/40">{t(hint)}</span>}
      </p>
    </div>
  );
}

// Barres horizontales mono-série (prestations, dépenses, moyens de paiement) : valeur au bout de la barre.
export function BarList({
  rows,
  empty,
  translateLabels = false,
}: {
  rows: { key: string; label: string; amount: number; detail?: string }[];
  empty: string;
  translateLabels?: boolean;
}) {
  const { t, lang } = useI18n();
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-white/45">{t(empty)}</p>;
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="group" title={`${translateLabels ? t(r.label) : r.label} · ${fmtMoney(r.amount, lang)}${r.detail ? ` · ${r.detail}` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-white/80">{translateLabels ? t(r.label) : r.label}</span>
            <span className="shrink-0 tabular-nums text-white">
              {fmtMoney(r.amount, lang)}
              {r.detail && <span className="ms-1.5 text-xs text-white/40">{r.detail}</span>}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-e-full bg-rose-gold transition-[filter] duration-200 group-hover:brightness-110"
              style={{ width: `${Math.max(2, (Math.max(r.amount, 0) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <section className={`glass rounded-[2rem] p-6 ${className}`}>
      <h2 className="font-display text-xl text-white">{t(title)}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-white/45">{t(subtitle)}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
