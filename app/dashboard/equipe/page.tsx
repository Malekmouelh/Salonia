import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { TeamList } from "@/components/team/team-list";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";
import { getSkillSuggestions, getTeamRoster } from "@/lib/data/team";

export const metadata: Metadata = { title: "Équipe" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// F4 — Équipe : liste en lecture seule du personnel (propriétaire et gérants).
export default function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Team searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Team({ searchParams }: { searchParams: SearchParams }) {
  // Droits vérifiés côté serveur : tout autre rôle est renvoyé vers le tableau de bord.
  const [user, params] = await Promise.all([requireRole("OWNER", "MANAGER"), searchParams]);
  const [roster, skillSuggestions] = await Promise.all([
    getTeamRoster(user, { centerId: typeof params.center === "string" ? params.center : null }),
    user.organization ? getSkillSuggestions(user.organization.id, { limit: 50 }) : Promise.resolve([]),
  ]);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Équipe</T> <span className="text-gradient italic"><T>du salon</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Poste, compétences et centres de chaque membre du personnel.</T>
        </p>
      </div>
      <TeamList roster={roster} skillSuggestions={skillSuggestions} />
    </>
  );
}
