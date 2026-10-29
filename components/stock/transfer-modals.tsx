"use client";

import { useId, useState, useTransition } from "react";
import { listStockTransfersAction, resumeStockTransferAction, transferEquipmentAction, transferStockProductAction } from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { Panel, selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import type { StockTransferStatus, StockUnit } from "@/lib/enums";
import type { EquipmentView } from "@/lib/stock/equipment";
import { STOCK_TRANSFER_KIND_LABELS, STOCK_TRANSFER_STATUS_LABELS, STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import type { StockLevelRow } from "@/lib/stock/service";
import type { TransferView } from "@/lib/stock/transfers";
import { Chip, DateText, FieldError, Qty, centerName, useSubmit, type CenterItem } from "./stock-shared";

// F5.6 — Transferts entre centres : fenêtres de transfert d'un produit et d'un équipement, et historique. Aucune règle métier ici : les
// actions serveur revérifient tout (rôle, centre source dans le périmètre, destination dans l'organisation, quantité plafonnée au stock
// disponible). L'interface limite les choix et protège du double envoi : le bouton est désactivé pendant l'appel et chaque formulaire
// porte un identifiant de demande (requestId) qui rend un nouvel envoi idempotent côté serveur.

type Done = (message: string) => void;

// Identifiant de demande : aléatoire, accepté par le serveur (16 à 64 caractères alphanumériques, « - » et « _ »). randomUUID n'existe
// que dans un contexte sécurisé (https, localhost) : repli sur getRandomValues.
function newRequestId() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const toNumber = (value: string): number | undefined => (value.trim() === "" ? undefined : Number(value.replace(/\s/g, "")));

// ── Transfert d'un produit ──
export function ProductTransferModal({
  levels,
  sources,
  destinations,
  initial,
  onClose,
  onDone,
}: {
  levels: StockLevelRow[];
  sources: CenterItem[];
  destinations: CenterItem[];
  initial: { productId: string; centerId: string } | null;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useI18n();
  const uid = useId();
  const usable = levels.filter((l) => l.productActive);
  const optionsFor = (centerId: string) => usable.filter((l) => l.centerId === centerId);
  const destinationsFor = (centerId: string) => destinations.filter((c) => c.id !== centerId);
  const sourceChoices = sources.filter((c) => optionsFor(c.id).length > 0);
  const firstSource = initial?.centerId ?? sourceChoices[0]?.id ?? "";

  const [fromId, setFromId] = useState(firstSource);
  const [productId, setProductId] = useState(initial?.productId ?? optionsFor(firstSource)[0]?.productId ?? "");
  const [toId, setToId] = useState(destinationsFor(firstSource)[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [result, setResult] = useState<{ requested: number; transferred: number; unit: StockUnit; capped: boolean } | null>(null);
  const { pending, errors, message, submit } = useSubmit(onDone);

  const level = optionsFor(fromId).find((l) => l.productId === productId);
  const available = level?.quantity ?? 0;
  const unit: StockUnit = level?.unit ?? "PIECE";
  // Toute modification du formulaire est une nouvelle demande : un nouvel identifiant évite de la confondre avec un envoi précédent.
  const edit = () => setRequestId(newRequestId());

  const changeSource = (id: string) => {
    setFromId(id);
    setProductId(optionsFor(id)[0]?.productId ?? "");
    if (toId === id || toId === "") setToId(destinationsFor(id)[0]?.id ?? "");
    edit();
  };

  return (
    <Modal open onClose={onClose} title={t("Transférer un produit")}>
      {result ? (
        <div className="space-y-4">
          <Alert tone="success">{t(result.capped ? "Transfert effectué : la quantité a été plafonnée au stock disponible." : "Transfert effectué.")}</Alert>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-white/60">{t("Quantité demandée")}</dt>
              <dd className="text-white">
                <Qty value={result.requested} unit={result.unit} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/60">{t("Quantité transférée")}</dt>
              <dd className="font-semibold text-white">
                <Qty value={result.transferred} unit={result.unit} />
              </dd>
            </div>
          </dl>
          <button type="button" onClick={onClose} className="w-full rounded-2xl border border-white/10 py-2.5 text-sm text-white/80 transition hover:bg-white/5">
            {t("Fermer")}
          </button>
        </div>
      ) : sourceChoices.length === 0 ? (
        <p className="text-sm text-white/60">{t("Aucun produit activé dans vos centres : activez d'abord un produit pour pouvoir le transférer.")}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            submit(async () => {
              const r = await transferStockProductAction({ requestId, fromCenterId: fromId, toCenterId: toId, productId, quantity: toNumber(quantity) });
              if (r.ok) setResult({ requested: r.requested ?? 0, transferred: r.transferred ?? 0, unit, capped: r.capped });
              return r;
            });
          }}
        >
          <div>
            <label className={labelClass} htmlFor={`${uid}-from`}>{t("Centre source")}</label>
            <select id={`${uid}-from`} value={fromId} onChange={(e) => changeSource(e.target.value)} className={`${selectClass} w-full`}>
              {sourceChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-product`}>{t("Produit")}</label>
            <select
              id={`${uid}-product`}
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                edit();
              }}
              className={`${selectClass} w-full`}
            >
              {optionsFor(fromId).map((l) => (
                <option key={l.productId} value={l.productId}>
                  {l.productName} ({t(STOCK_UNIT_LABELS[l.unit])})
                </option>
              ))}
            </select>
            <FieldError errors={errors} name="productId" />
            <p className="mt-1 text-xs text-white/55">
              {t("Stock disponible")} : <Qty value={available} unit={unit} />
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-to`}>{t("Centre de destination")}</label>
            <select
              id={`${uid}-to`}
              value={toId}
              onChange={(e) => {
                setToId(e.target.value);
                edit();
              }}
              className={`${selectClass} w-full`}
            >
              {destinationsFor(fromId).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-qty`}>
              {t("Quantité")} ({t(STOCK_UNIT_LABELS[unit])})
            </label>
            <input
              id={`${uid}-qty`}
              inputMode="numeric"
              required
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                edit();
              }}
              className={inputClass}
              aria-describedby={`${uid}-qty-hint`}
            />
            <p id={`${uid}-qty-hint`} className="mt-1 text-xs text-white/40">
              {t("Nombre entier positif.")} {t("Si la quantité dépasse le stock disponible, elle est plafonnée au disponible.")}
            </p>
            <FieldError errors={errors} name="quantity" />
          </div>
          {message && <Alert>{t(message)}</Alert>}
          <FieldError errors={errors} name="requestId" />
          <SubmitButton pending={pending}>{t("Transférer")}</SubmitButton>
        </form>
      )}
    </Modal>
  );
}

// ── Transfert d'un équipement ──
export function EquipmentTransferModal({ equipment, destinations, onClose, onDone }: { equipment: EquipmentView; destinations: CenterItem[]; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const choices = destinations.filter((c) => c.id !== equipment.centerId);
  const [toId, setToId] = useState(choices[0]?.id ?? "");
  const [requestId, setRequestId] = useState(newRequestId);
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Transférer un équipement")}>
      <p className="mb-4 text-sm text-white/60">
        {equipment.name} · {centerName(destinations, equipment.centerId)}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          submit(() => transferEquipmentAction({ requestId, equipmentId: equipment.id, toCenterId: toId }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-to`}>{t("Centre de destination")}</label>
          <select
            id={`${uid}-to`}
            value={toId}
            onChange={(e) => {
              setToId(e.target.value);
              setRequestId(newRequestId());
            }}
            className={`${selectClass} w-full`}
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <FieldError errors={errors} name="equipmentId" />
        </div>
        <p className="text-xs text-white/40">{t("L'équipement garde son identité et son historique de maintenance.")}</p>
        {message && <Alert>{t(message)}</Alert>}
        <FieldError errors={errors} name="requestId" />
        <SubmitButton pending={pending}>{t("Transférer")}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Historique des transferts ──
const STATUS_TONE: Record<StockTransferStatus, "ok" | "warn" | "muted"> = { COMPLETED: "ok", PENDING: "warn", CANCELLED: "muted" };

export function TransfersPanel({
  initial,
  nextBefore,
  centers,
  selectedCenterId,
  sourceCenterIds,
  onFeedback,
}: {
  initial: TransferView[];
  nextBefore: string | null;
  centers: CenterItem[];
  selectedCenterId: string | null;
  sourceCenterIds: string[];
  onFeedback: (text: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const [more, setMore] = useState<{ items: TransferView[]; next: string | null } | null>(null);
  const [loading, startLoading] = useTransition();
  const [resuming, startResume] = useTransition();
  const known = new Set(initial.map((x) => x.id));
  const items = [...initial, ...(more?.items.filter((x) => !known.has(x.id)) ?? [])];
  const next = more ? more.next : nextBefore;

  const loadMore = () =>
    startLoading(async () => {
      const cursor = items[items.length - 1]?.id;
      const r = await listStockTransfersAction({ centerId: selectedCenterId ?? undefined, before: cursor, limit: 10 });
      if (r.ok) setMore({ items: [...(more?.items ?? []), ...r.transfers], next: r.nextBefore });
      else onFeedback(r.message ?? "Une erreur est survenue. Réessayez.", "error");
    });
  const resume = (id: string) =>
    startResume(async () => {
      const r = await resumeStockTransferAction({ transferId: id });
      onFeedback(r.ok ? (r.message ?? "") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
    });

  return (
    <Panel title="Transferts entre centres" subtitle="Produits et matériel, du plus récent au plus ancien">
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/45">{t("Aucun transfert enregistré.")}</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {items.map((x) => {
            const unit = x.unit ?? "PIECE";
            const capped = x.requestedQuantity !== null && x.transferredQuantity !== null && x.transferredQuantity < x.requestedQuantity;
            return (
              <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{x.productName ?? x.equipmentName ?? "—"}</p>
                  <p className="text-xs text-white/45">
                    {centerName(centers, x.fromCenterId)} <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span> {centerName(centers, x.toCenterId)} · <DateText value={x.createdAt} withTime />
                  </p>
                </div>
                <Chip tone="muted">{t(STOCK_TRANSFER_KIND_LABELS[x.kind])}</Chip>
                {x.kind === "PRODUCT" && x.status === "COMPLETED" && (
                  <span className="text-sm text-white">
                    <Qty value={x.transferredQuantity ?? 0} unit={unit} />
                    {capped && (
                      <span className="block text-xs text-white/45">
                        {t("demandé")} <Qty value={x.requestedQuantity ?? 0} unit={unit} />
                      </span>
                    )}
                  </span>
                )}
                <Chip tone={STATUS_TONE[x.status]}>{t(STOCK_TRANSFER_STATUS_LABELS[x.status])}</Chip>
                {x.status === "PENDING" && sourceCenterIds.includes(x.fromCenterId) && (
                  <button type="button" disabled={resuming} onClick={() => resume(x.id)} className="text-xs font-medium text-champagne hover:underline disabled:opacity-60">
                    {resuming ? t("Un instant…") : t("Reprendre")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <button type="button" disabled={loading} onClick={loadMore} className="mt-4 w-full rounded-2xl border border-white/10 py-2.5 text-sm text-white/70 transition hover:bg-white/5 disabled:opacity-60">
          {loading ? t("Un instant…") : t("Charger les transferts plus anciens")}
        </button>
      )}
    </Panel>
  );
}
