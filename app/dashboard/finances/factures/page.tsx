// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/finances/factures/page.tsx — LA PAGE « FACTURES » (F6.3)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/finances/factures?period=month&center=all&q=dupont&status=PAID
//   Liste des factures du salon (propriétaire et gérant). Les filtres sont dans l'ADRESSE : on peut
//   partager un lien filtré, et le bouton « Précédent » du navigateur fonctionne naturellement.
//   Le composant interactif <InvoiceList> (components/finance/invoice-list.tsx) affiche le tableau.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { ExportMenu, FinanceFilters, FinanceTabs } from "@/components/finance/finance-ui";
import { InvoiceList } from "@/components/finance/invoice-list";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { listInvoices } from "@/lib/data/finance";
import { PERIODS, financeScope, resolveRange } from "@/lib/finance/reports";
import { canViewFinance } from "@/lib/finance/service";

export const metadata: Metadata = { title: "Factures" };

// Coquille de la page (squelette de chargement pendant le calcul).
export default function InvoicesPage({ searchParams }: PageProps<"/dashboard/finances/factures">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Invoices searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Invoices({ searchParams }: { searchParams: PageProps<"/dashboard/finances/factures">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  // Le staff n'a pas accès aux factures : on le renvoie vers sa caisse.
  if (!canViewFinance(user)) redirect("/dashboard/finances/caisse");
  // Ici, un paramètre absent donne une chaîne vide (plus pratique pour un champ de recherche).
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const center = str(params.center) || "all";
  const range = resolveRange(str(params.period) || "month");
  // La liste est filtrée côté base de données (texte recherché, statut, centre, période).
  const invoices = await listInvoices(user, {
    q: str(params.q),
    status: str(params.status),
    centerId: center === "all" ? undefined : center,
    from: range.from,
    to: range.to,
    limit: 300,
  });

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Les</T> <span className="text-gradient italic"><T>factures</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Factures numérotées, émises automatiquement à chaque règlement complet.</T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      <FinanceFilters periods={PERIODS} period={range.key} centers={financeScope(user)?.centers ?? []} center={center}>
        <ExportMenu query={`period=${range.key}&center=${center}`} />
      </FinanceFilters>
      {/* Seul le propriétaire voit le bouton « Annuler » une facture (`canCancel`). */}
      <InvoiceList invoices={invoices} initialQuery={str(params.q)} status={str(params.status)} canCancel={user.role === "OWNER"} />
    </>
  );
}
