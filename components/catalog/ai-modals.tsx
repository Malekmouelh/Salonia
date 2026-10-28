"use client";

import { useI18n, T } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import { SparkleIcon, CheckIcon, WalletIcon, TagIcon, PlusIcon } from "@/components/ui/icons";
import type { PackSuggestion, PricingAnalysisResult } from "@/lib/ai/catalog-ai";
import { fmtMoney } from "@/lib/booking/format";

// ─────────────────────────────────────────────────────────────────────────────
// MODAL SUGGESTIONS DE PACKS IA (Tâche 9)
// ─────────────────────────────────────────────────────────────────────────────

interface PackSuggestionsModalProps {
  open: boolean;
  onClose: () => void;
  suggestions: PackSuggestion[];
  loading: boolean;
  serviceNamesMap: Record<string, string>;
  onApply: (suggestion: PackSuggestion) => void;
}

export function PackSuggestionsModal({
  open,
  onClose,
  suggestions,
  loading,
  serviceNamesMap,
  onApply,
}: PackSuggestionsModalProps) {
  const { t, lang } = useI18n();

  return (
    <Modal open={open} onClose={onClose} title={t("Suggestions de packs par l'IA")} wide>
      <div className="space-y-4">
        <p className="text-xs text-white/60">
          {t("L'IA a analysé vos prestations actives pour concevoir des offres groupées attractives et rentables.")}
        </p>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-champagne/10 text-champagne animate-pulse">
              <SparkleIcon width={24} height={24} className="animate-spin" />
            </span>
            <p className="mt-3 text-sm font-semibold text-white">{t("Analyse du catalogue en cours…")}</p>
            <p className="mt-1 text-xs text-white/50">{t("Recherche des meilleures combinaisons de prestations.")}</p>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/50">
            <p className="text-sm">{t("Aucune suggestion disponible pour le moment.")}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-1">
            {suggestions.map((p, idx) => (
              <div
                key={idx}
                className="group relative overflow-hidden rounded-2xl border border-champagne/25 bg-white/[0.03] p-4.5 transition hover:border-champagne/50 hover:bg-white/[0.05]"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-champagne">✨ {p.name}</span>
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                        −{p.savingsTnd} DT ({p.savingsPercent}%)
                      </span>
                    </div>
                    <p className="text-xs text-white/70">{p.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 pt-1">
                      {p.serviceIds.map((sid) => (
                        <span
                          key={sid}
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/80"
                        >
                          {serviceNamesMap[sid] ?? "Prestation"}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 sm:flex-col sm:items-end justify-between items-center gap-2 border-t border-white/5 pt-3 sm:border-0 sm:pt-0">
                    <div className="text-end">
                      <span className="text-xs text-white/40 line-through me-2">
                        {fmtMoney(p.regularPriceTnd, lang)}
                      </span>
                      <span className="font-display text-lg font-bold text-champagne">
                        {fmtMoney(p.priceTnd, lang)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onApply(p)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blush to-champagne px-3.5 py-2 text-xs font-bold text-plum-950 shadow-md transition hover:opacity-90"
                    >
                      <PlusIcon width={14} height={14} />
                      {t("Créer ce pack")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 hover:text-white"
          >
            {t("Fermer")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL ANALYSE TARIFAIRE IA (Tâche 10)
// ─────────────────────────────────────────────────────────────────────────────

interface PricingAnalysisModalProps {
  open: boolean;
  onClose: () => void;
  analysis: PricingAnalysisResult | null;
  loading: boolean;
}

export function PricingAnalysisModal({
  open,
  onClose,
  analysis,
  loading,
}: PricingAnalysisModalProps) {
  const { t } = useI18n();

  return (
    <Modal open={open} onClose={onClose} title={t("Audit & Recommandations Tarifaires IA")} wide>
      <div className="space-y-5">
        {loading || !analysis ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-gold/10 text-rose-gold animate-pulse">
              <SparkleIcon width={24} height={24} className="animate-spin" />
            </span>
            <p className="mt-3 text-sm font-semibold text-white">{t("Analyse comparative en cours…")}</p>
            <p className="mt-1 text-xs text-white/50">
              {t("Évaluation de la cohérence tarifaire par rapport au marché tunisien.")}
            </p>
          </div>
        ) : (
          <>
            {/* Stats sommaires */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{t("Services")}</p>
                <p className="font-display text-lg font-bold text-white">{analysis.stats.totalServices}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{t("Packs")}</p>
                <p className="font-display text-lg font-bold text-champagne">{analysis.stats.totalPacks}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{t("Prix moyen")}</p>
                <p className="font-display text-lg font-bold text-rose-gold">{analysis.stats.avgPrice} DT</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{t("Catégories")}</p>
                <p className="font-display text-lg font-bold text-white">{analysis.stats.categoriesCount}</p>
              </div>
            </div>

            {/* Résumé de l'IA */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-rose-gold/10 via-champagne/5 to-transparent p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-gold">
                <SparkleIcon width={14} height={14} />
                <span>{t("Synthèse de l'audit")}</span>
                <span className="ms-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                  {analysis.source === "ai" ? t("Généré par l'IA") : t("Audit analytique")}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/80">{analysis.summary}</p>
            </div>

            {/* Recommandations concrètes */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
                {t("Axes d'optimisation prioritaires")}
              </p>
              <div className="grid gap-2.5">
                {analysis.recommendations.map((rec, i) => {
                  const borderTone =
                    rec.type === "opportunity"
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                      : rec.type === "warning"
                        ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
                        : "border-blue-500/30 bg-blue-500/5 text-blue-400";

                  return (
                    <div key={i} className={`rounded-xl border p-3.5 ${borderTone}`}>
                      <p className="text-xs font-bold">{rec.title}</p>
                      <p className="mt-1 text-xs text-white/75 leading-relaxed">{rec.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 hover:text-white"
          >
            {t("Fermer")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
