import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { BlockchainExplorer } from "@/components/escrow/blockchain-explorer";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getBlockchainExplorer } from "@/lib/escrow/explorer";

export const metadata: Metadata = { title: "Blockchain" };

// SalonEscrow — explorateur de blocs : TOUTES les transactions de la blockchain (tous comptes confondus),
// pour l'administrateur et le propriétaire. Lecture seule.
export default function BlockchainPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-5xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Explorer />
        </Suspense>
      </div>
    </main>
  );
}

async function Explorer() {
  // Droits vérifiés côté serveur : tout autre rôle est renvoyé vers le tableau de bord.
  const user = await requireRole("SUPER_ADMIN", "OWNER");
  const data = await getBlockchainExplorer(user);
  return (
    <>
      <DashboardHeader user={user} />
      {data === null ? (
        <p className="glass mt-6 rounded-[2rem] p-8 text-center text-white/60">
          <T>L&apos;acompte sécurisé n&apos;est pas activé sur ce serveur.</T>
        </p>
      ) : "error" in data ? (
        <p className="glass mt-6 rounded-[2rem] p-8 text-center text-red-200">
          <T>{data.error}</T>
        </p>
      ) : (
        <BlockchainExplorer data={data} />
      )}
    </>
  );
}
