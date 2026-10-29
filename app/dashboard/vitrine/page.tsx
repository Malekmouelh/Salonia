import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { Aurora } from "@/components/ui/aurora";
import { AdminVitrineView } from "@/components/vitrine/admin-vitrine-view";
import { requireRole } from "@/lib/dal";
import { getAdminVitrineData } from "@/lib/vitrine/service";

export const metadata: Metadata = {
  title: "Vitrine & Personnalisation · Tableau de bord",
};

// Next.js 16 : la session et les données sont lues à la requête, donc dans un <Suspense>.
export default function DashboardVitrinePage() {
  return (
    <main className="relative min-h-dvh overflow-x-clip bg-plum-950 pb-16">
      <Aurora />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Vitrine />
        </Suspense>
      </div>
    </main>
  );
}

async function Vitrine() {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) {
    redirect("/dashboard");
  }

  const data = await getAdminVitrineData(user.organization.id);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6">
        <AdminVitrineView data={data} />
      </div>
    </>
  );
}
