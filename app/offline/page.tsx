import type { Metadata } from "next";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { LogoMark } from "@/components/ui/logo";

export const metadata: Metadata = { title: "Hors connexion" };

export default function OfflinePage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <Aurora />
      <div className="glass glow-border relative max-w-md rounded-[2rem] p-10 text-center animate-fade-up">
        <div className="mx-auto w-fit animate-float">
          <LogoMark size={64} />
        </div>
        <h1 className="mt-6 font-display text-3xl text-white">
          <T>Vous êtes</T> <span className="text-gradient italic"><T>hors ligne</T></span>
        </h1>
        <p className="mt-3 text-white/60">
          <T>Pas de panique : vos actions seront synchronisées dès le retour de la connexion.</T>
        </p>
      </div>
    </main>
  );
}
