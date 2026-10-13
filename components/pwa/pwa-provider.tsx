"use client";

import { useEffect, useState } from "react";
import { useOffline } from "next/offline";
import { useI18n } from "@/components/i18n/i18n-provider";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Enregistre le service worker, propose l'installation et signale la perte de réseau.
export function PwaProvider() {
  const { t } = useI18n();
  const offline = useOffline();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
      } else {
        // En développement, le cache du service worker servirait d'anciens fichiers : on le retire.
        navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      }
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return (
    <>
      {offline && (
        <div role="status" className="fixed inset-x-0 top-0 z-[60] flex justify-center p-3 animate-fade-up">
          <div className="flex items-center gap-2.5 rounded-full border border-amber-300/30 bg-amber-950/90 px-5 py-2.5 text-sm text-amber-100 shadow-xl">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            {t("Vous êtes hors ligne : vos actions seront synchronisées au retour du réseau.")}
          </div>
        </div>
      )}

      {installEvent && !dismissed && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4 animate-fade-up">
          <div className="glass flex w-full max-w-md items-center gap-4 rounded-3xl p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/192" alt="" width={48} height={48} className="rounded-2xl" />
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{t("Installer l'application")}</p>
              <p className="text-xs text-white/55">{t("Accès rapide depuis votre écran d'accueil, même hors ligne.")}</p>
            </div>
            <button onClick={() => setDismissed(true)} className="px-2 text-xs text-white/50 hover:text-white">
              {t("Plus tard")}
            </button>
            <button onClick={install} className="btn-shine rounded-xl px-4 py-2 text-sm font-semibold text-plum-950">
              {t("Installer")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
