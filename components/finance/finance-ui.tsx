"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/finance-ui.tsx — LES BRIQUES D'INTERFACE DU MODULE 6
// ═══════════════════════════════════════════════════════════════════════════
// "use client" (ligne 1) : ces composants s'exécutent dans le NAVIGATEUR. C'est nécessaire dès qu'on a
//   de l'INTERACTIVITÉ : état (useState), clic, menu déroulant, lecture de l'adresse courante.
//   (À l'inverse, les « Server Components » comme les pages ne peuvent pas avoir d'état.)
//
// CONTENU : petits composants réutilisés par plusieurs pages :
//   • FinanceTabs    : les onglets (Tableau de bord / Caisse / Factures / Dépenses)
//   • FinanceFilters : les listes « Période » et « Centre »
//   • ExportMenu     : le menu « Exporter »
//   • StatTile       : une carte d'indicateur avec sa variation ▲▼
//   • BarList        : un classement en barres horizontales
//   • Panel          : un encadré avec titre
//
// RAPPEL REACT : un composant est une fonction qui renvoie du JSX (du HTML dans du JavaScript).
//   Les « props » sont ses paramètres. Un « hook » (useState, useRouter…) est une fonction spéciale
//   qui commence par « use » et donne au composant de la mémoire ou l'accès à des informations.
//
// TRADUCTION : `t("texte français")` renvoie le texte arabe si la langue choisie est l'arabe
//   (dictionnaire dans lib/i18n-ar.ts). Le texte français sert de clé.
// ═══════════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtMoney } from "@/lib/booking/format";
import type { Role } from "@/lib/enums";

// Éléments d'interface partagés du Module 6 : onglets, filtres, indicateurs, barres.

// Liste des onglets : adresse, libellé, et rôles qui ont le droit de le voir.
// (Le staff ne voit que « Caisse ».)
const TABS = [
  { href: "/dashboard/finances", label: "Tableau de bord", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/caisse", label: "Caisse", roles: ["OWNER", "MANAGER", "STAFF"] },
  { href: "/dashboard/finances/paiements", label: "Paiements", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/factures", label: "Factures", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/depenses", label: "Dépenses", roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/parametres", label: "Paramètres", roles: ["OWNER"] },
];

// Barre d'onglets. Elle reçoit le rôle de l'utilisateur pour n'afficher que ses onglets.
export function FinanceTabs({ role }: { role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname(); // adresse courante (« /dashboard/finances/caisse ») → pour surligner l'onglet actif
  const tabs = TABS.filter((tab) => tab.roles.includes(role));
  // Un seul onglet (cas du staff) : inutile d'afficher une barre d'onglets.
  if (tabs.length < 2) return null;
  return (
    <div className="mt-6 flex gap-1 overflow-x-auto border-b border-white/10 [scrollbar-width:none]">
      {tabs.map((tab) => {
        // Onglet « Tableau de bord » : actif seulement sur l'adresse EXACTE (sinon il serait actif partout,
        // car toutes les autres adresses commencent aussi par /dashboard/finances). Les autres : « commence par ».
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

// Style commun des listes déroulantes et champs (classes Tailwind CSS, un framework de style par classes utilitaires).
export const selectClass =
  "rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none transition focus:border-rose-gold/60 [&>option]:bg-plum-950";

// Filtres en une ligne au-dessus des graphiques : période et centre (dans l'URL, partageable).
// PRINCIPE : le filtre choisi est écrit dans l'ADRESSE (?period=30d&center=abc). La page serveur
// relit l'adresse et recalcule. Avantage : on peut partager le lien ou revenir en arrière.
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
  children?: ReactNode; // contenu supplémentaire à droite (le menu d'export)
}) {
  const { t } = useI18n();
  const router = useRouter(); // permet de changer l'adresse par programme
  const pathname = usePathname();
  const params = useSearchParams(); // paramètres actuels de l'adresse
  // `useTransition` : marque le changement d'adresse comme « non urgent » ; `pending` vaut true pendant
  // que la page se recalcule (on affiche alors la petite roue qui tourne).
  const [pending, startTransition] = useTransition();

  // Modifie UN paramètre de l'adresse en conservant les autres, puis remplace l'adresse (replace =
  // sans ajouter d'entrée dans l'historique ; scroll:false = ne remonte pas en haut de la page).
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      {/* Liste des périodes. `aria-label` décrit le champ aux lecteurs d'écran (accessibilité). */}
      <select aria-label={t("Période")} value={period} onChange={(e) => update("period", e.target.value)} className={selectClass}>
        {periods.map((p) => (
          <option key={p.key} value={p.key}>
            {t(p.label)}
          </option>
        ))}
      </select>
      {/* Liste des centres : seulement s'il y en a plusieurs (« Tous » = vue consolidée). */}
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
      {/* Petite roue de chargement pendant le recalcul. */}
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
      <div className="ms-auto flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Menu d'export (F6.6).
// Chaque entrée est un simple LIEN vers la route /api/finance/export avec les bons paramètres :
// le navigateur télécharge le fichier (pas besoin de JavaScript pour le téléchargement lui-même).
export function ExportMenu({ query }: { query: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); // le menu est-il déployé ?
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
      {/* Menu affiché seulement si `open` est vrai (rendu conditionnel). `end-0` = aligné sur le bord de fin (marche en arabe aussi). */}
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
// Exemple : CA +12 % → vert (hausse = bien) ; dépenses +12 % → rouge (`upIsGood={false}`).
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
      // Division par zéro impossible : on affiche « pas de comparaison ».
      delta = <span className="text-white/40">{t("pas de comparaison")}</span>;
    } else {
      // Variation relative : (nouveau − ancien) ÷ |ancien|. `Math.abs` gère les valeurs négatives (résultat en perte).
      const change = (current - previous) / Math.abs(previous);
      // `good` : true (bonne nouvelle), false (mauvaise) ou null (aucun changement).
      // `(change > 0) === upIsGood` : une hausse est une bonne nouvelle seulement si « hausse = bien ».
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
// La longueur de chaque barre est proportionnelle à son montant par rapport au plus grand (`max` = 100 %).
export function BarList({
  rows,
  empty,
  translateLabels = false,
}: {
  rows: { key: string; label: string; amount: number; detail?: string }[];
  empty: string;
  translateLabels?: boolean; // faut-il traduire les libellés ? (oui pour les catégories, non pour les noms de prestations)
}) {
  const { t, lang } = useI18n();
  // Aucune donnée : message au lieu d'un graphique vide.
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-white/45">{t(empty)}</p>;
  // Plus grand montant de la liste (au moins 1, pour éviter une division par zéro).
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        // `title` = bulle d'information affichée au survol de la souris (accessibilité + précision).
        <li key={r.key} className="group" title={`${translateLabels ? t(r.label) : r.label} · ${fmtMoney(r.amount, lang)}${r.detail ? ` · ${r.detail}` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-white/80">{translateLabels ? t(r.label) : r.label}</span>
            <span className="shrink-0 tabular-nums text-white">
              {fmtMoney(r.amount, lang)}
              {r.detail && <span className="ms-1.5 text-xs text-white/40">{r.detail}</span>}
            </span>
          </div>
          {/* Piste grise ; la barre colorée à l'intérieur a une largeur en % (minimum 2 % pour rester visible). */}
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

// Encadré « verre dépoli » avec un titre et un sous-titre (conteneur utilisé par toutes les sections du tableau de bord).
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
