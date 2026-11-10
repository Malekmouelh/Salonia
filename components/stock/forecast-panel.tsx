"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { explainStockForecastAction } from "@/app/actions/stock";
import { Panel } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { ForecastRow } from "@/lib/stock/forecast-data";
import { ReplenishModal } from "./replenish-modal";
import { Chip, DateText, EmptyState, Qty, centerName, fmtQty, type CenterItem, type ChipTone } from "./stock-shared";

// Prévision de consommation et commande suggérée (IA du Module 5). Les chiffres viennent du calcul serveur (série temporelle sur la
// consommation réelle des rendez-vous terminés) ; « Expliquer » demande une phrase à Gemini, qui ne fait que reformuler ces chiffres.
// L'IA propose, l'utilisateur décide : « Réapprovisionner » ouvre une fenêtre (brouillon, commande passée, ou entrée de stock) dont chaque sortie est
// confirmée par l'utilisateur ; rien n'est commandé ni ajouté automatiquement.

const URGENCY: Record<ForecastRow["urgency"], { label: string; tone: ChipTone }> = {
  URGENT: { label: "Urgent", tone: "bad" },
  SOON: { label: "À commander bientôt", tone: "warn" },
  OK: { label: "Stock suffisant", tone: "ok" },
};
const CONFIDENCE: Record<"HIGH" | "MEDIUM" | "LOW", string> = { HIGH: "Fiabilité élevée", MEDIUM: "Fiabilité moyenne", LOW: "Fiabilité faible" };
const VISIBLE_BY_DEFAULT = 6;

