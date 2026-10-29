// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/mes-paiements/page.tsx — ESPACE CLIENT : « MES PAIEMENTS » (cahier §4)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/mes-paiements. Réservée au rôle CLIENT (« consulter son historique »).
// Le client retrouve SES factures et SES reçus, avec le PDF de chacun. Isolation : on ne lit que les
// documents rattachés à ses fiches client (voir clientCustomerIds dans lib/finance/service.ts), et les
// routes PDF revérifient la même chose côté serveur.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { MyPayments } from "@/components/finance/my-payments";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getMyFinance } from "@/lib/data/finance";

export const metadata: Metadata = { title: "Mes paiements" };

export default function MyPaymentsPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-4xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Content />
        </Suspense>
      </div>
    </main>
  );
}

async function Content() {
  const user = await getCurrentUser();
  if (user.role !== "CLIENT") redirect("/dashboard");
  const data = await getMyFinance(user);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Mes</T> <span className="text-gradient italic"><T>paiements</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Vos factures et vos reçus, à télécharger en PDF.</T>
        </p>
      </div>
      <MyPayments invoices={data.invoices} payments={data.payments} />
    </>
  );
}
