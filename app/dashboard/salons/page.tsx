import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { SalonDirectory } from "@/components/salons/salon-directory";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getSalonDirectory } from "@/lib/data/salons";

export const metadata: Metadata = { title: "Trouver un salon" };

// Espace client : tous les salons de la plateforme, à consulter puis réserver.
export default function SalonsPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Salons />
        </Suspense>
      </div>
    </main>
  );
}

async function Salons() {
  const [user, salons] = await Promise.all([getCurrentUser(), getSalonDirectory()]);
  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 mb-8 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Trouver un</T> <span className="text-gradient italic"><T>salon</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Comparez les salons près de chez vous, consultez leurs prestations et réservez en ligne.</T>
        </p>
      </div>
      <SalonDirectory salons={salons} />
    </>
  );
}
