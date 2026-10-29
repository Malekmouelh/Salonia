// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/finances/paiements/page.tsx — PAGE « PAIEMENTS » (F6.1, F6.2)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/finances/paiements?period=month&center=all&q=REC-2026&method=CASH&status=PAID
// Propriétaire et gérant. Deux sections :
//   1. le REGISTRE de tous les paiements (recherche, filtres, remboursement, annulation de lien en attente) ;
//   2. l'historique des CLÔTURES de caisse (compté, attendu, écart).
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { ExportMenu, FinanceFilters, FinanceTabs } from "@/components/finance/finance-ui";
import { ClosingHistory, PaymentHistory } from "@/components/finance/payment-history";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { dayKey } from "@/lib/booking/time";
import { getCurrentUser } from "@/lib/dal";
import { listPaymentHistory } from "@/lib/data/finance";
import { listClosings } from "@/lib/finance/closing";
import { PERIODS, financeScope, resolveRange } from "@/lib/finance/reports";
import { canViewFinance } from "@/lib/finance/service";

export const metadata: Metadata = { title: "Paiements" };

// Coquille de la page (squelette de chargement pendant le calcul).
export default function PaymentsPage({ searchParams }: PageProps<"/dashboard/finances/paiements">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Payments searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Payments({ searchParams }: { searchParams: PageProps<"/dashboard/finances/paiements">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canViewFinance(user)) redirect("/dashboard/finances/caisse");
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const center = str(params.center) || "all";
  const range = resolveRange(str(params.period) || "month");
  const scope = financeScope(user);
  if (!scope) redirect("/dashboard");

  // Registre des paiements et historique des clôtures lus en parallèle.
  const [rows, closings] = await Promise.all([
    listPaymentHistory(user, {
      q: str(params.q),
      method: str(params.method),
      kind: str(params.kind),
      status: str(params.status),
      centerId: center === "all" ? undefined : center,
      from: range.from,
      to: range.to,
    }),
    listClosings(user, { centerId: center === "all" ? undefined : center, fromDay: dayKey(range.from) }),
  ]);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Les</T> <span className="text-gradient italic"><T>paiements</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Registre des encaissements, acomptes, remboursements et liens de paiement, et clôtures de caisse.</T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      <FinanceFilters periods={PERIODS} period={range.key} centers={scope.centers} center={center}>
        <ExportMenu query={`period=${range.key}&center=${center}`} />
      </FinanceFilters>
      <PaymentHistory rows={rows} initialQuery={str(params.q)} filters={{ method: str(params.method), kind: str(params.kind), status: str(params.status) }} />
      <h2 className="mb-3 mt-10 font-display text-2xl text-white">
        <T>Clôtures de caisse</T>
      </h2>
      <ClosingHistory rows={closings} />
    </>
  );
}
