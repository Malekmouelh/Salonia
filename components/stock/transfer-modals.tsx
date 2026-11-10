"use client";

import { useId, useState, useTransition } from "react";
import {
  answerStockTransferRequestAction,
  confirmStockTransferReceiptAction,
  listStockTransfersAction,
  requestStockTransferAction,
  resumeStockTransferAction,
  reverseStockTransferAction,
  transferEquipmentAction,
  transferStockProductAction,
} from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { Panel, selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import type { StockTransferKind, StockTransferStatus, StockUnit } from "@/lib/enums";
import type { EquipmentView } from "@/lib/stock/equipment";
import { STOCK_RECEIPT_STATUS_LABELS, STOCK_TRANSFER_KIND_LABELS, STOCK_TRANSFER_STATUS_LABELS, STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import type { StockLevelRow } from "@/lib/stock/service";
import type { TransferInbox, TransferView } from "@/lib/stock/transfers";
import { Chip, DateText, FieldError, Qty, centerName, useSubmit, type CenterItem, type ProductItem } from "./stock-shared";

// F5.6 — Transferts entre centres : envoi (un ou plusieurs produits) et matériel, demande à un autre centre, réception à confirmer (avec écart
// possible), annulation par retour, boîte « À traiter » et historique filtrable. Aucune règle métier ici : les actions serveur revérifient tout
// (rôle, centre source dans le périmètre, destination dans l'organisation, quantité plafonnée au stock disponible, qui peut confirmer / annuler /
// répondre). L'interface limite les choix, informe avant d'envoyer, et protège du double envoi : le bouton est désactivé pendant l'appel et chaque
// formulaire porte un identifiant de demande (requestId) qui rend un nouvel envoi idempotent côté serveur.

type Done = (message: string) => void;
const NOTE_MAX = 200;

// Identifiant de demande : aléatoire, accepté par le serveur (16 à 64 caractères alphanumériques, « - » et « _ »). randomUUID n'existe
// que dans un contexte sécurisé (https, localhost) : repli sur getRandomValues.
function newRequestId() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const toNumber = (value: string): number | undefined => (value.trim() === "" ? undefined : Number(value.replace(/\s/g, "")));

function NoteField({ value, onChange, label = "Motif (facultatif)", id }: { value: string; onChange: (v: string) => void; label?: string; id: string }) {
  const { t } = useI18n();
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {t(label)}
      </label>
      <textarea id={id} rows={2} maxLength={NOTE_MAX} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} resize-none`} />
    </div>
  );
}

// ── Transfert d'un ou de plusieurs produits ──
type Line = { productId: string; quantity: string };
type LineResult = { name: string; unit: StockUnit; requested: number; transferred: number; capped: boolean; error?: string };
export type TransferPrefill = { productId: string; centerId: string; toCenterId?: string; quantity?: number };

export function ProductTransferModal({
  levels,
  sources,
  destinations,
  initial,
  levelsComplete,
  onClose,
  onDone,
}: {
  levels: StockLevelRow[];
  sources: CenterItem[];
  destinations: CenterItem[];
  initial: TransferPrefill | null;
  // Les niveaux couvrent tous les centres de l'utilisateur (aucun filtre de centre) : on peut alors dire qu'un produit n'est pas activé à destination.
  levelsComplete: boolean;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useI18n();
  const uid = useId();
  const usable = levels.filter((l) => l.productActive);
  const optionsFor = (centerId: string) => usable.filter((l) => l.centerId === centerId);
  const destinationsFor = (centerId: string) => destinations.filter((c) => c.id !== centerId);
  const sourceChoices = sources.filter((c) => optionsFor(c.id).length > 0);
  const firstSource = initial?.centerId && sourceChoices.some((c) => c.id === initial.centerId) ? initial.centerId : (sourceChoices[0]?.id ?? "");
  const firstDestination = initial?.toCenterId && destinationsFor(firstSource).some((c) => c.id === initial.toCenterId) ? initial.toCenterId : (destinationsFor(firstSource)[0]?.id ?? "");
  const firstProduct = initial?.productId && optionsFor(firstSource).some((l) => l.productId === initial.productId) ? initial.productId : (optionsFor(firstSource)[0]?.productId ?? "");

  const [fromId, setFromId] = useState(firstSource);
  const [toId, setToId] = useState(firstDestination);
  const [lines, setLines] = useState<Line[]>([{ productId: firstProduct, quantity: initial?.quantity ? String(initial.quantity) : "" }]);
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [results, setResults] = useState<LineResult[] | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  // Toute modification du formulaire est une nouvelle demande : un nouvel identifiant évite de la confondre avec un envoi précédent.
  const edit = () => setRequestId(newRequestId());

  const levelOf = (centerId: string, productId: string) => levels.find((l) => l.centerId === centerId && l.productId === productId);
  const destinationVisible = sources.some((c) => c.id === toId) && levelsComplete;

  const changeSource = (id: string) => {
    setFromId(id);
    setLines([{ productId: optionsFor(id)[0]?.productId ?? "", quantity: "" }]);
    if (toId === id || toId === "") setToId(destinationsFor(id)[0]?.id ?? "");
    edit();
  };
  const setLine = (index: number, patch: Partial<Line>) => {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    edit();
  };
  const taken = new Set(lines.map((l) => l.productId));
  const nextProduct = optionsFor(fromId).find((l) => !taken.has(l.productId));

  const submit = () => {
    if (pending) return;
    setError(null);
    setLineErrors({});
    start(async () => {
      const out: LineResult[] = [];
      const errs: Record<number, string> = {};
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const level = levelOf(fromId, line.productId);
        const unit = level?.unit ?? "PIECE";
        // Une demande par ligne, identifiants dérivés : rejouer le formulaire ne duplique jamais une ligne déjà partie.
        const r = await transferStockProductAction({ requestId: `${requestId}-${i}`, fromCenterId: fromId, toCenterId: toId, productId: line.productId, quantity: toNumber(line.quantity), note: note || undefined });
        if (r.ok) out.push({ name: level?.productName ?? "", unit, requested: r.requested ?? 0, transferred: r.transferred ?? 0, capped: r.capped });
        else errs[i] = r.errors?.quantity?.[0] ?? r.errors?.productId?.[0] ?? r.message ?? "Une erreur est survenue. Réessayez.";
      }
      setLineErrors(errs);
      if (out.length > 0) {
        setResults(out);
        onDone(out.some((x) => x.capped) ? "Transfert effectué : la quantité a été plafonnée au stock disponible." : "Transfert effectué.");
      } else setError(Object.values(errs)[0] ?? "Une erreur est survenue. Réessayez.");
    });
  };

  return (
    <Modal open onClose={onClose} title={t("Transférer des produits")}>
      {results ? (
        <div className="space-y-4">
          <Alert tone="success">{t("Transfert effectué. Le centre destinataire doit confirmer la réception.")}</Alert>
          <ul className="space-y-2 text-sm">
            {results.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-2">
                <span className="text-white">{r.name}</span>
                <span className="text-white/80">
                  <Qty value={r.transferred} unit={r.unit} />
                  {r.capped && (
                    <span className="ms-2 text-xs text-amber-200">
                      {t("demandé")} <Qty value={r.requested} unit={r.unit} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {Object.keys(lineErrors).length > 0 && <Alert>{t("Certaines lignes n'ont pas pu partir : corrigez-les et relancez.")}</Alert>}
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
            submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${uid}-from`}>
                {t("Centre source")}
              </label>
              <select id={`${uid}-from`} value={fromId} onChange={(e) => changeSource(e.target.value)} className={`${selectClass} w-full`}>
                {sourceChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`${uid}-to`}>
                {t("Centre de destination")}
              </label>
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
          </div>

          {lines.map((line, index) => {
            const source = levelOf(fromId, line.productId);
            const unit: StockUnit = source?.unit ?? "PIECE";
            const available = source?.quantity ?? 0;
            const wanted = toNumber(line.quantity);
            const remaining = wanted !== undefined && Number.isFinite(wanted) ? available - Math.min(wanted, available) : null;
            const destination = levelOf(toId, line.productId);
            return (
              <div key={index} className="space-y-2 rounded-2xl border border-white/10 p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label className={labelClass} htmlFor={`${uid}-product-${index}`}>
                      {t("Produit")}
                    </label>
                    <select id={`${uid}-product-${index}`} value={line.productId} onChange={(e) => setLine(index, { productId: e.target.value })} className={`${selectClass} w-full`}>
                      {optionsFor(fromId)
                        .filter((l) => l.productId === line.productId || !taken.has(l.productId))
                        .map((l) => (
                          <option key={l.productId} value={l.productId}>
                            {l.productName} ({t(STOCK_UNIT_LABELS[l.unit])})
                          </option>
                        ))}
                    </select>
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setLines((current) => current.filter((_, i) => i !== index));
                        edit();
                      }}
                      className="pb-2.5 text-xs text-white/55 hover:text-white"
                    >
                      {t("Retirer")}
                    </button>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label className={labelClass} htmlFor={`${uid}-qty-${index}`}>
                      {t("Quantité")} ({t(STOCK_UNIT_LABELS[unit])})
                    </label>
                    <input id={`${uid}-qty-${index}`} inputMode="numeric" required value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} className={inputClass} />
                  </div>
                  <button type="button" onClick={() => setLine(index, { quantity: String(available) })} className="rounded-2xl border border-white/10 px-3 py-2.5 text-xs text-white/80 transition hover:bg-white/5">
                    {t("Tout")}
                  </button>
                </div>
                <FieldError errors={lineErrors[index] ? { quantity: [lineErrors[index]] } : {}} name="quantity" />
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-white/55">
                  <dt>{t("Stock disponible")}</dt>
                  <dd className="text-end text-white/80">
                    <Qty value={available} unit={unit} />
                  </dd>
                  {remaining !== null && (
                    <>
                      <dt>{t("Restera à la source")}</dt>
                      <dd className="text-end text-white/80">
                        <Qty value={remaining} unit={unit} />
                      </dd>
                    </>
                  )}
                  {destinationVisible && destination && (
                    <>
                      <dt>{t("Stock du centre destinataire")}</dt>
                      <dd className="text-end text-white/80">
                        <Qty value={destination.quantity} unit={unit} />
                      </dd>
                    </>
                  )}
                </dl>
                {remaining !== null && source && remaining < source.alertThreshold && (
                  <p className="text-xs text-amber-200">
                    {t("Le centre source passerait sous son seuil d'alerte")} (<Qty value={source.alertThreshold} unit={unit} />).
                  </p>
                )}
                {destinationVisible && !destination && <p className="text-xs text-white/55">{t("Ce produit n'est pas encore activé dans ce centre : il le sera avec le seuil du centre source (à vérifier ensuite).")}</p>}
                {!destinationVisible && sources.every((c) => c.id !== toId) && <p className="text-xs text-white/40">{t("Le stock d'un centre qui n'est pas le vôtre n'est pas affiché.")}</p>}
              </div>
            );
          })}
          {nextProduct && (
            <button
              type="button"
              onClick={() => {
                setLines((current) => [...current, { productId: nextProduct.productId, quantity: "" }]);
                edit();
              }}
              className="text-xs font-medium text-champagne hover:underline"
            >
              + {t("Ajouter un produit")}
            </button>
          )}
          <p className="text-xs text-white/40">
            {t("Nombre entier positif.")} {t("Si la quantité dépasse le stock disponible, elle est plafonnée au disponible.")}
          </p>
          <NoteField id={`${uid}-note`} value={note} onChange={(v) => { setNote(v); edit(); }} />
          {error && <Alert>{t(error)}</Alert>}
          <SubmitButton pending={pending}>{t("Transférer")}</SubmitButton>
        </form>
      )}
    </Modal>
  );
}