export function ForecastPanel({ rows, todayKey, centers, suppliers, onFeedback }: { rows: ForecastRow[]; todayKey: string; centers: CenterItem[]; suppliers: { id: string; name: string }[]; onFeedback: (message: string, tone?: "success" | "error") => void }) {
  const { t, lang } = useI18n();
  const [replenish, setReplenish] = useState<ForecastRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [explanations, setExplanations] = useState<Record<string, { text: string; source: "AI" | "BASIC" }>>({});
  const [showAll, setShowAll] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const keyOf = (r: ForecastRow) => `${r.productId}:${r.centerId}`;
  const attention = rows.filter((r) => r.status === "OK" && r.urgency !== "OK");
  const calm = rows.filter((r) => r.status === "OK" && r.urgency === "OK");
  const waiting = rows.filter((r) => r.status !== "OK");
  // Un produit à zéro ou au seuil sans historique reste urgent : on le garde parmi les cartes à surveiller.
  const alertsWithoutHistory = waiting.filter((r) => r.urgency === "URGENT");
  const primary = [...attention, ...alertsWithoutHistory];
  const shown = showAll ? [...primary, ...calm, ...waiting.filter((r) => r.urgency !== "URGENT")] : primary.slice(0, VISIBLE_BY_DEFAULT);
  const hidden = primary.length + calm.length + waiting.filter((r) => r.urgency !== "URGENT").length - shown.length;

  const explain = (r: ForecastRow) => {
    setBusyKey(keyOf(r));
    startTransition(async () => {
      const res = await explainStockForecastAction({ productId: r.productId, centerId: r.centerId, lang });
      if (res.ok) setExplanations((e) => ({ ...e, [keyOf(r)]: { text: res.text, source: res.source } }));
      else onFeedback(res.message ?? "Une erreur est survenue. Réessayez.", "error");
      setBusyKey(null);
    });
  };

  return (
    <Panel title="Prévisions et commandes suggérées" subtitle="Estimées à partir de la consommation réelle des rendez-vous terminés : l'IA propose, vous décidez">
      {rows.length === 0 ? (
        <EmptyState>{t("Aucune prévision pour l'instant : activez des produits dans un centre et terminez des rendez-vous dont la prestation a une recette.")}</EmptyState>
      ) : (
        <div className="space-y-4">
          {primary.length === 0 && <p className="text-sm text-white/55">{t("Aucun produit à commander pour le moment.")}</p>}
          {waiting.length > 0 && (
            <p className="text-xs text-white/45">
              <bdi>{fmtQty(waiting.length, lang)}</bdi> {t("produit(s) sans assez d'historique pour une prévision (moins de 2 semaines de consommation, ou aucune consommation).")}
            </p>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((r) => {
              const explanation = explanations[keyOf(r)];
              return (
                <li key={keyOf(r)} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">{r.productName}</p>
                      <p className="text-xs text-white/45">{centerName(centers, r.centerId)}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Chip tone={URGENCY[r.urgency].tone}>{t(URGENCY[r.urgency].label)}</Chip>
                      {r.confidence && <Chip tone="muted">{t(CONFIDENCE[r.confidence])}</Chip>}
                    </div>
                  </div>

                  {r.status === "OK" ? (
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-white/45">{t("Stock actuel")}</dt>
                        <dd className="text-white"><Qty value={r.stock} unit={r.unit} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/45">{t("Consommation par jour")}</dt>
                        <dd className="text-white">≈ <Qty value={Math.round(r.dailyRate)} unit={r.unit} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/45">{t("Rupture estimée")}</dt>
                        <dd className="text-white">
                          {r.ruptureDate ? (
                            <>
                              <DateText value={r.ruptureDate} /> <span className="text-xs text-white/45">({r.daysLeft === 0 ? t("aujourd'hui") : <><bdi>{fmtQty(r.daysLeft ?? 0, lang)}</bdi> {t("jour(s)")}</>})</span>
                            </>
                          ) : (
                            <span className="text-white/55">{t("Aucune dans 4 mois")}</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/45">{t("Commander avant le")}</dt>
                        <dd className="text-white">
                          {r.orderBy === null ? (
                            <span className="text-white/55">—</span>
                          ) : r.orderBy <= todayKey ? (
                            <span className="text-red-200">{t("Dès aujourd'hui")}</span>
                          ) : (
                            <DateText value={r.orderBy} />
                          )}
                        </dd>
                      </div>
                      <div className="col-span-2 rounded-2xl bg-white/[0.05] px-4 py-3">
                        <dt className="text-xs text-white/45">{t("Quantité suggérée")}</dt>
                        <dd className="text-lg font-semibold text-white">
                          {r.suggestedQuantity > 0 ? <Qty value={r.suggestedQuantity} unit={r.unit} /> : <span className="text-sm font-normal text-white/55">{t("Rien à commander")}</span>}
                          {r.onOrder > 0 && (
                            <span className="ms-2 text-xs font-normal text-white/45">
                              ({t("déjà commandé")} : <Qty value={r.onOrder} unit={r.unit} />)
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-4 text-sm text-white/55">
                      {r.urgency === "URGENT" ? t("Stock à zéro ou au seuil d'alerte, mais pas assez d'historique pour estimer une rupture.") : t("Pas assez d'historique pour une prévision.")}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-white/45">
                    {r.supplierName ? (
                      <>
                        {t("Fournisseur")} : {r.supplierName} · {t("Délai de livraison")} : <bdi>{fmtQty(r.leadDays ?? 0, lang)}</bdi> {t("jour(s)")}
                        {r.breakBeforeDelivery && <span className="ms-2 text-red-200">{t("Rupture avant la livraison, même en commandant aujourd'hui")}</span>}
                      </>
                    ) : (
                      t("Aucun fournisseur habituel : choisissez-en un dans la fiche du produit pour connaître la date limite de commande.")
                    )}
                  </p>

                  {explanation && (
                    <div className="mt-3 rounded-2xl border border-champagne/20 bg-champagne/5 px-4 py-3 text-sm text-white/80">
                      <p>{explanation.text}</p>
                      <p className="mt-1 text-[11px] text-white/40">{explanation.source === "AI" ? t("Reformulé par l'IA à partir des chiffres ci-dessus.") : t("Phrase générée sans IA à partir des chiffres ci-dessus.")}</p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                    {r.status === "OK" && (
                      <button type="button" disabled={pending} onClick={() => explain(r)} className="text-white/60 hover:text-white disabled:opacity-60">
                        {pending && busyKey === keyOf(r) ? t("Un instant…") : t("Expliquer")}
                      </button>
                    )}
                    <button type="button" disabled={pending} onClick={() => setReplenish(r)} className="font-medium text-champagne hover:underline disabled:opacity-60">
                      {t("Réapprovisionner")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {(hidden > 0 || showAll) && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-champagne hover:underline">
              {showAll ? t("Réduire la liste") : `${t("Voir tous les produits")} (${fmtQty(hidden, lang)})`}
            </button>
          )}
          <p className="text-[11px] text-white/35">
            {t("Estimation : série temporelle sur 8 semaines, avec marge de sécurité. Les brouillons créés ici se modifient dans")}{" "}
            <Link href="/dashboard/stock/commandes" className="text-champagne hover:underline">
              {t("Commandes")}
            </Link>
            .
          </p>
        </div>
      )}
      {replenish && <ReplenishModal row={replenish} suppliers={suppliers} centers={centers} onClose={() => setReplenish(null)} onDone={onFeedback} />}
    </Panel>
  );
}
