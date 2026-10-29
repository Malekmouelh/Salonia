// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/paiement/[token]/page.tsx — LA PAGE DE PAIEMENT EN LIGNE DU CLIENT (F6.2)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /paiement/<jeton>   ← le lien que le salon envoie au client (WhatsApp, SMS…)
//
// PAGE PUBLIQUE : pas de connexion requise (le client n'a pas de compte). Elle n'est volontairement
// pas sous /dashboard, donc non protégée par le middleware de session. La sécurité repose sur le
// JETON secret contenu dans l'adresse : 24 octets aléatoires, impossibles à deviner.
//
// `[token]` (crochets) = segment dynamique : la valeur dans l'adresse arrive dans `params.token`.
// La page lit les informations du lien (getPaymentLink) puis affiche le formulaire de carte
// (<OnlineCheckout>, composant interactif) ou un message si le lien est invalide.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OnlineCheckout } from "@/components/finance/online-checkout";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { LogoMark } from "@/components/ui/logo";
import { getPaymentLink } from "@/lib/data/finance";

// `robots: { index: false }` : demande aux moteurs de recherche de ne pas référencer cette page privée.
export const metadata: Metadata = { title: "Paiement en ligne", robots: { index: false } };

// F6.2 — Paiement en ligne d'un acompte ou d'un solde, depuis le lien envoyé par le salon.
export default function PaymentPage({ params }: PageProps<"/paiement/[token]">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora />
      <div className="relative mx-auto max-w-lg px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Payment params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Payment({ params }: { params: PageProps<"/paiement/[token]">["params"] }) {
  // `params` est asynchrone : on attend sa résolution pour lire le jeton.
  const { token } = await params;
  // Résumé du lien (nom du salon, prestation, montant, statut) ou null si le jeton est invalide.
  const link = await getPaymentLink(token);

  return (
    <>
      {/* En-tête minimal : logo + nom du salon + bouton de langue (FR/AR). Pas de menu : c'est un client, pas un utilisateur du salon. */}
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-3 transition hover:opacity-80" aria-label="Accueil">
          <LogoMark size={36} />
          <span className="font-display text-xl text-white">{link?.salon ?? "Salonia"}</span>
        </Link>
        <LanguageToggle />
      </header>
      {/* Lien valide : formulaire de carte. Sinon : message « lien invalide » (même message pour un jeton
          inexistant ou mal formé, afin de ne donner aucun indice à quelqu'un qui essaierait des jetons). */}
      {link ? (
        <OnlineCheckout token={token} link={link} />
      ) : (
        <div className="glass mt-10 rounded-[2rem] p-10 text-center text-white/70">
          <T>Ce lien de paiement est invalide.</T>
        </div>
      )}
    </>
  );
}
