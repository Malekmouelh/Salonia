import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { OrdersManager } from "@/components/stock/orders-manager";
import { PageIntro, StockTabs } from "@/components/stock/stock-shared";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getOrdersPageData } from "@/lib/data/stock";

export const metadata: Metadata = { title: "Commandes d'achat" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// F5.5 — Commandes d'achat et réception (propriétaire : tous les centres ; gérant : ses centres).
export default function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Orders searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireRole("OWNER", "MANAGER"), searchParams]);
  const data = await getOrdersPageData(user, typeof params.center === "string" ? params.center : undefined);
  return (
    <>
      <DashboardHeader user={user} />
      <PageIntro title="Commandes" accent="d'achat" subtitle="Réapprovisionnement des centres : brouillons, commandes et réceptions." />
      <StockTabs role={user.role} />
      <OrdersManager {...data} />
    </>
  );
}
