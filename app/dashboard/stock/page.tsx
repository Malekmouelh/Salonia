import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { StockHub } from "@/components/stock/stock-hub";
import { PageIntro, StockTabs } from "@/components/stock/stock-shared";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getStockHubData } from "@/lib/data/stock";

export const metadata: Metadata = { title: "Matériel et stock" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Module 5 — Vue d'ensemble du stock (propriétaire et gérant). Les lectures passent par les services du stock, qui appliquent le rôle,
// l'organisation et les centres autorisés ; tout autre rôle est renvoyé vers le tableau de bord.
export default function StockPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Stock searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Stock({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireRole("OWNER", "MANAGER"), searchParams]);
  const data = await getStockHubData(user, typeof params.center === "string" ? params.center : undefined);
  return (
    <>
      <DashboardHeader user={user} />
      <PageIntro title="Matériel et" accent="stock" subtitle="Produits, niveaux par centre, alertes de seuil et mouvements." />
      <StockTabs role={user.role} />
      <StockHub {...data} centers={data.centers} />
    </>
  );
}
