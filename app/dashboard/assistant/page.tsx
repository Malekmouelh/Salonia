import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupAssistant } from "@/components/assistant/setup-assistant";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Assistant IA" };

export default function AssistantPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="h-24" />}>
          <Header />
        </Suspense>

        <section className="mx-auto mb-10 mt-8 max-w-3xl text-center stagger">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#c9a0dc]/30 bg-[#c9a0dc]/10 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-[#e6d0f0]">
            <T>Assistant de configuration</T>
          </p>
          <h1 className="mt-5 font-display text-4xl leading-tight text-white sm:text-6xl">
            <T>Décrivez votre salon,</T> <span className="text-gradient italic"><T>l&apos;IA s&apos;occupe du reste.</T></span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/60">
            <T>Centres, horaires, catalogue et équipe pré-remplis en quelques secondes. Vous gardez la main sur chaque détail.</T>
          </p>
        </section>

        <SetupAssistant />
      </div>
    </main>
  );
}

// Seul le propriétaire accède à l'assistant.
async function Header() {
  const user = await requireRole("OWNER");
  return <DashboardHeader user={user} />;
}
