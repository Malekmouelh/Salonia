import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { MaterielManager } from "@/components/stock/materiel-manager";
import { PageIntro, StockTabs } from "@/components/stock/stock-shared";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getEquipmentPageData } from "@/lib/data/stock";

export const metadata: Metadata = { title: "Matériel" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// F5.1 / F5.4 — Matériel et maintenance (propriétaire : tous les centres ; gérant : ses centres).
export default function MaterielPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Materiel searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Materiel({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireRole("OWNER", "MANAGER"), searchParams]);
  const data = await getEquipmentPageData(user, typeof params.center === "string" ? params.center : undefined);
  return (
    <>
      <DashboardHeader user={user} />
      <PageIntro title="Matériel et" accent="maintenance" subtitle="Inventaire des équipements de chaque centre, échéances et interventions." />
      <StockTabs role={user.role} />
      <MaterielManager {...data} />
    </>
  );
}
