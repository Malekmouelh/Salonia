"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/finance-assistant-bubble.tsx — L'ASSISTANT FINANCIER EN BULLE
// ═══════════════════════════════════════════════════════════════════════════
// Une petite bulle en bas à droite de toutes les pages du tableau de bord (propriétaire uniquement).
// Un clic ouvre une fenêtre de discussion avec l'assistant financier (components/finance/finance-assistant.tsx).
// La conversation est gardée pendant la session : on peut changer de page sans la perdre.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";
import { FinanceAssistant } from "./finance-assistant";

const STORAGE_KEY = "salonia.finance-assistant";

export function FinanceAssistantBubble() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Échap ferme la fenêtre.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="fixed bottom-4 end-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:end-6">
      {/* Fenêtre de discussion : gardée dans la page quand elle est fermée (la conversation reste en mémoire). */}
      <section
        role="dialog"
        aria-label={t("Assistant financier")}
        hidden={!open}
        className="flex h-[min(34rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] flex-col rounded-3xl border border-white/10 bg-plum-950/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl sm:w-[26rem]"
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blush to-champagne text-plum-950">
              <SparkleIcon width={20} height={20} />
            </span>
            <div>
              <p className="font-display text-lg leading-tight text-white">{t("Assistant financier")}</p>
              <p className="text-xs text-white/50">{t("Chiffres, rentabilité et prévisions de votre salon")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("Fermer")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <span aria-hidden className="text-xl leading-none">×</span>
          </button>
        </header>
        <FinanceAssistant centerId="all" compact storageKey={STORAGE_KEY} />
      </section>

      {/* La bulle. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? t("Fermer l'assistant financier") : t("Ouvrir l'assistant financier")}
        className="group grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-blush to-champagne text-plum-950 shadow-lg shadow-black/40 ring-4 ring-white/10 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-rose-gold/60"
      >
        {open ? <span aria-hidden className="text-2xl leading-none">×</span> : <SparkleIcon width={24} height={24} className="transition-transform group-hover:rotate-12" />}
      </button>
    </div>
  );
}
