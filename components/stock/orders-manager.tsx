"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import {
  cancelPurchaseOrderAction,
  createPurchaseOrderAction,
  placePurchaseOrderAction,
  receiveStockPurchaseOrderAction,
  updateDraftPurchaseOrderAction,
} from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { PURCHASE_ORDER_STATUSES, type PurchaseOrderStatus } from "@/lib/enums";
import { PURCHASE_ORDER_STATUS_LABELS, STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import type { PurchaseOrderView } from "@/lib/stock/purchase-orders";
import type { SupplierView } from "@/lib/stock/suppliers";
import { CenterFilter, Chip, DateText, EmptyState, FieldError, Qty, centerName, fmtQty, useFeedback, useSubmit, type CenterItem, type ChipTone, type ProductItem } from "./stock-shared";

// F5.5 — Commandes d'achat et réception. Créer, modifier, passer ou annuler une commande ne touche JAMAIS le stock ; seule la réception
// (receiveStockPurchaseOrderAction, unique point d'entrée) crédite le stock, une seule fois par ligne, avec reprise sûre après interruption.
// Le nom du produit, l'unité et le nom du fournisseur affichés viennent de la commande (copie du serveur), jamais d'une saisie.

const STATUS_TONE: Record<PurchaseOrderStatus, ChipTone> = { DRAFT: "muted", ORDERED: "info", RECEIVED: "ok", CANCELLED: "bad" };
const reference = (id: string) => id.slice(-6).toUpperCase();

type LineDraft = { productId: string; quantity: string };

export function OrdersManager({
  centers,
  selectedCenterId,
  orders,
  suppliers,
  products,
  activated,
}: {
  centers: CenterItem[];
  selectedCenterId: string | null;
  orders: PurchaseOrderView[];
  suppliers: SupplierView[];
  products: ProductItem[];
  activated: Record<string, string[]>;
}) {
  const { t } = useI18n();
  const feedback = useFeedback();
  const [form, setForm] = useState<{ order: PurchaseOrderView | null } | null>(null);
  const [detail, setDetail] = useState<{ id: string; problems: string[] } | null>(null);
  const [status, setStatus] = useState<PurchaseOrderStatus | "">("");
  const [pending, startTransition] = useTransition();
  const visible = useMemo(() => orders.filter((o) => !status || o.status === status), [orders, status]);
  const detailOrder = detail ? (orders.find((o) => o.id === detail.id) ?? null) : null;

  const run = (call: () => Promise<{ ok: boolean; message?: string; errors?: Record<string, string[]> }>, orderId?: string, order?: PurchaseOrderView) =>
    startTransition(async () => {
      const r = await call();
      feedback.show(r.ok ? (r.message ?? "") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
      // Réception incomplète : les lignes en cause sont expliquées dans le détail de la commande.
      if (!r.ok && r.errors && orderId && order) {
        const problems = Object.entries(r.errors).map(([productId, messages]) => `${order.lines.find((l) => l.productId === productId)?.productName ?? productId} : ${t(messages[0] ?? "")}`);
        setDetail({ id: orderId, problems });
      }
    });

  const place = (o: PurchaseOrderView) => confirm(t("Passer cette commande ? Elle ne sera plus modifiable.")) && run(() => placePurchaseOrderAction({ orderId: o.id }));
  const cancel = (o: PurchaseOrderView) => confirm(t("Annuler cette commande ?")) && run(() => cancelPurchaseOrderAction({ orderId: o.id }));
  const receive = (o: PurchaseOrderView) => confirm(t("Réceptionner cette commande ? Le stock de chaque ligne sera crédité une seule fois.")) && run(() => receiveStockPurchaseOrderAction({ orderId: o.id }), o.id, o);

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <CenterFilter centers={centers} selectedId={selectedCenterId} basePath="/dashboard/stock/commandes" />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <select aria-label={t("Statut")} value={status} onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | "")} className={selectClass}>
            <option value="">{t("Tous les statuts")}</option>
            {PURCHASE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(PURCHASE_ORDER_STATUS_LABELS[s])}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setForm({ order: null })} className="btn-shine flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950">
            <PlusIcon width={16} height={16} /> {t("Nouvelle commande")}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState>{orders.length === 0 ? t("Aucune commande. Créez un brouillon pour réapprovisionner un centre.") : t("Aucune commande ne correspond.")}</EmptyState>
      ) : (
        <ul className="stagger grid gap-3 md:grid-cols-2">
          {visible.map((o) => (
            <li key={o.id} className="glass rounded-3xl p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {t("Commande")} <bdi className="tabular-nums">#{reference(o.id)}</bdi>
                  </p>
                  <p className="truncate text-sm text-white/70">{o.supplierName}</p>
                  <p className="text-xs text-white/45">{centerName(centers, o.centerId)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Chip tone={STATUS_TONE[o.status]}>{t(PURCHASE_ORDER_STATUS_LABELS[o.status])}</Chip>
                  {o.receiving && <Chip tone="warn">{t("Réception en cours")}</Chip>}
                </div>
              </div>
              <ul className="mt-3 space-y-0.5 text-sm text-white/75">
                {o.lines.slice(0, 3).map((l) => (
                  <li key={l.productId} className="flex justify-between gap-3">
                    <span className="truncate">{l.productName}</span>
                    <Qty value={l.quantity} unit={l.unit} />
                  </li>
                ))}
                {o.lines.length > 3 && <li className="text-xs text-white/40">+ <bdi>{o.lines.length - 3}</bdi> {t("autre(s) ligne(s)")}</li>}
              </ul>
              <p className="mt-3 text-xs text-white/45">
                {t("Créée le")} <DateText value={o.createdAt} />
                {o.orderedAt && <> · {t("commandée le")} <DateText value={o.orderedAt} /></>}
                {o.receivedAt && <> · {t("reçue le")} <DateText value={o.receivedAt} /></>}
                {o.cancelledAt && <> · {t("annulée le")} <DateText value={o.cancelledAt} /></>}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <button type="button" onClick={() => setDetail({ id: o.id, problems: [] })} className="text-white/60 hover:text-white">
                  {t("Détails")}
                </button>
                {o.status === "DRAFT" && (
                  <>
                    <button type="button" onClick={() => setForm({ order: o })} className="text-white/60 hover:text-white">
                      {t("Modifier")}
                    </button>
                    <button type="button" disabled={pending} onClick={() => place(o)} className="font-medium text-champagne hover:underline disabled:opacity-60">
                      {t("Passer la commande")}
                    </button>
                  </>
                )}
                {o.status === "ORDERED" && (
                  <button type="button" disabled={pending} onClick={() => receive(o)} className="font-medium text-champagne hover:underline disabled:opacity-60">
                    {pending ? t("Un instant…") : o.receiving ? t("Reprendre la réception") : t("Réceptionner")}
                  </button>
                )}
                {(o.status === "DRAFT" || (o.status === "ORDERED" && !o.receiving)) && (
                  <button type="button" disabled={pending} onClick={() => cancel(o)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                    {t("Annuler")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && <OrderFormModal order={form.order} centers={centers} defaultCenterId={selectedCenterId} suppliers={suppliers} products={products} activated={activated} onClose={() => setForm(null)} onDone={(m) => feedback.show(m)} />}
      {detail && detailOrder && (
        <Modal open onClose={() => setDetail(null)} title={`${t("Commande")} #${reference(detailOrder.id)}`}>
          <div className="space-y-4">
            {detail.problems.length > 0 && (
              <Alert>
                <p className="mb-1 font-medium">{t("Réception incomplète : certaines lignes n'ont pas pu être traitées. Réessayez.")}</p>
                <ul className="list-disc ps-5 text-xs">
                  {detail.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <p className="text-sm text-white/70">
              {detailOrder.supplierName} · {centerName(centers, detailOrder.centerId)} · <Chip tone={STATUS_TONE[detailOrder.status]}>{t(PURCHASE_ORDER_STATUS_LABELS[detailOrder.status])}</Chip>
            </p>
            <ul className="divide-y divide-white/5">
              {detailOrder.lines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-3 py-2 text-sm text-white">
                  <span>{l.productName}</span>
                  <Qty value={l.quantity} unit={l.unit} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-white/45">
              {detailOrder.status === "RECEIVED" ? t("Les mouvements de réception figurent dans l'historique de chaque produit.") : t("Le stock n'est crédité qu'à la réception de la commande.")}{" "}
              <Link href="/dashboard/stock" className="text-champagne hover:underline">
                {t("Voir le stock")}
              </Link>
            </p>
          </div>
        </Modal>
      )}
      {feedback.node}
    </div>
  );
}

function OrderFormModal({
  order,
  centers,
  defaultCenterId,
  suppliers,
  products,
  activated,
  onClose,
  onDone,
}: {
  order: PurchaseOrderView | null;
  centers: CenterItem[];
  defaultCenterId: string | null;
  suppliers: SupplierView[];
  products: ProductItem[];
  activated: Record<string, string[]>;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const { t, lang } = useI18n();
  const uid = useId();
  const [centerId, setCenterId] = useState(order?.centerId ?? defaultCenterId ?? centers[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? suppliers[0]?.id ?? "");
  const [lines, setLines] = useState<LineDraft[]>(order ? order.lines.map((l) => ({ productId: l.productId, quantity: String(l.quantity) })) : [{ productId: "", quantity: "" }]);
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  // Produits proposables : actifs et déjà activés dans le centre de livraison (règle du service).
  const available = products.filter((p) => (activated[centerId] ?? []).includes(p.id));
  const unitOf = (id: string) => products.find((p) => p.id === id)?.unit;
  const changeCenter = (id: string) => {
    setCenterId(id);
    setLines([{ productId: "", quantity: "" }]);
  };
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const payload = lines.map((l) => ({ productId: l.productId, quantity: l.quantity.trim() === "" ? undefined : Number(l.quantity) }));

  return (
    <Modal open onClose={onClose} title={t(order ? "Modifier le brouillon" : "Nouvelle commande")} wide>
      {suppliers.length === 0 ? (
        <p className="text-sm text-white/60">{t("Aucun fournisseur actif. Le propriétaire doit d'abord en ajouter un.")}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => (order ? updateDraftPurchaseOrderAction({ orderId: order.id, supplierId, lines: payload }) : createPurchaseOrderAction({ centerId, supplierId, lines: payload })));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${uid}-center`}>{t("Centre de livraison")}</label>
              {order ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white/70">{centerName(centers, order.centerId)}</p>
              ) : (
                <select id={`${uid}-center`} value={centerId} onChange={(e) => changeCenter(e.target.value)} className={`${selectClass} w-full`}>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor={`${uid}-supplier`}>{t("Fournisseur")}</label>
              <select id={`${uid}-supplier`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${selectClass} w-full`}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <FieldError errors={errors} name="supplierId" />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className={labelClass}>{t("Lignes de la commande")}</legend>
            {available.length === 0 && <p className="text-xs text-amber-200">{t("Aucun produit activé dans ce centre : activez d'abord un produit depuis la vue d'ensemble.")}</p>}
            {lines.map((line, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className="sr-only" htmlFor={`${uid}-p${i}`}>{t("Produit")}</label>
                  <select id={`${uid}-p${i}`} value={line.productId} onChange={(e) => setLine(i, { productId: e.target.value })} className={`${selectClass} w-full`}>
                    <option value="">{t("Choisir un produit")}</option>
                    {available
                      .filter((p) => p.id === line.productId || !lines.some((l) => l.productId === p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="sr-only" htmlFor={`${uid}-q${i}`}>{t("Quantité")}</label>
                  <input id={`${uid}-q${i}`} inputMode="numeric" placeholder={t("Quantité")} value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={inputClass} />
                </div>
                <span className="w-10 pb-3 text-xs text-white/45">{unitOf(line.productId) ? t(STOCK_UNIT_LABELS[unitOf(line.productId)!]) : ""}</span>
                <button
                  type="button"
                  aria-label={t("Retirer la ligne")}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 text-white/50 transition hover:text-red-300 disabled:opacity-40"
                >
                  <TrashIcon width={16} height={16} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "" }])} disabled={lines.length >= 50} className="text-xs text-champagne hover:underline disabled:opacity-40">
              + {t("Ajouter une ligne")}
            </button>
            <FieldError errors={errors} name="lines" />
            <p className="text-xs text-white/40">
              {t("Quantités entières dans l'unité du produit.")} <bdi>{fmtQty(lines.length, lang)}</bdi> {t("ligne(s)")}.
            </p>
          </fieldset>
          {message && <Alert>{t(message)}</Alert>}
          <SubmitButton pending={pending}>{t("Enregistrer le brouillon")}</SubmitButton>
        </form>
      )}
    </Modal>
  );
}
