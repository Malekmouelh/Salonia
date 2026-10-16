import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ManageBooking } from "@/components/booking/manage-booking";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { LogoMark } from "@/components/ui/logo";
import { getBookingByToken } from "@/lib/data/public-salon";

export const metadata: Metadata = { title: "Ma réservation", robots: { index: false } };

export default function ManagePage({ params }: PageProps<"/reservation/[token]">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora />
      <div className="relative mx-auto max-w-xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Manage params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Manage({ params }: { params: PageProps<"/reservation/[token]">["params"] }) {
  const { token } = await params;
  const booking = await getBookingByToken(token);

  return (
    <>
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-3 transition hover:opacity-80" aria-label="Accueil">
          <LogoMark size={36} />
          <span className="font-display text-xl text-white">{booking?.salon.name ?? "Salonia"}</span>
        </Link>
        <LanguageToggle />
      </header>
      {booking ? (
        <ManageBooking token={token} booking={booking} />
      ) : (
        <div className="glass mt-10 rounded-[2rem] p-10 text-center text-white/70">
          <T>Ce lien de réservation est invalide.</T>
        </div>
      )}
    </>
  );
}
