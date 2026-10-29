import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { RecipesManager } from "@/components/stock/recipes-manager";
import { PageIntro, StockTabs } from "@/components/stock/stock-shared";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getRecipesPageData } from "@/lib/data/stock";

export const metadata: Metadata = { title: "Recettes de consommation" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// F5.3 — Recettes par service : propriétaire seulement (les autres rôles sont renvoyés vers le tableau de bord).
export default function RecipesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Recipes searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Recipes({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireRole("OWNER"), searchParams]);
  const data = await getRecipesPageData(user, typeof params.service === "string" ? params.service : undefined);
  return (
    <>
      <DashboardHeader user={user} />
      <PageIntro title="Recettes de" accent="consommation" subtitle="Produits et quantités consommés par chaque prestation." />
      <StockTabs role={user.role} />
      <RecipesManager {...data} />
    </>
  );
}
