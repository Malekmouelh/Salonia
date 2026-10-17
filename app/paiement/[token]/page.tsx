import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OnlineCheckout } from "@/components/finance/online-checkout";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { LogoMark } from "@/components/ui/logo";
import { getPaymentLink } from "@/lib/data/finance";

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
  const { token } = await params;
  const link = await getPaymentLink(token);

  return (
    <>
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-3 transition hover:opacity-80" aria-label="Accueil">
          <LogoMark size={36} />
          <span className="font-display text-xl text-white">{link?.salon ?? "Salonia"}</span>
        </Link>
        <LanguageToggle />
      </header>
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
