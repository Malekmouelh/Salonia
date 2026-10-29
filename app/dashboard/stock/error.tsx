"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert } from "@/components/ui/form";

// État d'erreur des pages du stock : message neutre (aucun détail interne), nouvelle tentative possible.
export default function StockError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error("Page de stock en erreur :", error.digest ?? "");
  }, [error]);
  return (
    <main className="relative mx-auto max-w-2xl px-4 py-24">
      <Alert>{t("Le stock n'a pas pu être chargé. Réessayez dans un instant.")}</Alert>
      <button type="button" onClick={reset} className="btn-shine mt-6 rounded-2xl px-5 py-2.5 text-sm font-semibold text-plum-950">
        {t("Réessayer")}
      </button>
    </main>
  );
}
