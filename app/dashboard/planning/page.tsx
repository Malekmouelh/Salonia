import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { PlanningView } from "@/components/team/planning-view";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getStaffPlanning } from "@/lib/data/planning";

export const metadata: Metadata = { title: "Planning" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// F4 — Planning personnel, en LECTURE SEULE : un STAFF voit le sien ; un propriétaire ou un gérant celui d'un employé
// (?staff=<id>) dans les limites de ses droits. Aucune écriture : les actions sur les rendez-vous restent dans le calendrier.
export default function PlanningPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-4xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Planning searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Planning({ searchParams }: { searchParams: SearchParams }) {
  // Droits vérifiés côté serveur : tout autre rôle est renvoyé vers le tableau de bord.
  const [user, params] = await Promise.all([requireRole("STAFF", "OWNER", "MANAGER"), searchParams]);
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const staffId = str(params.staff);
  // Propriétaire et gérant choisissent un employé depuis la liste de l'équipe.
  if (user.role !== "STAFF" && !staffId) redirect("/dashboard/equipe");

  // Pour un STAFF, « ?staff= » est ignoré : getStaffPlanning ne lit que son propre planning.
  const result = await getStaffPlanning(user, { staffId, week: str(params.week) });

  return (
    <>
      <DashboardHeader user={user} />
      {result.ok ? (
        <PlanningView planning={result.planning} />
      ) : (
        <div className="glass mt-8 rounded-[2rem] p-10 text-center text-white/60">
          <p><T>Employé introuvable.</T></p>
          {user.role !== "STAFF" && (
            <Link href="/dashboard/equipe" className="mt-3 inline-block text-sm text-rose-gold hover:text-champagne">
              <T>Retour à l&apos;équipe</T>
            </Link>
          )}
        </div>
      )}
    </>
  );
}
