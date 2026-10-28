// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/finances/depenses/page.tsx — LA PAGE « DÉPENSES » (F6.4)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/finances/depenses?period=month&center=all
//   Suivi des dépenses (loyer, produits, salaires…) de chaque centre. Propriétaire et gérant.
//   Le composant interactif <ExpenseManager> (components/finance/expense-manager.tsx) gère l'ajout,
//   la modification et la suppression.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { ExpenseManager } from "@/components/finance/expense-manager";
import { ExportMenu, FinanceFilters, FinanceTabs } from "@/components/finance/finance-ui";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { listExpenses } from "@/lib/data/finance";
import { PERIODS, financeScope, resolveRange } from "@/lib/finance/reports";
import { canViewFinance } from "@/lib/finance/service";

export const metadata: Metadata = { title: "Dépenses" };

// Coquille de la page (squelette de chargement pendant le calcul).
export default function ExpensesPage({ searchParams }: PageProps<"/dashboard/finances/depenses">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Expenses searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Expenses({ searchParams }: { searchParams: PageProps<"/dashboard/finances/depenses">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canViewFinance(user)) redirect("/dashboard/finances/caisse");
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const center = str(params.center) || "all";
  const range = resolveRange(str(params.period) || "month");
  // Périmètre de l'utilisateur (tous ses centres) : sert aux listes déroulantes et à la valeur par défaut.
  const scope = financeScope(user);
  if (!scope) redirect("/dashboard");
  const expenses = await listExpenses(user, { centerId: center === "all" ? undefined : center, from: range.from, to: range.to });

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Les</T> <span className="text-gradient italic"><T>dépenses</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Loyer, produits, salaires et charges de chaque centre.</T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      <FinanceFilters periods={PERIODS} period={range.key} centers={scope.centers} center={center}>
        <ExportMenu query={`period=${range.key}&center=${center}`} />
      </FinanceFilters>
      {/* `defaultCenter` : centre présélectionné dans le formulaire (celui filtré, sinon le premier).
          `canEditSalaries` : seul le propriétaire peut saisir/modifier des salaires. */}
      <ExpenseManager
        expenses={expenses}
        centers={scope.centers}
        defaultCenter={center !== "all" && scope.centers.some((c) => c.id === center) ? center : scope.centers[0].id}
        canEditSalaries={user.role === "OWNER"}
      />
    </>
  );
}