// ── Demande de stock à un autre centre ──
export function RequestTransferModal({ products, sources, destinations, onClose, onDone }: { products: ProductItem[]; sources: CenterItem[]; destinations: CenterItem[]; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const active = products.filter((p) => p.active);
  const [toId, setToId] = useState(sources[0]?.id ?? "");
  const [fromId, setFromId] = useState(destinations.find((c) => c.id !== sources[0]?.id)?.id ?? "");
  const [productId, setProductId] = useState(active[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const edit = () => setRequestId(newRequestId());
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  const unit = active.find((p) => p.id === productId)?.unit ?? "PIECE";
  return (
    <Modal open onClose={onClose} title={t("Demander du stock à un autre centre")}>
      {sources.length === 0 || active.length === 0 ? (
        <p className="text-sm text-white/60">{t("Aucun produit ou centre disponible pour une demande.")}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            submit(() => requestStockTransferAction({ requestId, fromCenterId: fromId, toCenterId: toId, productId, quantity: toNumber(quantity), note: note || undefined }));
          }}
        >
          <p className="text-xs text-white/55">{t("Le centre à qui vous demandez reçoit la demande : il l'accepte (le transfert part) ou la refuse.")}</p>
          <div>
            <label className={labelClass} htmlFor={`${uid}-to`}>
              {t("Mon centre (qui a besoin du stock)")}
            </label>
            <select
              id={`${uid}-to`}
              value={toId}
              onChange={(e) => {
                setToId(e.target.value);
                if (fromId === e.target.value) setFromId(destinations.find((c) => c.id !== e.target.value)?.id ?? "");
                edit();
              }}
              className={`${selectClass} w-full`}
            >
              {sources.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-from`}>
              {t("Centre à qui je demande")}
            </label>
            <select
              id={`${uid}-from`}
              value={fromId}
              onChange={(e) => {
                setFromId(e.target.value);
                edit();
              }}
              className={`${selectClass} w-full`}
            >
              {destinations
                .filter((c) => c.id !== toId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-product`}>
              {t("Produit")}
            </label>
            <select
              id={`${uid}-product`}
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                edit();
              }}
              className={`${selectClass} w-full`}
            >
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({t(STOCK_UNIT_LABELS[p.unit])})
                </option>
              ))}
            </select>
            <FieldError errors={errors} name="productId" />
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
            />
            <FieldError errors={errors} name="quantity" />
          </div>
          <NoteField id={`${uid}-note`} value={note} onChange={(v) => { setNote(v); edit(); }} label="Motif de la demande (facultatif)" />
          {message && <Alert>{t(message)}</Alert>}
          <FieldError errors={errors} name="requestId" />
          <SubmitButton pending={pending}>{t("Envoyer la demande")}</SubmitButton>
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
  const [note, setNote] = useState("");
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
          submit(() => transferEquipmentAction({ requestId, equipmentId: equipment.id, toCenterId: toId, note: note || undefined }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-to`}>
            {t("Centre de destination")}
          </label>
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
        <NoteField
          id={`${uid}-note`}
          value={note}
          onChange={(v) => {
            setNote(v);
            setRequestId(newRequestId());
          }}
        />
        <p className="text-xs text-white/40">{t("L'équipement garde son identité et son historique de maintenance.")}</p>
        {message && <Alert>{t(message)}</Alert>}
        <FieldError errors={errors} name="requestId" />
        <SubmitButton pending={pending}>{t("Transférer")}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Réception : confirmer, ou signaler un écart ──
function ReceiptModal({ transfer, centers, onClose, onDone }: { transfer: TransferView; centers: CenterItem[]; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const isProduct = transfer.kind === "PRODUCT";
  const unit = transfer.unit ?? "PIECE";
  const sent = transfer.transferredQuantity ?? 0;
  const [gap, setGap] = useState(false);
  const [received, setReceived] = useState(String(sent));
  const [note, setNote] = useState("");
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Confirmer la réception")}>
      <p className="text-sm text-white">{transfer.productName ?? transfer.equipmentName}</p>
      <p className="mb-4 text-xs text-white/55">
        {centerName(centers, transfer.fromCenterId)} <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span> {centerName(centers, transfer.toCenterId)}
        {isProduct && (
          <>
            {" · "}
            <Qty value={sent} unit={unit} />
          </>
        )}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          submit(() => confirmStockTransferReceiptAction({ transferId: transfer.id, ...(gap ? (isProduct ? { receivedQuantity: toNumber(received) } : { conforme: false }) : {}), note: note || undefined }));
        }}
      >
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input type="checkbox" checked={gap} onChange={(e) => setGap(e.target.checked)} />
          {t(isProduct ? "Signaler un écart (quantité reçue différente)" : "Signaler un problème (matériel abîmé ou incomplet)")}
        </label>
        {gap && isProduct && (
          <div>
            <label className={labelClass} htmlFor={`${uid}-received`}>
              {t("Quantité réellement reçue")} ({t(STOCK_UNIT_LABELS[unit])})
            </label>
            <input id={`${uid}-received`} inputMode="numeric" required value={received} onChange={(e) => setReceived(e.target.value)} className={inputClass} />
            <FieldError errors={errors} name="receivedQuantity" />
          </div>
        )}
        {gap && <NoteField id={`${uid}-note`} value={note} onChange={setNote} label="Explication de l'écart" />}
        <FieldError errors={errors} name="note" />
        <p className="text-xs text-white/40">{t("La confirmation ne change pas le stock. Un écart est signalé au propriétaire : corrigez ensuite le stock depuis la fiche du produit si nécessaire.")}</p>
        {message && !errors.note && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t(gap ? "Enregistrer l'écart" : "Confirmer la réception")}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Annulation d'un transfert terminé (retour) ──
function ReverseModal({ transfer, centers, onClose, onDone }: { transfer: TransferView; centers: CenterItem[]; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const [note, setNote] = useState("");
  const { pending, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Annuler ce transfert")}>
      <p className="text-sm text-white">{transfer.productName ?? transfer.equipmentName}</p>
      <p className="mb-4 text-xs text-white/55">
        {centerName(centers, transfer.fromCenterId)} <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span> {centerName(centers, transfer.toCenterId)}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          submit(() => reverseStockTransferAction({ transferId: transfer.id, note: note || undefined }));
        }}
      >
        <p className="text-xs text-white/60">{t("Le stock est renvoyé au centre d'origine par un transfert en sens inverse, tracé dans l'historique. Ce qui a déjà été consommé à destination ne revient pas.")}</p>
        <NoteField id={`${uid}-note`} value={note} onChange={setNote} label="Motif de l'annulation (facultatif)" />
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Annuler le transfert")}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Réponse à une demande ──
function AnswerModal({ transfer, decision, centers, onClose, onDone }: { transfer: TransferView; decision: "ACCEPT" | "REFUSE" | "WITHDRAW"; centers: CenterItem[]; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const [note, setNote] = useState("");
  const { pending, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  const titles = { ACCEPT: "Accepter la demande", REFUSE: "Refuser la demande", WITHDRAW: "Retirer la demande" } as const;
  const unit = transfer.unit ?? "PIECE";
  return (
    <Modal open onClose={onClose} title={t(titles[decision])}>
      <p className="text-sm text-white">{transfer.productName}</p>
      <p className="mb-4 text-xs text-white/55">
        {centerName(centers, transfer.fromCenterId)} <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span> {centerName(centers, transfer.toCenterId)} · <Qty value={transfer.requestedQuantity ?? 0} unit={unit} />
      </p>
      {transfer.note && <p className="mb-4 text-xs text-white/60">{transfer.note}</p>}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          submit(() => answerStockTransferRequestAction({ transferId: transfer.id, decision, note: note || undefined }));
        }}
      >
        {decision === "ACCEPT" && <p className="text-xs text-white/60">{t("Le transfert part tout de suite, plafonné à votre stock disponible. Le centre demandeur confirmera la réception.")}</p>}
        {decision !== "WITHDRAW" && <NoteField id={`${uid}-note`} value={note} onChange={setNote} label="Message (facultatif)" />}
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t(titles[decision])}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Historique et boîte « À traiter » ──
const STATUS_TONE: Record<StockTransferStatus, "ok" | "warn" | "muted" | "info" | "bad"> = { COMPLETED: "ok", PENDING: "warn", CANCELLED: "muted", REQUESTED: "info", REFUSED: "bad" };
const RECEIPT_TONE = { AWAITING: "warn", CONFIRMED: "ok", DISCREPANCY: "bad" } as const;
type ModalState = { type: "receipt" | "reverse"; transfer: TransferView } | { type: "answer"; decision: "ACCEPT" | "REFUSE" | "WITHDRAW"; transfer: TransferView } | { type: "request" } | null;
type Filters = { kind: StockTransferKind | ""; status: StockTransferStatus | "" };

export function TransfersPanel({
  initial,
  nextBefore,
  centers,
  selectedCenterId,
  sourceCenterIds,
  inbox,
  isOwner,
  products,
  onFeedback,
}: {
  initial: TransferView[];
  nextBefore: string | null;
  centers: CenterItem[];
  selectedCenterId: string | null;
  sourceCenterIds: string[];
  inbox: TransferInbox;
  isOwner: boolean;
  // Produits du catalogue : fournis seulement là où l'on peut demander du stock (vue d'ensemble).
  products?: ProductItem[];
  onFeedback: (text: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [more, setMore] = useState<{ items: TransferView[]; next: string | null } | null>(null);
  const [filters, setFilters] = useState<Filters>({ kind: "", status: "" });
  const [filtered, setFiltered] = useState<{ items: TransferView[]; next: string | null } | null>(null);
  const [loading, startLoading] = useTransition();
  const [resuming, startResume] = useTransition();
  const [modal, setModal] = useState<ModalState>(null);
  const filtering = filters.kind !== "" || filters.status !== "";
  const known = new Set(initial.map((x) => x.id));
  const base = filtering ? (filtered?.items ?? []) : [...initial, ...(more?.items.filter((x) => !known.has(x.id)) ?? [])];
  const next = filtering ? (filtered?.next ?? null) : more ? more.next : nextBefore;
  const mine = new Set(sourceCenterIds);

  const query = (f: Filters, before?: string) => ({ centerId: selectedCenterId ?? undefined, before, limit: 10, ...(f.kind ? { kind: f.kind } : {}), ...(f.status ? { status: f.status } : {}) });
  const applyFilters = (f: Filters) => {
    setFilters(f);
    setFiltered(null);
    if (f.kind === "" && f.status === "") return;
    startLoading(async () => {
      const r = await listStockTransfersAction(query(f));
      if (r.ok) setFiltered({ items: r.transfers, next: r.nextBefore });
      else onFeedback(r.message ?? "Une erreur est survenue. Réessayez.", "error");
    });
  };
  const loadMore = () =>
    startLoading(async () => {
      const cursor = base[base.length - 1]?.id;
      const r = await listStockTransfersAction(query(filters, cursor));
      if (!r.ok) return onFeedback(r.message ?? "Une erreur est survenue. Réessayez.", "error");
      if (filtering) setFiltered({ items: [...(filtered?.items ?? []), ...r.transfers], next: r.nextBefore });
      else setMore({ items: [...(more?.items ?? []), ...r.transfers], next: r.nextBefore });
    });
  const resume = (id: string) =>
    startResume(async () => {
      const r = await resumeStockTransferAction({ transferId: id });
      onFeedback(r.ok ? (r.message ?? "") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
    });
  // Après une action : on repart des données fraîches du serveur (la page est réinvalidée) ; un filtre actif est relu.
  const afterAction = (message: string) => {
    onFeedback(message);
    setMore(null);
    if (filtering) applyFilters(filters);
  };

  // Annulation proposée : transfert terminé, pas déjà annulé, pas un retour ; le serveur décide qui a le droit (propriétaire, destinataire, auteur avant confirmation).
  const canReverse = (x: TransferView) => x.status === "COMPLETED" && !x.reversedByTransferId && !x.reversesTransferId && (isOwner || mine.has(x.toCenterId) || (mine.has(x.fromCenterId) && x.receiptStatus === "AWAITING"));
  const inboxCount = inbox.toReceive.length + inbox.requests.length;

  const unitOf = (x: TransferView) => x.unit ?? "PIECE";
  const label = (x: TransferView) => x.productName ?? x.equipmentName ?? "—";

  return (
    <Panel title="Transferts entre centres" subtitle="Produits et matériel, du plus récent au plus ancien">
      {products && (
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => setModal({ type: "request" })} className="rounded-2xl border border-white/10 px-4 py-2 text-xs text-white/80 transition hover:bg-white/5">
            {t("Demander du stock à un autre centre")}
          </button>
        </div>
      )}

      {inboxCount > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4">
          <p className="text-sm font-medium text-amber-100">
            {t("À traiter")} <bdi>({inboxCount})</bdi>
          </p>
          <ul className="mt-2 divide-y divide-white/5">
            {inbox.toReceive.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{label(x)}</p>
                  <p className="text-xs text-white/55">
                    {t("Reçu de")} {centerName(centers, x.fromCenterId)} → {centerName(centers, x.toCenterId)}
                    {x.kind === "PRODUCT" && (
                      <>
                        {" · "}
                        <Qty value={x.transferredQuantity ?? 0} unit={unitOf(x)} />
                      </>
                    )}
                  </p>
                  {x.note && <p className="truncate text-xs text-white/40">{x.note}</p>}
                  {x.destinationActivated && <p className="text-xs text-amber-200">{t("Produit activé automatiquement dans ce centre : vérifiez son seuil d'alerte.")}</p>}
                </div>
                <button type="button" onClick={() => setModal({ type: "receipt", transfer: x })} className="text-xs font-medium text-champagne hover:underline">
                  {t("Confirmer la réception")}
                </button>
              </li>
            ))}
            {inbox.requests.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{label(x)}</p>
                  <p className="text-xs text-white/55">
                    {t("Demandé par")} {centerName(centers, x.toCenterId)} · <Qty value={x.requestedQuantity ?? 0} unit={unitOf(x)} />
                  </p>
                  {x.note && <p className="truncate text-xs text-white/40">{x.note}</p>}
                </div>
                <button type="button" onClick={() => setModal({ type: "answer", decision: "ACCEPT", transfer: x })} className="text-xs font-medium text-champagne hover:underline">
                  {t("Accepter")}
                </button>
                <button type="button" onClick={() => setModal({ type: "answer", decision: "REFUSE", transfer: x })} className="text-xs text-white/60 hover:text-white">
                  {t("Refuser")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`${uid}-kind`}>
          {t("Type")}
        </label>
        <select id={`${uid}-kind`} value={filters.kind} onChange={(e) => applyFilters({ ...filters, kind: e.target.value as Filters["kind"] })} className={selectClass}>
          <option value="">{t("Tous les types")}</option>
          {(Object.keys(STOCK_TRANSFER_KIND_LABELS) as StockTransferKind[]).map((k) => (
            <option key={k} value={k}>
              {t(STOCK_TRANSFER_KIND_LABELS[k])}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${uid}-status`}>
          {t("Statut")}
        </label>
        <select id={`${uid}-status`} value={filters.status} onChange={(e) => applyFilters({ ...filters, status: e.target.value as Filters["status"] })} className={selectClass}>
          <option value="">{t("Tous les statuts")}</option>
          {(Object.keys(STOCK_TRANSFER_STATUS_LABELS) as StockTransferStatus[]).map((s) => (
            <option key={s} value={s}>
              {t(STOCK_TRANSFER_STATUS_LABELS[s])}
            </option>
          ))}
        </select>
      </div>

      {base.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/45">{t(filtering ? "Aucun transfert ne correspond à ce filtre." : "Aucun transfert enregistré.")}</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {base.map((x) => {
            const capped = x.requestedQuantity !== null && x.transferredQuantity !== null && x.transferredQuantity < x.requestedQuantity;
            const requester = x.status === "REQUESTED" && mine.has(x.toCenterId);
            return (
              <li key={x.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{label(x)}</p>
                  <p className="text-xs text-white/45">
                    {centerName(centers, x.fromCenterId)} <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span> {centerName(centers, x.toCenterId)} · <DateText value={x.createdAt} withTime />
                  </p>
                  {x.note && <p className="truncate text-xs text-white/40">{x.note}</p>}
                  {x.decisionNote && <p className="truncate text-xs text-white/40">{x.decisionNote}</p>}
                  {x.receiptStatus === "DISCREPANCY" && x.receiptNote && <p className="truncate text-xs text-red-200/80">{x.receiptNote}</p>}
                </div>
                <Chip tone="muted">{t(STOCK_TRANSFER_KIND_LABELS[x.kind])}</Chip>
                {x.reversesTransferId && <Chip tone="info">{t("Retour")}</Chip>}
                {x.reversedByTransferId && <Chip tone="muted">{t("Annulé par un retour")}</Chip>}
                {x.kind === "PRODUCT" && (x.status === "COMPLETED" || x.status === "REQUESTED") && (
                  <span className="text-sm text-white">
                    <Qty value={x.status === "COMPLETED" ? (x.transferredQuantity ?? 0) : (x.requestedQuantity ?? 0)} unit={unitOf(x)} />
                    {capped && (
                      <span className="block text-xs text-white/45">
                        {t("demandé")} <Qty value={x.requestedQuantity ?? 0} unit={unitOf(x)} />
                      </span>
                    )}
                  </span>
                )}
                <Chip tone={STATUS_TONE[x.status]}>{t(STOCK_TRANSFER_STATUS_LABELS[x.status])}</Chip>
                {x.status === "COMPLETED" && x.receiptStatus && !x.reversedByTransferId && (
                  <Chip tone={RECEIPT_TONE[x.receiptStatus]}>
                    {t(STOCK_RECEIPT_STATUS_LABELS[x.receiptStatus])}
                    {x.receiptStatus === "DISCREPANCY" && x.receivedQuantity !== null && (
                      <>
                        {" · "}
                        <Qty value={x.receivedQuantity} unit={unitOf(x)} />
                      </>
                    )}
                  </Chip>
                )}
                {x.status === "PENDING" && sourceCenterIds.includes(x.fromCenterId) && (
                  <button type="button" disabled={resuming} onClick={() => resume(x.id)} className="text-xs font-medium text-champagne hover:underline disabled:opacity-60">
                    {resuming ? t("Un instant…") : t("Reprendre")}
                  </button>
                )}
                {requester && (
                  <button type="button" onClick={() => setModal({ type: "answer", decision: "WITHDRAW", transfer: x })} className="text-xs text-white/60 hover:text-white">
                    {t("Retirer")}
                  </button>
                )}
                {canReverse(x) && (
                  <button type="button" onClick={() => setModal({ type: "reverse", transfer: x })} className="text-xs text-white/60 hover:text-white">
                    {t("Annuler")}
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

      {modal?.type === "receipt" && <ReceiptModal transfer={modal.transfer} centers={centers} onClose={() => setModal(null)} onDone={afterAction} />}
      {modal?.type === "reverse" && <ReverseModal transfer={modal.transfer} centers={centers} onClose={() => setModal(null)} onDone={afterAction} />}
      {modal?.type === "answer" && <AnswerModal transfer={modal.transfer} decision={modal.decision} centers={centers} onClose={() => setModal(null)} onDone={afterAction} />}
      {modal?.type === "request" && products && <RequestTransferModal products={products} sources={centers.filter((c) => mine.has(c.id))} destinations={centers} onClose={() => setModal(null)} onDone={afterAction} />}
    </Panel>
  );
}
