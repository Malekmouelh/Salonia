import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { PageIntro, StockTabs } from "@/components/stock/stock-shared";
import { SuppliersManager } from "@/components/stock/suppliers-manager";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getSuppliersPageData } from "@/lib/data/stock";

export const metadata: Metadata = { title: "Fournisseurs" };

// F5.5 — Fournisseurs : le propriétaire les gère, le gérant les consulte (règle du service, pas seulement de l'interface).
export default function SuppliersPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Suppliers />
        </Suspense>
      </div>
    </main>
  );
}

async function Suppliers() {
  const user = await requireRole("OWNER", "MANAGER");
  const data = await getSuppliersPageData(user);
  return (
    <>
      <DashboardHeader user={user} />
      <PageIntro title="Les" accent="fournisseurs" subtitle="Coordonnées et délais de livraison de vos fournisseurs." />
      <StockTabs role={user.role} />
      <SuppliersManager {...data} />
    </>
  );
}
