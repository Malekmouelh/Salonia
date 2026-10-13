import Link from "next/link";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { ArrowRightIcon, SparkleIcon } from "@/components/ui/icons";
import { Logo } from "@/components/ui/logo";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <Aurora />
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-6 sm:px-8 animate-fade-up">
        <Logo size={38} />
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <Link href="/login" className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm text-white/80 backdrop-blur transition hover:border-rose-gold/50 hover:text-white">
            <T>Connexion</T>
          </Link>
        </div>
      </header>

      <section className="stagger relative mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-champagne/90">
          <SparkleIcon width={14} height={14} /> <T>Salons de beauté & coiffure</T>
        </p>
        <h1 className="mt-6 font-display text-5xl leading-[1.1] text-white sm:text-7xl">
          <T>Gérez, sublimez,</T> <span className="text-gradient italic"><T>développez.</T></span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-white/60">
          <T>Réservations, équipe, stock, paiements et IA : un seul outil pour votre salon, de l&apos;établissement unique à la marque multi-centres.</T>
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/register" className="btn-shine group flex h-14 items-center justify-center gap-2 rounded-2xl px-8 font-semibold text-plum-950">
            <T>Créer mon salon</T> <ArrowRightIcon className="transition-transform rtl:-scale-x-100 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
          </Link>
          <Link href="/login" className="flex h-14 items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-8 text-white/80 backdrop-blur transition hover:bg-white/10 hover:text-white">
            <T>J&apos;ai déjà un compte</T>
          </Link>
        </div>
      </section>
    </main>
  );
}
