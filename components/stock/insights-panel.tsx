"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { analyzeStockConsumptionAction } from "@/app/actions/stock";
import { Panel } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { Finding, FindingType, InsightsReport, ProductRow, Severity } from "@/lib/stock/insights";
import type { ConsumptionAnalysis } from "@/lib/stock/insights-ai";
import { Chip, EmptyState, Qty, fmtQty, type ChipTone } from "./stock-shared";

// Analyse de la consommation entre centres (IA du Module 5). Les chiffres et les constats viennent du serveur (journal des mouvements, droits
// du stock déjà appliqués : propriétaire = tous ses centres, gérant = les siens). « Analyser avec l'IA » demande à Gemini d'interpréter ces
// constats (relier, hiérarchiser, hypothèses, action) ; sa réponse est vérifiée côté serveur, et l'utilisateur décide : rien n'est exécuté ici.

const SEVERITY: Record<Severity, { label: string; tone: ChipTone }> = {
  HIGH: { label: "Prioritaire", tone: "bad" },
  MEDIUM: { label: "À examiner", tone: "warn" },
  LOW: { label: "À surveiller", tone: "info" },
};
const TYPE_LABEL: Record<FindingType, string> = {
  RUPTURE_RISK: "Risque de rupture",
  IMBALANCE: "Déséquilibre entre centres",
  SPIKE: "Pic de consommation cette semaine",
  LOSSES: "Sorties manuelles importantes",
  CENTER_OUTLIER: "Consommation plus élevée que dans les autres centres",
  TREND_UP: "Consommation en hausse",
  DORMANT: "Stock immobilisé",
  TREND_DOWN: "Consommation en baisse",
};
const ACTION_LABEL: Record<ConsumptionAnalysis["items"][number]["action"]["type"], string> = {
  COMMANDER: "Commander",
  TRANSFERER: "Transférer",
  VERIFIER: "Vérifier",
  SURVEILLER: "Surveiller",
  REVOIR_RECETTE: "Revoir la recette",
};
const CENTER_COLORS = ["bg-champagne", "bg-sky-300", "bg-rose-300", "bg-emerald-300", "bg-violet-300", "bg-amber-300"];
const VISIBLE_FINDINGS = 6;
const VISIBLE_PRODUCTS = 6;

function Pct({ value, signed = true }: { value: number | null; signed?: boolean }) {
  const { lang } = useI18n();
  if (value === null) return <span className="text-white/45">—</span>;
  return (
    <bdi className="tabular-nums">
      {signed && value > 0 ? "+" : ""}
      {fmtQty(value, lang)} %
    </bdi>
  );
}

