import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { InsightsPanel } from "@/components/stock/insights-panel";
import { PageIntro, StockTabs } from "@/components/stock/stock-shared";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getInsightsPageData } from "@/lib/data/stock";

export const metadata: Metadata = { title: "Analyses IA du stock" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// F5 (IA) — Analyse de la consommation entre centres : propriétaire (tous les centres) et gérant (ses centres) ; les autres rôles sont renvoyés
// vers le tableau de bord. Les chiffres viennent du journal ; l'interprétation par Gemini n'est demandée que sur clic.
export default function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Insights searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Insights({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireRole("OWNER", "MANAGER"), searchParams]);
  const data = await getInsightsPageData(user, typeof params.days === "string" ? params.days : undefined);
  return (
    <>
      <DashboardHeader user={user} />
      <PageIntro title="Analyses de" accent="consommation" subtitle="Comparez vos centres, repérez les écarts et les risques : les chiffres viennent du journal du stock, l'IA aide à les interpréter." />
      <StockTabs role={user.role} />
      <InsightsPanel {...data} />
    </>
  );
}
