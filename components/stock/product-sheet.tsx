"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import type { ForecastRow } from "@/lib/stock/forecast-data";
import { STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import { levelState, sortLevels, summarizeProduct, type LevelState } from "@/lib/stock/level-filter";
import type { StockLevelRow } from "@/lib/stock/service";
import { Chip, DateText, Qty, centerName, fmtQty, type CenterItem, type ChipTone, type ProductItem } from "./stock-shared";

// Fiche détail d'un produit : une vue unique de ce produit dans tous les centres du périmètre de l'utilisateur (stock total, répartition,
// état, seuil, dernier mouvement, consommation moyenne et rupture estimée). Lecture seule : les chiffres viennent des niveaux et de la
// prévision déjà chargés par la page (rôle et centres déjà appliqués côté serveur) ; aucune écriture n'est faite ici.

const STATE_CHIP: Record<LevelState, { label: string; tone: ChipTone }> = {
  OUT: { label: "Rupture", tone: "bad" },
  LOW: { label: "Stock bas", tone: "warn" },
  OK: { label: "Stock suffisant", tone: "ok" },
  ARCHIVED: { label: "Archivé", tone: "muted" },
};

export function ProductSheetModal({
  product,
  levels,
  forecast,
  centers,
  supplierName,
  onHistory,
  onClose,
}: {
  product: ProductItem;
  levels: StockLevelRow[];
  forecast: ForecastRow[];
  centers: CenterItem[];
  supplierName: string | null;
  onHistory: (level: StockLevelRow) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const own = sortLevels(
    levels.filter((l) => l.productId === product.id),
    "CRITICAL",
  );
  const sum = summarizeProduct(own);
  const forecastOf = (l: StockLevelRow) => forecast.find((f) => f.productId === l.productId && f.centerId === l.centerId);

  return (
    <Modal open onClose={onClose} title={product.name} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
          {product.active ? <Chip tone="ok">{t("Actif")}</Chip> : <Chip tone="muted">{t("Archivé")}</Chip>}
          <span>
            {t("Unité")} : {t(STOCK_UNIT_LABELS[product.unit])}
          </span>
          <span>·</span>
          <span>
            {t("Fournisseur habituel")} : {supplierName ?? t("Aucun")}
          </span>
        </div>

        <dl className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-white/5 p-3">
            <dt className="text-xs text-white/45">{t("Stock total")}</dt>
            <dd className="mt-1 text-lg text-white">
              <Qty value={sum.total} unit={product.unit} />
            </dd>
          </div>
          <div className="rounded-2xl bg-white/5 p-3">
            <dt className="text-xs text-white/45">{t("Centres où il est suivi")}</dt>
            <dd className="mt-1 text-lg text-white">
              <bdi>{fmtQty(sum.centers, lang)}</bdi>
            </dd>
          </div>
          <div className="rounded-2xl bg-white/5 p-3">
            <dt className="text-xs text-white/45">{t("En stock bas")}</dt>
            <dd className={`mt-1 text-lg ${sum.low > 0 ? "text-amber-200" : "text-white"}`}>
              <bdi>{fmtQty(sum.low, lang)}</bdi>
            </dd>
          </div>
          <div className="rounded-2xl bg-white/5 p-3">
            <dt className="text-xs text-white/45">{t("En rupture")}</dt>
            <dd className={`mt-1 text-lg ${sum.out > 0 ? "text-red-200" : "text-white"}`}>
              <bdi>{fmtQty(sum.out, lang)}</bdi>
            </dd>
          </div>
        </dl>

        <div>
          <h3 className="mb-2 text-sm font-medium text-white">{t("Répartition par centre")}</h3>
          {own.length === 0 ? (
            <p className="rounded-2xl bg-white/5 p-4 text-sm text-white/45">{t("Ce produit n'est activé dans aucun centre de votre périmètre.")}</p>
          ) : (
            <ul className="space-y-3">
              {own.map((l) => {
                const state = STATE_CHIP[levelState(l)];
                const f = forecastOf(l);
                const hasForecast = f?.status === "OK";
                return (
                  <li key={l.centerId} className="rounded-2xl border border-white/10 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-white">{centerName(centers, l.centerId)}</p>
                      <Chip tone={state.tone}>{t(state.label)}</Chip>
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      <Qty value={l.quantity} unit={l.unit} />
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-white/55 sm:grid-cols-2">
                      <div className="flex gap-1">
                        <dt>{t("Seuil d'alerte")} :</dt>
                        <dd className="text-white/80">
                          <Qty value={l.alertThreshold} unit={l.unit} />
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t("Dernier mouvement")} :</dt>
                        <dd className="text-white/80">{l.lastMovementAt ? <DateText value={l.lastMovementAt} withTime /> : t("Aucun")}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t("Consommation moyenne par jour")} :</dt>
                        <dd className="text-white/80">{hasForecast ? <>≈ <Qty value={Math.round(f.dailyRate)} unit={l.unit} /></> : t("Pas assez d'historique")}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t("Rupture estimée")} :</dt>
                        <dd className="text-white/80">
                          {!hasForecast ? (
                            t("Pas assez d'historique")
                          ) : f.ruptureDate ? (
                            <>
                              <DateText value={f.ruptureDate} /> ({f.daysLeft === 0 ? t("aujourd'hui") : <><bdi>{fmtQty(f.daysLeft ?? 0, lang)}</bdi> {t("jour(s)")}</>})
                            </>
                          ) : (
                            t("Aucune rupture prévue")
                          )}
                        </dd>
                      </div>
                    </dl>
                    <button type="button" onClick={() => onHistory(l)} className="mt-3 text-xs text-champagne hover:underline">
                      {t("Historique")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-xs text-white/40">{t("La consommation moyenne et la rupture estimée viennent de la prévision : elles reposent sur les rendez-vous terminés.")}</p>
      </div>
    </Modal>
  );
}