function ChangeChip({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  return <Chip tone={value > 0 ? "warn" : "info"}><Pct value={value} /></Chip>;
}

export function InsightsPanel({ report, days, windows }: { report: InsightsReport; days: number; windows: number[] }) {
  const { t, lang } = useI18n();
  const productOf = new Map(report.products.map((p) => [p.productId, p]));
  const centerOf = new Map(report.centers.map((c) => [c.centerId, c.name]));
  const colorOf = (centerId: string) => CENTER_COLORS[Math.max(0, report.centers.findIndex((c) => c.centerId === centerId)) % CENTER_COLORS.length];
  const nameOfCenter = (id: string | null | undefined) => (id ? (centerOf.get(id) ?? "—") : "—");
  const nameOfProduct = (id: string | null | undefined) => (id ? (productOf.get(id)?.name ?? "—") : "—");

  return (
    <div className="mt-6 space-y-6">
      <PeriodBar days={days} windows={windows} />
      <QualityNotes report={report} />

      <Panel title="Vos centres" subtitle="Activité du centre et niveau de consommation par rendez-vous, comparés à la moyenne de vos centres">
        {report.centers.length === 0 ? (
          <EmptyState>{t("Aucun centre dans votre périmètre.")}</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.centers.map((c) => (
              <li key={c.centerId} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${colorOf(c.centerId)}`} aria-hidden />
                  <p className="truncate font-medium text-white">{c.name}</p>
                </div>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-xs text-white/45">{t("Rendez-vous ayant consommé du stock")}</dt>
                    <dd className="text-white">
                      <bdi className="tabular-nums">{fmtQty(c.appointments, lang)}</bdi> <ChangeChip value={c.appointmentsChangePct} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-xs text-white/45">{t("Consommation par rendez-vous")}</dt>
                    <dd>
                      {c.intensityIndex === null ? (
                        <span className="text-xs text-white/45">{t("Pas de comparaison possible")}</span>
                      ) : (
                        <Chip tone={c.intensityIndex >= 135 ? "warn" : c.intensityIndex <= 65 ? "info" : "ok"}>
                          <bdi className="tabular-nums">{fmtQty(c.intensityIndex, lang)}</bdi> / 100 {c.intensityIndex >= 135 ? t("au-dessus de la moyenne") : c.intensityIndex <= 65 ? t("en dessous de la moyenne") : t("dans la moyenne")}
                        </Chip>
                      )}
                    </dd>
                  </div>
                </dl>
                {c.intensityIndex !== null && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <div className={`h-full ${colorOf(c.centerId)}`} style={{ width: `${Math.min(100, Math.round(c.intensityIndex / 2))}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!report.quality.comparable && report.centers.length > 0 && <p className="mt-4 text-xs text-white/45">{t("Un seul centre dans votre périmètre : la comparaison entre centres n'est pas disponible, les autres analyses restent valables.")}</p>}
      </Panel>

      <FindingsPanel report={report} nameOfCenter={nameOfCenter} nameOfProduct={nameOfProduct} productOf={productOf} />
      <ProductsPanel report={report} nameOfCenter={nameOfCenter} colorOf={colorOf} />
      <AiPanel days={days} report={report} lang={lang} nameOfCenter={nameOfCenter} nameOfProduct={nameOfProduct} />
      <LimitsPanel />
    </div>
  );
}

function PeriodBar({ days, windows }: { days: number; windows: number[] }) {
  const { t, lang } = useI18n();
  return (
    <nav aria-label={t("Choisir la période analysée")} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <div className="inline-flex gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1.5">
        {windows.map((n) => (
          <Link
            key={n}
            href={`/dashboard/stock/analyses?days=${n}`}
            aria-current={n === days ? "page" : undefined}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm transition ${n === days ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
          >
            <bdi>{fmtQty(n, lang)}</bdi> {t("jours")}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// Honnêteté sur les données : une simulation n'est jamais présentée comme une activité réelle, un historique court est signalé.
function QualityNotes({ report }: { report: InsightsReport }) {
  const { t, lang } = useI18n();
  const { simulatedSharePct, historyDays } = report.quality;
  const notes: { tone: "warn" | "info"; node: ReactNode }[] = [];
  if (simulatedSharePct > 0) {
    notes.push({
      tone: "warn",
      node: (
        <>
          {t("Données de démonstration : une part des consommations de cette période est simulée")} (<Pct value={simulatedSharePct} signed={false} />). {t("Les analyses illustrent la méthode, pas l'activité réelle des centres.")}
        </>
      ),
    });
  }
  if (historyDays < 28) {
    notes.push({
      tone: "info",
      node: (
        <>
          {t("Historique court")} (<bdi>{fmtQty(historyDays, lang)}</bdi> {t("jours")}) : {t("les écarts sont à interpréter avec prudence.")}
        </>
      ),
    });
  }
  if (notes.length === 0) return null;
  return (
    <div className="space-y-2">
      {notes.map((n, i) => (
        <p key={i} className={`rounded-2xl border px-4 py-3 text-sm ${n.tone === "warn" ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : "border-sky-300/20 bg-sky-300/10 text-sky-100"}`}>
          {n.node}
        </p>
      ))}
    </div>
  );
}

type Lookups = { nameOfCenter: (id: string | null | undefined) => string; nameOfProduct: (id: string | null | undefined) => string; productOf: Map<string, ProductRow> };

type Metric = { label: string; value: ReactNode };

function metricRows(f: Finding, unit: ProductRow["unit"], t: (s: string) => string, lang: string): Metric[] {
  const m = f.metrics;
  const n = (key: string) => Number(m[key] ?? 0);
  const q = (key: string) => <Qty value={n(key)} unit={unit} />;
  const d = (key: string) => (
    <>
      <bdi className="tabular-nums">{fmtQty(n(key), lang)}</bdi> {t("jours")}
    </>
  );
  switch (f.type) {
    case "RUPTURE_RISK":
      return [
        { label: "Stock actuel", value: q("stock") },
        { label: "Rupture estimée", value: m.forecastAvailable ? <>{t("dans")} {d("daysLeft")}</> : t("Pas assez d'historique") },
        ...(m.leadDays !== null ? [{ label: "Délai du fournisseur", value: d("leadDays") }] : []),
        ...(n("suggestedQuantity") > 0 ? [{ label: "Quantité suggérée", value: q("suggestedQuantity") }] : []),
      ];
    case "IMBALANCE":
      return [
        { label: "Couverture du centre en tension", value: d("receiverCoverDays") },
        { label: "Stock du centre qui en a trop", value: q("senderStock") },
        { label: "Quantité à transférer", value: q("quantity") },
      ];
    case "SPIKE":
      return [
        { label: "Dernière semaine", value: q("lastWeek") },
        { label: "Semaine habituelle", value: q("usualWeek") },
        { label: "Écart", value: <Pct value={n("aboveUsualPct")} /> },
      ];
    case "LOSSES":
      return [
        { label: "Sorties manuelles", value: q("manualOut") },
        { label: "Consommé par les rendez-vous", value: q("consumption") },
        { label: "Part des sorties", value: <Pct value={n("sharePct")} signed={false} /> },
      ];
    case "CENTER_OUTLIER":
      return [
        { label: "Écart avec les autres centres", value: <Pct value={n("aboveOthersPct")} /> },
        { label: "Comparé", value: m.normalizedBy === "APPOINTMENTS" ? t("par rendez-vous") : t("par jour") },
        { label: "Consommation sur la période", value: q("current") },
      ];
    case "TREND_UP":
    case "TREND_DOWN":
      return [
        { label: "Période actuelle", value: q("current") },
        { label: "Période précédente", value: q("previous") },
        { label: "Évolution", value: <Pct value={n("changePct")} /> },
      ];
    case "DORMANT":
      return [
        { label: "Stock immobilisé", value: q("stock") },
        { label: "Consommé sur la période précédente", value: q("previous") },
      ];
  }
}

function FindingsPanel({ report, nameOfCenter, nameOfProduct, productOf }: { report: InsightsReport } & Lookups) {
  const { t, lang } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? report.findings : report.findings.slice(0, VISIBLE_FINDINGS);
  return (
    <Panel title="Constats calculés" subtitle="Détectés par le calcul à partir du journal du stock : chaque chiffre peut être retrouvé dans l'historique des mouvements">
      {report.findings.length === 0 ? (
        <EmptyState>{t("Aucune situation inhabituelle détectée sur cette période.")}</EmptyState>
      ) : (
        <div className="space-y-4">
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((f) => {
              const product = productOf.get(f.productId);
              return (
                <li key={f.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{t(TYPE_LABEL[f.type])}</p>
                      <p className="text-xs text-white/50">
                        {nameOfProduct(f.productId)} · {f.type === "IMBALANCE" ? `${nameOfCenter(f.otherCenterId)} → ${nameOfCenter(f.centerId)}` : nameOfCenter(f.centerId)}
                      </p>
                    </div>
                    <Chip tone={SEVERITY[f.severity].tone}>{t(SEVERITY[f.severity].label)}</Chip>
                  </div>
                  {product && (
                    <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-sm sm:grid-cols-2 sm:gap-x-4">
                      {metricRows(f, product.unit, t, lang).map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs text-white/45">{t(label)}</dt>
                          <dd className="text-white">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
          {report.findings.length > VISIBLE_FINDINGS && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-champagne hover:underline">
              {showAll ? t("Réduire la liste") : `${t("Voir tous les constats")} (${fmtQty(report.findings.length - VISIBLE_FINDINGS, lang)})`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

function ProductsPanel({ report, nameOfCenter, colorOf }: { report: InsightsReport; nameOfCenter: Lookups["nameOfCenter"]; colorOf: (id: string) => string }) {
  const { t, lang } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? report.products : report.products.slice(0, VISIBLE_PRODUCTS);
  const active = report.products.filter((p) => p.current > 0).length;
  return (
    <Panel title="Consommation par produit" subtitle="Quantités consommées par les rendez-vous sur la période, répartition entre vos centres et évolution">
      {report.products.length === 0 ? (
        <EmptyState>{t("Aucun produit suivi pour l'instant : activez des produits dans vos centres.")}</EmptyState>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-white/45">
            <bdi>{fmtQty(active, lang)}</bdi> / <bdi>{fmtQty(report.products.length, lang)}</bdi> {t("produits consommés sur la période. Classés par unité puis par quantité (des unités différentes ne s'additionnent pas).")}
          </p>
          <ul className="space-y-3">
            {shown.map((p) => (
              <li key={p.productId} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-white">{p.name}</p>
                  <div className="flex items-center gap-2 text-sm text-white">
                    <Qty value={p.current} unit={p.unit} />
                    <ChangeChip value={p.changePct} />
                    {p.current === 0 && <Chip tone="muted">{t("Aucune consommation")}</Chip>}
                  </div>
                </div>
                {p.current > 0 && (
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    {p.centers
                      .filter((c) => c.sharePct > 0)
                      .map((c) => (
                        <div key={c.centerId} className={colorOf(c.centerId)} style={{ width: `${c.sharePct}%` }} />
                      ))}
                  </div>
                )}
                <ul className="mt-3 grid gap-x-6 gap-y-1 text-xs text-white/60 sm:grid-cols-2">
                  {p.centers.map((c) => (
                    <li key={c.centerId} className="flex flex-wrap items-center gap-x-2">
                      <span className={`size-2 rounded-full ${colorOf(c.centerId)}`} aria-hidden />
                      <span className="text-white/80">{nameOfCenter(c.centerId)}</span>
                      <span>
                        <Qty value={c.current} unit={p.unit} /> (<Pct value={c.sharePct} signed={false} />)
                      </span>
                      {c.coverDays !== null && (
                        <span className={c.coverDays <= 14 ? "text-red-200" : ""}>
                          · {t("couverture")} <bdi className="tabular-nums">{fmtQty(c.coverDays, lang)}</bdi> {t("jours")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {report.products.length > VISIBLE_PRODUCTS && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-champagne hover:underline">
              {showAll ? t("Réduire la liste") : `${t("Voir tous les produits")} (${fmtQty(report.products.length - VISIBLE_PRODUCTS, lang)})`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

// Lien vers la vue d'ensemble avec le formulaire de transfert prérempli (produit, centre source, centre destinataire, quantité conseillée du constat
// de déséquilibre). Rien ne part sans validation : le formulaire revérifie tout et l'utilisateur peut tout modifier.
function transferHref(action: { productId: string | null; centerId: string | null; toCenterId: string | null }, findings: (Finding | undefined)[]) {
  if (!action.productId || !action.centerId || !action.toCenterId) return "/dashboard/stock";
  const imbalance = findings.find((f) => f?.type === "IMBALANCE" && f.productId === action.productId && f.otherCenterId === action.centerId && f.centerId === action.toCenterId);
  const quantity = Number(imbalance?.metrics.quantity);
  const params = new URLSearchParams({ tp: action.productId, tf: action.centerId, tt: action.toCenterId });
  if (Number.isInteger(quantity) && quantity > 0) params.set("tq", String(quantity));
  return `/dashboard/stock?${params.toString()}`;
}

function AiPanel({ days, report, lang, nameOfCenter, nameOfProduct }: { days: number; report: InsightsReport; lang: string } & Pick<Lookups, "nameOfCenter" | "nameOfProduct">) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [analysis, setAnalysis] = useState<ConsumptionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const findingOf = new Map(report.findings.map((f) => [f.id, f]));

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await analyzeStockConsumptionAction({ days, lang: lang === "ar" ? "ar" : "fr" });
      if (res.ok) setAnalysis(res);
      else setError(res.message ?? "Une erreur est survenue. Réessayez.");
    });
  };
  const label = (id: string) => {
    const f = findingOf.get(id);
    return f ? `${t(TYPE_LABEL[f.type])} · ${nameOfProduct(f.productId)}` : null;
  };

  return (
    <Panel title="Analyse par l'IA" subtitle="L'IA relie les constats, les hiérarchise, avance des hypothèses à vérifier et propose des actions : vous décidez">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending || report.findings.length === 0} onClick={run} className="btn-shine rounded-2xl px-5 py-2.5 text-sm font-semibold text-plum-950 disabled:opacity-60">
            {pending ? t("Analyse en cours…") : analysis ? t("Relancer l'analyse") : t("Analyser avec l'IA")}
          </button>
          {report.findings.length === 0 && <span className="text-xs text-white/45">{t("Aucun constat à interpréter sur cette période.")}</span>}
        </div>
        {error && <p role="alert" className="text-sm text-red-300">{t(error)}</p>}

        {analysis && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-champagne/20 bg-champagne/5 px-5 py-4">
              <p className="font-display text-lg text-white">{analysis.title}</p>
              {analysis.priorities.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-white/45">{t("Priorités, de la plus importante à la moins importante")}</p>
                  <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-sm text-white/85">
                    {analysis.priorities.map((id) => {
                      const text = label(id);
                      return text ? <li key={id}>{text}</li> : null;
                    })}
                  </ol>
                </div>
              )}
            </div>

            <ul className="grid gap-3 lg:grid-cols-2">
              {analysis.items.map((item, i) => (
                <li key={i} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap gap-1.5">
                    {item.findingIds.map((id) => {
                      const text = label(id);
                      return text ? <Chip key={id} tone="muted">{text}</Chip> : null;
                    })}
                  </div>
                  <p className="mt-3 text-sm text-white/85">{item.reading}</p>
                  {item.hypotheses.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-white/45">{t("Hypothèses à vérifier (pas des faits)")}</p>
                      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-white/70">
                        {item.hypotheses.map((h, j) => (
                          <li key={j}>{h}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-4 rounded-2xl bg-white/[0.05] px-4 py-3">
                    <p className="text-xs text-white/45">{t("Action proposée")}</p>
                    <p className="mt-0.5 text-sm text-white">
                      <Chip tone="info">{t(ACTION_LABEL[item.action.type])}</Chip> <span className="ms-1">{item.action.label}</span>
                    </p>
                    {item.action.type === "COMMANDER" && (
                      <Link href="/dashboard/stock/commandes" className="mt-2 inline-block text-xs text-champagne hover:underline">
                        {t("Commandes")}
                      </Link>
                    )}
                    {item.action.type === "TRANSFERER" && item.action.centerId && item.action.toCenterId && (
                      <p className="mt-2 text-xs text-white/50">
                        {nameOfCenter(item.action.centerId)} → {nameOfCenter(item.action.toCenterId)} · {nameOfProduct(item.action.productId)} ·{" "}
                        <Link href={transferHref(item.action, item.findingIds.map((id) => findingOf.get(id)))} className="text-champagne hover:underline">
                          {t("Ouvrir le formulaire de transfert")}
                        </Link>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {analysis.limits.length > 0 && (
              <div>
                <p className="text-xs text-white/45">{t("Limites signalées par l'analyse")}</p>
                <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-white/60">
                  {analysis.limits.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-white/40">
              {analysis.source === "AI"
                ? t("Rédigé par l'IA à partir des constats calculés ci-dessus. Les chiffres cités sont contrôlés : toute réponse contenant un nombre absent des données est refusée.")
                : t("Synthèse construite sans IA à partir des constats calculés (clé absente, service indisponible ou réponse refusée).")}
              {" "}
              {t("Rien n'est exécuté automatiquement.")}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function LimitsPanel() {
  const { t } = useI18n();
  const points = [
    "Les chiffres comptent la quantité demandée par les recettes des rendez-vous terminés ; la journée en cours est exclue.",
    "Chaque période est comparée à la période précédente, de même durée.",
    "Entre centres, la consommation est rapportée au nombre de rendez-vous ayant consommé du stock ; sans mesure d'activité dans tous les centres, elle est comparée par jour.",
    "Les constats décrivent ce qui s'est passé, pas pourquoi : une hypothèse de l'IA est une piste à vérifier, jamais un fait.",
    "Les sorties manuelles ne sont pas forcément des pertes (atelier, démonstration, casse) : les transferts entre centres n'en font jamais partie.",
    "La prévision de rupture suppose que la consommation récente continue ; elle ne connaît ni promotion, ni fermeture, ni événement.",
    "Avec moins de 4 semaines d'historique, les écarts et les tendances sont moins fiables.",
  ];
  return (
    <Panel title="Hypothèses et limites" subtitle="Ce qu'il faut savoir avant de se fier à ces analyses">
      <ul className="list-disc space-y-1.5 ps-5 text-sm text-white/65">
        {points.map((p) => (
          <li key={p}>{t(p)}</li>
        ))}
      </ul>
    </Panel>
  );
}
