"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { T } from "@/components/i18n/i18n-provider";
import { AlertIcon } from "@/components/ui/icons";

// Fallback de <Suspense> sensible à la connexion : squelette en ligne. Hors ligne, la page n'est pas
// dans le cache client (sinon Next.js l'aurait affichée sans attendre) : un message clair remplace le
// chargement sans fin, et experimental.useOffline charge la page au retour du réseau.
export function OfflineFallback({ children }: { children: ReactNode }) {
  const offline = useOffline();
  const router = useRouter();
  if (!offline) return <>{children}</>;

  return (
    <div role="status" className="glass mx-auto mt-24 max-w-lg rounded-[2rem] p-8 text-center animate-fade-up">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
        <AlertIcon width={24} height={24} />
      </span>
      <h2 className="mt-4 font-display text-2xl text-white">
        <T>Page indisponible hors ligne</T>
      </h2>
      <p className="mt-2 text-sm text-white/60">
        <T>{"Cette page n'a pas été consultée récemment avec une connexion : ses données ne sont pas disponibles sur cet appareil."}</T>
      </p>
      <p className="mt-2 text-sm text-white/60">
        <T>Elle se chargera automatiquement dès le retour du réseau.</T>
      </p>
      <button
        type="button"
        onClick={() => router.back()}
        className="mt-6 rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
      >
        <T>Revenir à la page précédente</T>
      </button>
    </div>
  );
}
