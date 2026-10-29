import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/header";
import { Aurora } from "@/components/ui/aurora";
import { AdminVitrineView } from "@/components/vitrine/admin-vitrine-view";
import { requireRole } from "@/lib/dal";
import { getAdminVitrineData } from "@/lib/vitrine/service";

export const metadata: Metadata = {
  title: "Vitrine & Personnalisation · Tableau de bord",
};

export default async function DashboardVitrinePage() {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) {
    redirect("/dashboard");
  }

  const data = await getAdminVitrineData(user.organization.id);

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-plum-950 pb-16">
      <Aurora />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <DashboardHeader user={user} />
        <div className="mt-6">
          <AdminVitrineView data={data} />
        </div>
      </div>
    </main>
  );
}
