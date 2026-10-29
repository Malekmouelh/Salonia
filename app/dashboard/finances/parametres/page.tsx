// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/finances/parametres/page.tsx — PARAMÈTRES FINANCIERS (propriétaire)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/finances/parametres. Réservée au PROPRIÉTAIRE : les autres rôles sont redirigés.
// La page lit les réglages actuels (ou les valeurs par défaut) et les passe au formulaire interactif.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { FinanceTabs } from "@/components/finance/finance-ui";
import { SettingsForm } from "@/components/finance/settings-form";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getFinanceSettings } from "@/lib/finance/settings";

export const metadata: Metadata = { title: "Paramètres financiers" };

export default function SettingsPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Settings />
        </Suspense>
      </div>
    </main>
  );
}

async function Settings() {
  const user = await getCurrentUser();
  // Seul le propriétaire règle la TVA, les mentions légales et les droits du staff.
  if (user.role !== "OWNER" || !user.organization) redirect("/dashboard/finances");
  const settings = await getFinanceSettings(user.organization.id);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Paramètres</T> <span className="text-gradient italic"><T>financiers</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>TVA, mentions des factures, droits d&apos;encaissement et paiement en ligne.</T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      <SettingsForm initial={settings} />
    </>
  );
}
