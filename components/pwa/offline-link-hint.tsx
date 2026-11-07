"use client";

import { createPortal } from "react-dom";
import { useLinkStatus } from "next/link";
import { useOffline } from "next/offline";
import { T } from "@/components/i18n/i18n-provider";

// À placer dans un <Link>. Hors ligne, une page jamais préchargée (toujours en développement, ou lien
// pas encore préchargé en production) laisse la navigation en attente sur l'ancienne page : ce message
// l'explique. experimental.useOffline ouvre la page au retour du réseau.
export function OfflineLinkHint() {
  const { pending } = useLinkStatus();
  const offline = useOffline();
  if (!pending || !offline) return null;

  // Portail vers <body> : le menu (backdrop-blur, overflow) couperait un élément fixe rendu sur place.
  return createPortal(
    <div role="status" className="fixed inset-x-0 top-36 z-[60] flex justify-center px-4 animate-fade-up">
      <p className="max-w-md rounded-2xl border border-amber-300/30 bg-plum-950/95 px-5 py-3 text-center text-sm text-amber-100 shadow-xl">
        <T>Cette page n&apos;a pas encore été chargée : elle s&apos;ouvrira dès le retour du réseau.</T>
      </p>
    </div>,
    document.body,
  );
}
