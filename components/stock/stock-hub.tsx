"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { archiveStockProductAction, deleteStockProductAction, repairStockLevelsAction } from "@/app/actions/stock";
import { BarList, Panel, StatTile, selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { AlertIcon, BoxIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import type { TransferInbox, TransferView } from "@/lib/stock/transfers";
import type { RecentMovementRow } from "@/lib/stock/movements";
import type { StockSummary } from "@/lib/stock/overview";
import { EQUIPMENT_STATUS_LABELS, MAINTENANCE_STATE_LABELS, PURCHASE_ORDER_STATUS_LABELS, STOCK_MOVEMENT_KIND_LABELS, STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import type { StockLevelRow } from "@/lib/stock/service";
import { EQUIPMENT_STATUSES, PURCHASE_ORDER_STATUSES } from "@/lib/enums";
import { ActivateModal, HistoryModal, MovementModal, ProductModal, ThresholdModal, type LevelTarget } from "./stock-modals";
import { CenterFilter, Chip, DateText, EmptyState, Qty, centerName, fmtQty, useFeedback, type CenterItem, type ProductItem, useConfirm } from "./stock-shared";
import { ForecastPanel } from "./forecast-panel";
import { ProductTransferModal, TransfersPanel, type TransferPrefill } from "./transfer-modals";
import { ProductSheetModal } from "./product-sheet";
import { countByState, filterLevels, sortLevels, type LevelSort, type StateFilter } from "@/lib/stock/level-filter";
import type { ForecastRow } from "@/lib/stock/forecast-data";

// Vue d'ensemble du stock : synthèse (chiffres réels des services), produits à surveiller, niveaux par centre, catalogue des produits.
// Rôles : le propriétaire gère les fiches produit ; le gérant agit sur les niveaux de ses centres. Toutes les écritures passent par les
// actions serveur (qui revérifient rôle, organisation et centre) : masquer un bouton n'est jamais la seule protection.

type Modal =
  | { type: "movement"; target: LevelTarget }
  | { type: "history"; target: LevelTarget }
  | { type: "threshold"; target: LevelTarget }
  | { type: "activate" }
  | { type: "transfer"; initial: TransferPrefill | null }
  | { type: "product"; product: ProductItem | null }
  | { type: "sheet"; productId: string };

export function StockHub({
  centers,
  selectedCenterId,
  products,
  levels,
  recent,
  summary,
  canManageProducts,
  suppliers,
  forecast,
  forecastToday,
  destinations,
  transfers,
  transfersNextBefore,
  inbox,
  isOwner,
  prefill,
}: {
  centers: CenterItem[];
  selectedCenterId: string | null;
  products: ProductItem[];
  levels: StockLevelRow[];
  recent: RecentMovementRow[];
  summary: StockSummary;
  canManageProducts: boolean;
  suppliers: { id: string; name: string }[];
  forecast: ForecastRow[];
  forecastToday: string;
  destinations: CenterItem[];
  transfers: TransferView[];
  transfersNextBefore: string | null;
  inbox: TransferInbox;
  isOwner: boolean;
  // Transfert suggéré (lien depuis « Analyses IA ») : le formulaire s'ouvre prérempli ; rien ne part sans validation.
  prefill: TransferPrefill | null;
}) {
  const { t, lang } = useI18n();
  const feedback = useFeedback();
  const dialog = useConfirm();
  const [modal, setModal] = useState<Modal | null>(prefill ? { type: "transfer", initial: prefill } : null);
  const [tab, setTab] = useState<"levels" | "products">("levels");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("ALL");
  const [sort, setSort] = useState<LevelSort>("NAME");
  const [supplierFilter, setSupplierFilter] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const target = (l: StockLevelRow): LevelTarget => ({
    productId: l.productId,
    centerId: l.centerId,
    productName: l.productName,
    unit: l.unit,
    centerName: centerName(centers, l.centerId),
    quantity: l.quantity,
    alertThreshold: l.alertThreshold,
  });
  const done = (message: string) => feedback.show(message);
  const needle = query.trim().toLowerCase();
  const supplierOf = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.supplierId])), [products]);
  const stateCounts = useMemo(() => countByState(levels), [levels]);
  const visibleLevels = useMemo(
    () => sortLevels(filterLevels(levels, { state: stateFilter, supplierId: supplierFilter === "" ? null : supplierFilter, needle }, supplierOf), sort),
    [levels, stateFilter, supplierFilter, needle, sort, supplierOf],
  );
  const visibleProducts = useMemo(() => products.filter((p) => !needle || p.name.toLowerCase().includes(needle)), [products, needle]);
  const staleItems = levels.filter((l) => l.needsRepair).map((l) => ({ productId: l.productId, centerId: l.centerId }));
  const openOrders = summary.ordersByStatus.DRAFT + summary.ordersByStatus.ORDERED;
  const countFormat = (value: number, l: string) => fmtQty(value, l);

  const archive = (p: ProductItem) => {
    dialog.ask({ title: t("Archiver ce produit ?"), message: t("Son historique est conservé."), confirmLabel: t("Archiver"), danger: true }, () =>
      startTransition(async () => {
        const r = await archiveStockProductAction({ productId: p.id });
        feedback.show(r.ok ? (r.message ?? "Produit archivé.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
      }),
    );
  };
  const remove = (p: ProductItem) => {
    dialog.ask({ title: t("Supprimer ce produit ?"), message: t("Cette action est irréversible. S'il a un historique, archivez-le plutôt."), confirmLabel: t("Supprimer"), danger: true }, () =>
      startTransition(async () => {
        const r = await deleteStockProductAction({ productId: p.id });
        feedback.show(r.ok ? (r.message ?? "Produit supprimé.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
      }),
    );
  };
  const repair = () =>
    startTransition(async () => {
      const r = await repairStockLevelsAction(staleItems);
      feedback.show(r.ok ? (r.message ?? "") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
    });

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <CenterFilter centers={centers} selectedId={selectedCenterId} basePath="/dashboard/stock" />
        <div className="ms-auto flex flex-wrap gap-2">
          {canManageProducts && (
            <button type="button" onClick={() => setModal({ type: "product", product: null })} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/5">
              <PlusIcon width={16} height={16} /> {t("Nouveau produit")}
            </button>
          )}
          <button type="button" onClick={() => setModal({ type: "transfer", initial: null })} className="flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/5">
            <BoxIcon width={16} height={16} /> {t("Transférer")}
          </button>
          <button type="button" onClick={() => setModal({ type: "activate" })} className="btn-shine flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950">
            <BoxIcon width={16} height={16} /> {t("Activer un produit")}
          </button>
        </div>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Produits actifs" value={<bdi>{fmtQty(summary.activeProducts, lang)}</bdi>} hint="dans le catalogue" />
        <StatTile label="Niveaux suivis" value={<bdi>{fmtQty(summary.levelCount, lang)}</bdi>} hint="produits par centre" />
        <StatTile label="À surveiller" value={<span className={summary.lowStockCount > 0 ? "text-amber-200" : ""}><bdi>{fmtQty(summary.lowStockCount, lang)}</bdi></span>} hint="quantité ≤ seuil" />
        <StatTile label="Maintenances en retard" value={<span className={summary.maintenance.overdue > 0 ? "text-red-300" : ""}><bdi>{fmtQty(summary.maintenance.overdue, lang)}</bdi></span>} hint="matériel à vérifier" />
        <StatTile label="Commandes en cours" value={<bdi>{fmtQty(openOrders, lang)}</bdi>} hint="brouillons et commandées" />
      </div>

      {summary.needsRepairCount > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <AlertIcon width={18} height={18} />
          <span className="flex-1">
            <bdi>{fmtQty(summary.needsRepairCount, lang)}</bdi> {t("niveau(x) en cours de réalignement sur le journal. Les quantités affichées sont celles du journal.")}
          </span>
          <button type="button" disabled={pending} onClick={repair} className="rounded-xl border border-sky-300/40 px-3 py-1.5 text-xs transition hover:bg-sky-400/10 disabled:opacity-60">
            {pending ? t("Un instant…") : t("Réaligner maintenant")}
          </button>
        </div>
      )}

      <ForecastPanel rows={forecast} todayKey={forecastToday} centers={centers} suppliers={suppliers} onFeedback={feedback.show} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Produits à surveiller" subtitle="Quantité inférieure ou égale au seuil d'alerte">
          {summary.attention.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/45">{t("Aucun produit à surveiller.")}</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {summary.attention.map((l) => (
                <li key={`${l.productId}:${l.centerId}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">{l.productName}</p>
                    <p className="text-xs text-white/45">
                      {centerName(centers, l.centerId)} · {t("seuil")} <Qty value={l.alertThreshold} unit={l.unit} />
                    </p>
                  </div>
                  <Chip tone={l.quantity === 0 ? "bad" : "warn"}>
                    <Qty value={l.quantity} unit={l.unit} />
                  </Chip>
                  <button type="button" onClick={() => setModal({ type: "movement", target: target(l) })} className="text-xs text-white/60 hover:text-white">
                    {t("Mouvement")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {summary.lowStockCount > summary.attention.length && (
            <button type="button" onClick={() => { setTab("levels"); setStateFilter("WATCH"); }} className="mt-3 text-xs text-champagne hover:underline">
              {t("Voir tous les niveaux à surveiller")}
            </button>
          )}
        </Panel>

        <Panel title="Matériel" subtitle="Équipements actifs par état">
          <BarList
            rows={EQUIPMENT_STATUSES.map((s) => ({ key: s, label: EQUIPMENT_STATUS_LABELS[s], amount: summary.equipmentByStatus[s] }))}
            empty="Aucun équipement."
            translateLabels
            formatValue={countFormat}
          />
          <div className="mt-5 border-t border-white/5 pt-4">
            <p className="mb-2 text-xs uppercase tracking-wider text-white/45">{t("Prochaines maintenances")}</p>
            {summary.maintenance.upcoming.length === 0 ? (
              <p className="text-sm text-white/45">{t("Aucune maintenance programmée.")}</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.maintenance.upcoming.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-white/80">
                      {e.name} <span className="text-white/40">· {centerName(centers, e.centerId)}</span>
                    </span>
                    {e.nextMaintenanceAt && <DateText value={e.nextMaintenanceAt} />}
                    <Chip tone={e.maintenanceState === "OVERDUE" ? "bad" : e.maintenanceState === "DUE_TODAY" ? "warn" : "info"}>{t(MAINTENANCE_STATE_LABELS[e.maintenanceState])}</Chip>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/dashboard/stock/materiel" className="mt-3 inline-block text-xs text-champagne hover:underline">
              {t("Gérer le matériel")}
            </Link>
          </div>
        </Panel>

        <Panel title="Commandes d'achat" subtitle="Répartition par statut">
          <BarList
            rows={PURCHASE_ORDER_STATUSES.map((s) => ({ key: s, label: PURCHASE_ORDER_STATUS_LABELS[s], amount: summary.ordersByStatus[s] }))}
            empty="Aucune commande."
            translateLabels
            formatValue={countFormat}
          />
          <Link href="/dashboard/stock/commandes" className="mt-4 inline-block text-xs text-champagne hover:underline">
            {t("Gérer les commandes")}
          </Link>
        </Panel>

        <div className="lg:col-span-2">
          <TransfersPanel initial={transfers} nextBefore={transfersNextBefore} centers={destinations} selectedCenterId={selectedCenterId} sourceCenterIds={centers.map((c) => c.id)} inbox={inbox} isOwner={isOwner} products={products} onFeedback={feedback.show} />
        </div>

        <Panel title="Mouvements récents" subtitle="Tous produits, centres autorisés">
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/45">{t("Aucun mouvement enregistré.")}</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((m) => (
                <li key={`${m.productId}:${m.centerId}:${m.seq}`} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">{m.productName}</p>
                    <p className="text-xs text-white/45">
                      {centerName(centers, m.centerId)} · {t(STOCK_MOVEMENT_KIND_LABELS[m.kind])} · <DateText value={m.createdAt} withTime />
                    </p>
                  </div>
                  <span className={`text-sm ${m.delta < 0 ? "text-amber-200" : "text-emerald-200"}`}>
                    <Qty value={m.delta} unit={m.unit} signed />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t("Affichage")} className="inline-flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1.5">
            {(
              [
                ["levels", "Niveaux par centre"],
                ["products", "Catalogue des produits"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-xl px-4 py-2 text-sm transition ${tab === key ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <label className="relative ms-auto min-w-48 flex-1 sm:max-w-xs">
            <span className="sr-only">{t("Rechercher un produit")}</span>
            <SearchIcon width={16} height={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Rechercher un produit")}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pe-3 ps-9 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60"
            />
          </label>
        </div>

        {tab === "levels" && (
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("Filtrer par état")} className="flex flex-wrap gap-1.5">
              {(
                [
                  ["ALL", "Tous"],
                  ["WATCH", "À surveiller"],
                  ["OUT", "Rupture"],
                  ["LOW", "Stock bas"],
                  ["OK", "Stock suffisant"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={stateFilter === key}
                  onClick={() => setStateFilter(key)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${stateFilter === key ? "border-rose-gold/60 bg-gradient-to-r from-blush/20 to-champagne/20 text-white" : "border-white/10 text-white/60 hover:bg-white/5"}`}
                >
                  {t(label)} (<bdi>{fmtQty(stateCounts[key], lang)}</bdi>)
                </button>
              ))}
            </div>
            <label className="ms-auto flex items-center gap-2 text-xs text-white/60">
              {t("Fournisseur")}
              <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className={`${selectClass} py-1 text-xs`}>
                <option value="">{t("Tous")}</option>
                <option value="NONE">{t("Sans fournisseur")}</option>
                {suppliers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-white/60">
              {t("Trier par")}
              <select value={sort} onChange={(e) => setSort(e.target.value as LevelSort)} className={`${selectClass} py-1 text-xs`}>
                <option value="NAME">{t("Nom")}</option>
                <option value="QUANTITY">{t("Quantité croissante")}</option>
                <option value="CRITICAL">{t("Plus critique d'abord")}</option>
              </select>
            </label>
          </div>
        )}

        {tab === "levels" ? (
          visibleLevels.length === 0 ? (
            <EmptyState>{levels.length === 0 ? t("Aucun produit activé. Activez un produit dans un centre pour suivre son stock.") : t("Aucun niveau ne correspond.")}</EmptyState>
          ) : (
            <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleLevels.map((l) => {
                const alert = l.lowStock && l.productActive;
                return (
                  <li key={`${l.productId}:${l.centerId}`} className={`glass rounded-3xl p-5 ${alert ? "ring-1 ring-amber-300/30" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{l.productName}</p>
                        <p className="text-xs text-white/45">{centerName(centers, l.centerId)}</p>
                      </div>
                      {!l.productActive ? <Chip tone="muted">{t("Archivé")}</Chip> : l.quantity === 0 ? <Chip tone="bad">{t("Rupture")}</Chip> : alert ? <Chip tone="warn">{t("Stock bas")}</Chip> : <Chip tone="ok">{t("Stock suffisant")}</Chip>}
                    </div>
                    <p className="mt-4 text-2xl font-semibold text-white">
                      <Qty value={l.quantity} unit={l.unit} />
                    </p>
                    <p className="text-xs text-white/45">
                      {t("Seuil d'alerte")} : <Qty value={l.alertThreshold} unit={l.unit} />
                    </p>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {l.productActive && (
                        <button type="button" onClick={() => setModal({ type: "movement", target: target(l) })} className="font-medium text-champagne hover:underline">
                          {t("Mouvement")}
                        </button>
                      )}
                      {l.productActive && (
                        <button type="button" onClick={() => setModal({ type: "transfer", initial: { productId: l.productId, centerId: l.centerId } })} className="text-white/60 hover:text-white">
                          {t("Transférer")}
                        </button>
                      )}
                      <button type="button" onClick={() => setModal({ type: "history", target: target(l) })} className="text-white/60 hover:text-white">
                        {t("Historique")}
                      </button>
                      <button type="button" onClick={() => setModal({ type: "sheet", productId: l.productId })} className="text-white/60 hover:text-white">
                        {t("Fiche")}
                      </button>
                      {l.productActive && (
                        <button type="button" onClick={() => setModal({ type: "threshold", target: target(l) })} className="text-white/60 hover:text-white">
                          {t("Seuil")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : visibleProducts.length === 0 ? (
          <EmptyState>{products.length === 0 ? t("Aucun produit dans le catalogue.") : t("Aucun produit ne correspond.")}</EmptyState>
        ) : (
          <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProducts.map((p) => {
              const own = levels.filter((l) => l.productId === p.id);
              const alerts = own.filter((l) => l.lowStock).length;
              const total = own.reduce((n, l) => n + l.quantity, 0);
              return (
                <li key={p.id} className="glass rounded-3xl p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium text-white">{p.name}</p>
                    {p.active ? <Chip tone="ok">{t("Actif")}</Chip> : <Chip tone="muted">{t("Archivé")}</Chip>}
                  </div>
                  <p className="mt-1 text-xs text-white/45">
                    {t("Unité")} : {t(STOCK_UNIT_LABELS[p.unit])} · {t("centres")} : <bdi>{fmtQty(own.length, lang)}</bdi>
                  </p>
                  <p className="mt-3 text-lg text-white">
                    <Qty value={total} unit={p.unit} />
                  </p>
                  {alerts > 0 && (
                    <p className="text-xs text-amber-200">
                      <bdi>{fmtQty(alerts, lang)}</bdi> {t("niveau(x) à surveiller")}
                    </p>
                  )}
                  <div className="mt-4 flex gap-4 text-xs">
                    <button type="button" onClick={() => setModal({ type: "sheet", productId: p.id })} className="font-medium text-champagne hover:underline">
                      {t("Fiche")}
                    </button>
                    {canManageProducts && (
                      <>
                      {p.active && (
                        <button type="button" onClick={() => setModal({ type: "product", product: p })} className="text-white/60 hover:text-white">
                          {t("Modifier")}
                        </button>
                      )}
                      {p.active && (
                        <button type="button" disabled={pending} onClick={() => archive(p)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                          {t("Archiver")}
                        </button>
                      )}
                      <button type="button" disabled={pending} onClick={() => remove(p)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                        {t("Supprimer")}
                      </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {modal?.type === "movement" && <MovementModal target={modal.target} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "threshold" && <ThresholdModal target={modal.target} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "history" && <HistoryModal target={modal.target} onClose={() => setModal(null)} />}
      {modal?.type === "activate" && <ActivateModal products={products} centers={centers} defaultCenterId={selectedCenterId} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "transfer" && <ProductTransferModal levels={levels} sources={centers} destinations={destinations} initial={modal.initial} levelsComplete={selectedCenterId === null} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "sheet" &&
        (() => {
          const product = products.find((p) => p.id === modal.productId);
          if (!product) return null;
          return (
            <ProductSheetModal
              product={product}
              levels={levels}
              forecast={forecast}
              centers={centers}
              supplierName={suppliers.find((x) => x.id === product.supplierId)?.name ?? forecast.find((f) => f.productId === product.id)?.supplierName ?? null}
              onHistory={(l) => setModal({ type: "history", target: target(l) })}
              onClose={() => setModal(null)}
            />
          );
        })()}
      {modal?.type === "product" && <ProductModal product={modal.product} suppliers={suppliers} onClose={() => setModal(null)} onDone={done} />}
      {feedback.node}
      {dialog.node}
    </div>
  );
}
