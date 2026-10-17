import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { CashDesk } from "@/components/finance/cash-desk";
import { FinanceTabs } from "@/components/finance/finance-ui";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getCatalog } from "@/lib/data/bookings";
import { getCashDesk, resolveFinanceCenter } from "@/lib/data/finance";
import { canCollect, canViewFinance, financeCenterIds } from "@/lib/finance/service";

export const metadata: Metadata = { title: "Caisse" };

export default function CashDeskPage({ searchParams }: PageProps<"/dashboard/finances/caisse">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Desk searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Desk({ searchParams }: { searchParams: PageProps<"/dashboard/finances/caisse">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canCollect(user) || !user.organization) redirect("/dashboard");
  const centerId = resolveFinanceCenter(user, typeof params.center === "string" ? params.center : null);
  if (!centerId) redirect("/dashboard");
  const day = typeof params.day === "string" ? params.day : undefined;

  const [desk, catalog] = await Promise.all([getCashDesk(user, centerId, day), getCatalog(user.organization.id, centerId)]);
  if (!desk) redirect("/dashboard");
  const allowed = financeCenterIds(user);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>La</T> <span className="text-gradient italic"><T>caisse</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>
            {user.role === "STAFF"
              ? "Encaissez vos rendez-vous : espèces, carte ou paiement mobile."
              : "Encaissements, acomptes, liens de paiement et clôture de caisse du jour."}
          </T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      <CashDesk
        key={`${centerId}-${desk.day}`}
        centers={user.organization.centers.filter((c) => allowed.includes(c.id)).map((c) => ({ id: c.id, name: c.name }))}
        centerId={centerId}
        day={desk.day}
        today={desk.today}
        unpaid={desk.unpaid}
        upcoming={desk.upcoming}
        payments={desk.payments}
        totals={desk.totals}
        totalTnd={desk.totalTnd}
        canManage={canViewFinance(user)}
        services={catalog.services}
      />
    </>
  );
}
