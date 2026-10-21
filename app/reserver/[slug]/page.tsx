import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { LogoMark } from "@/components/ui/logo";
import { decodeDraft } from "@/lib/booking/draft";
import { getBookingClient } from "@/lib/data/booking-client";
import { getPublicSalon } from "@/lib/data/public-salon";

export async function generateMetadata({ params }: PageProps<"/reserver/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const salon = await getPublicSalon(slug);
  return {
    title: salon ? `Réserver chez ${salon.name}` : "Réservation",
    description: salon ? `Réservez en ligne votre rendez-vous chez ${salon.name} en moins d'une minute.` : undefined,
  };
}

export default function PublicBookingPage({ params, searchParams }: PageProps<"/reserver/[slug]">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora />
      <div className="relative mx-auto max-w-5xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-[60vh] animate-pulse rounded-[2rem] bg-white/5" />}>
          <Wizard params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Wizard({
  params,
  searchParams,
}: {
  params: PageProps<"/reserver/[slug]">["params"];
  searchParams: PageProps<"/reserver/[slug]">["searchParams"];
}) {
  const { slug } = await params;
  const [salon, client, query] = await Promise.all([getPublicSalon(slug), getBookingClient(), searchParams]);
  if (!salon) notFound();
  // Retour de connexion / inscription : la réservation en cours est reprise à l'étape de confirmation.
  const draft = decodeDraft(query.reprise);

  return (
    <>
      <header className="flex items-center justify-between py-6 animate-fade-up">
        <Link href="/" className="flex items-center gap-3 transition hover:opacity-80" aria-label="Accueil">
          <LogoMark size={40} />
          <div>
            <p className="font-display text-2xl text-white">{salon.name}</p>
            <p className="text-xs text-white/50">{salon.centers.map((c) => c.name.split("—")[1]?.trim() ?? c.name).join(" · ")}</p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          {client && (
            <Link href="/dashboard" className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur transition hover:border-rose-gold/50 hover:text-white">
              <T>{client.kind === "client" ? "Mon espace" : "Tableau de bord"}</T>
            </Link>
          )}
          <LanguageToggle />
        </div>
      </header>
      <BookingWizard salon={salon} client={client} draft={draft && salon.centers.some((c) => c.id === draft.centerId) ? draft : null} />
    </>
  );
}
