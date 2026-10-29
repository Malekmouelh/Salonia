// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/finances/caisse/page.tsx — LA PAGE « CAISSE » (F6.1)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/finances/caisse?center=<id>&day=2026-10-17
//   La caisse est la seule page du module accessible à TOUS les rôles « terrain » (propriétaire,
//   gérant ET staff). C'est un Server Component : il charge les données puis les passe au composant
//   interactif <CashDesk> (components/finance/cash-desk.tsx), qui gère les boutons et les fenêtres.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { CashDesk } from "@/components/finance/cash-desk";
import { FinanceTabs } from "@/components/finance/finance-ui";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getCatalog } from "@/lib/data/bookings";
import { getCashDesk, resolveFinanceCenter } from "@/lib/data/finance";
import { getClosingState } from "@/lib/finance/closing";
import { getFinanceSettings } from "@/lib/finance/settings";
import { canCollect, canViewFinance, financeCenterIds } from "@/lib/finance/service";

export const metadata: Metadata = { title: "Caisse" };

// Coquille de la page : fond, conteneur et squelette de chargement (même structure sur toutes les pages).
export default function CashDeskPage({ searchParams }: PageProps<"/dashboard/finances/caisse">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Desk searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Desk({ searchParams }: { searchParams: PageProps<"/dashboard/finances/caisse">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  // Un client (ou un compte sans salon) n'a rien à faire ici : retour au tableau de bord.
  if (!canCollect(user) || !user.organization) redirect("/dashboard");
  // Centre affiché : celui de l'adresse s'il est autorisé, sinon le premier centre de l'utilisateur.
  const centerId = resolveFinanceCenter(user, typeof params.center === "string" ? params.center : null);
  if (!centerId) redirect("/dashboard");
  const day = typeof params.day === "string" ? params.day : undefined;

  // Deux lectures en parallèle : données de la caisse + catalogue de services (pour la « vente directe »,
  // qui propose de choisir une prestation du catalogue du module 2).
  const [desk, catalog] = await Promise.all([getCashDesk(user, centerId, day), getCatalog(user.organization.id, centerId)]);
  if (!desk) redirect("/dashboard");
  const allowed = financeCenterIds(user);
  // Paramètres du salon (acompte par défaut, paiement en ligne, droit d'encaisser du staff).
  const settings = await getFinanceSettings(user.organization.id);
  const staffBlocked = user.role === "STAFF" && !settings.staffCanCollect;
  // État de la clôture du jour : réservé à la gestion (le staff ne clôture pas la caisse).
  const closingState = canViewFinance(user) ? await getClosingState(user, centerId, desk.day) : null;

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>La</T> <span className="text-gradient italic"><T>caisse</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          {/* Le sous-titre change selon le rôle (le staff n'a que les encaissements simples). */}
          <T>
            {user.role === "STAFF"
              ? "Encaissez vos rendez-vous : espèces, carte ou paiement mobile."
              : "Encaissements, acomptes, liens de paiement et clôture de caisse du jour."}
          </T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      {/* Le propriétaire a retiré le droit d'encaisser au staff : on l'explique au lieu d'afficher une caisse inutilisable. */}
      {staffBlocked ? (
        <p className="glass mt-6 rounded-[2rem] p-8 text-center text-white/60">
          <T>L&apos;encaissement par le staff est désactivé. Adressez-vous au gérant.</T>
        </p>
      ) : (
        // `key` change quand le centre ou le jour change : React recrée alors le composant à zéro
        // (ferme les fenêtres ouvertes, réinitialise l'état) au lieu de garder des données périmées.
        // `canManage` = peut-on afficher les boutons réservés à la gestion (remise, remboursement, vente directe) ?
        <CashDesk
          key={`${centerId}-${desk.day}`}
          centers={user.organization.centers.filter((c) => allowed.includes(c.id)).map((c) => ({ id: c.id, name: c.name }))}
          centerId={centerId}
          day={desk.day}
          today={desk.today}
          unpaid={desk.unpaid}
          upcoming={desk.upcoming}
          payments={desk.payments}
          totals={desk.totals}
          totalTnd={desk.totalTnd}
          canManage={canViewFinance(user)}
          services={catalog.services}
          depositPercent={settings.defaultDepositPercent}
          onlineEnabled={settings.onlinePaymentsEnabled}
          closingState={closingState}
          isOwner={user.role === "OWNER"}
        />
      )}
    </>
  );
}
