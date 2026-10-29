"use client";

import { useEffect, useId, useState } from "react";
import {
  activateStockProductAction,
  createStockProductAction,
  listStockMovementsAction,
  recordStockMovementAction,
  updateStockProductAction,
  updateStockThresholdAction,
} from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { STOCK_UNITS, type StockUnit } from "@/lib/enums";
import { STOCK_MOVEMENT_KIND_LABELS, STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import type { MovementHistory } from "@/lib/stock/movements";
import { Chip, DateText, FieldError, Qty, useSubmit, type CenterItem, type ProductItem } from "./stock-shared";

// Fenêtres du Module 5 liées aux produits et aux niveaux : mouvement, activation, seuil, historique, fiche produit.
// Chaque fenêtre n'est montée que lorsqu'elle est ouverte (formulaire oublié à la fermeture). Aucune règle métier ici : les actions serveur
// valident tout (rôle, centre, produit, quantités) ; l'interface ne fait que présenter les erreurs.

type Done = (message: string) => void;

// Saisie d'un entier : chaîne vide → absent ; le reste est transmis tel quel au serveur, qui refuse décimales et valeurs invalides.
const toNumber = (value: string): number | undefined => (value.trim() === "" ? undefined : Number(value.replace(/\s/g, "")));

export type LevelTarget = { productId: string; centerId: string; productName: string; unit: StockUnit; centerName: string; quantity: number; alertThreshold: number };

// ── Mouvement manuel : entrée, sortie, correction ──
export function MovementModal({ target, onClose, onDone }: { target: LevelTarget; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const [kind, setKind] = useState<"IN" | "OUT" | "ADJUSTMENT">("IN");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Mouvement de stock")}>
      <p className="mb-4 text-sm text-white/60">
        {target.productName} · {target.centerName} · <Qty value={target.quantity} unit={target.unit} />
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => recordStockMovementAction({ productId: target.productId, centerId: target.centerId, kind, quantity: toNumber(quantity), note }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-kind`}>{t("Type")}</label>
          <select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={`${selectClass} w-full`}>
            <option value="IN">{t("Entrée")}</option>
            <option value="OUT">{t("Sortie")}</option>
            <option value="ADJUSTMENT">{t("Correction")}</option>
          </select>
          <FieldError errors={errors} name="kind" />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${uid}-qty`}>
            {t("Quantité")} ({t(STOCK_UNIT_LABELS[target.unit])})
          </label>
          <input id={`${uid}-qty`} inputMode="numeric" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} aria-describedby={`${uid}-qty-hint`} />
          <p id={`${uid}-qty-hint`} className="mt-1 text-xs text-white/40">
            {kind === "ADJUSTMENT" ? t("Nombre entier, négatif pour retirer du stock.") : t("Nombre entier positif.")}
            {target.unit !== "PIECE" && ` ${t("1 litre = 1000 ml.")}`}
          </p>
          <FieldError errors={errors} name="quantity" />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${uid}-note`}>
            {t("Note")} {kind === "ADJUSTMENT" ? "" : `(${t("facultatif")})`}
          </label>
          <input id={`${uid}-note`} required={kind === "ADJUSTMENT"} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          <FieldError errors={errors} name="note" />
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <FieldError errors={errors} name="productId" />
        <SubmitButton pending={pending}>{t("Enregistrer le mouvement")}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Activation d'un produit dans un centre : seuil et stock initial ──
export function ActivateModal({
  products,
  centers,
  defaultCenterId,
  onClose,
  onDone,
}: {
  products: ProductItem[];
  centers: CenterItem[];
  defaultCenterId: string | null;
  onClose: () => void;
  onDone: Done;
}) {
  const { t } = useI18n();
  const uid = useId();
  const active = products.filter((p) => p.active);
  const [productId, setProductId] = useState(active[0]?.id ?? "");
  const [centerId, setCenterId] = useState(defaultCenterId ?? centers[0]?.id ?? "");
  const [threshold, setThreshold] = useState("0");
  const [initial, setInitial] = useState("0");
  const unit = active.find((p) => p.id === productId)?.unit ?? "PIECE";
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Activer un produit dans un centre")}>
      {active.length === 0 ? (
        <p className="text-sm text-white/60">{t("Aucun produit actif. Le propriétaire doit d'abord créer un produit.")}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => activateStockProductAction({ productId, centerId, alertThreshold: toNumber(threshold), initialQuantity: toNumber(initial) }));
          }}
        >
          <div>
            <label className={labelClass} htmlFor={`${uid}-product`}>{t("Produit")}</label>
            <select id={`${uid}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} className={`${selectClass} w-full`}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({t(STOCK_UNIT_LABELS[p.unit])})
                </option>
              ))}
            </select>
            <FieldError errors={errors} name="productId" />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-center`}>{t("Centre")}</label>
            <select id={`${uid}-center`} value={centerId} onChange={(e) => setCenterId(e.target.value)} className={`${selectClass} w-full`}>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${uid}-threshold`}>
                {t("Seuil d'alerte")} ({t(STOCK_UNIT_LABELS[unit])})
              </label>
              <input id={`${uid}-threshold`} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={inputClass} />
              <FieldError errors={errors} name="alertThreshold" />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${uid}-initial`}>
                {t("Stock initial")} ({t(STOCK_UNIT_LABELS[unit])})
              </label>
              <input id={`${uid}-initial`} inputMode="numeric" value={initial} onChange={(e) => setInitial(e.target.value)} className={inputClass} />
              <FieldError errors={errors} name="initialQuantity" />
            </div>
          </div>
          <p className="text-xs text-white/40">{t("L'unité vient de la fiche produit. Réactiver un produit déjà activé ne crédite jamais le stock initial une seconde fois.")}</p>
          {message && <Alert>{t(message)}</Alert>}
          <SubmitButton pending={pending}>{t("Activer")}</SubmitButton>
        </form>
      )}
    </Modal>
  );
}

// ── Seuil d'alerte ──
export function ThresholdModal({ target, onClose, onDone }: { target: LevelTarget; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const [threshold, setThreshold] = useState(String(target.alertThreshold));
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Seuil d'alerte")}>
      <p className="mb-4 text-sm text-white/60">
        {target.productName} · {target.centerName}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => updateStockThresholdAction({ productId: target.productId, centerId: target.centerId, alertThreshold: toNumber(threshold) }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-threshold`}>
            {t("Seuil d'alerte")} ({t(STOCK_UNIT_LABELS[target.unit])})
          </label>
          <input id={`${uid}-threshold`} inputMode="numeric" required value={threshold} onChange={(e) => setThreshold(e.target.value)} className={inputClass} />
          <p className="mt-1 text-xs text-white/40">{t("Une alerte s'affiche quand la quantité est inférieure ou égale au seuil.")}</p>
          <FieldError errors={errors} name="alertThreshold" />
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}

// ── Historique des mouvements (journal en lecture seule, pagination par curseur, plus récent d'abord) ──
export function HistoryModal({ target, onClose }: { target: Pick<LevelTarget, "productId" | "centerId" | "productName" | "centerName">; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<MovementHistory["movements"]>([]);
  const [unit, setUnit] = useState<StockUnit>("PIECE");
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  type HistoryResult = Awaited<ReturnType<typeof listStockMovementsAction>>;
  const apply = (result: HistoryResult, append: boolean) => {
    if (!result.ok) {
      setError(result.message ?? "Une erreur est survenue. Réessayez.");
      setState("error");
      return;
    }
    setUnit(result.unit);
    setRows((current) => (append ? [...current, ...result.movements] : result.movements));
    setNextBefore(result.nextBefore);
    setState("ready");
  };
  // Première page : chargée à l'ouverture ; aucun setState synchrone dans l'effet (l'état initial est « chargement »).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listStockMovementsAction({ productId: target.productId, centerId: target.centerId });
      if (!cancelled) apply(result, false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply ne dépend que de setters stables
  }, [target.productId, target.centerId]);
  // Pages suivantes : curseur = rang du dernier mouvement reçu (nextBefore).
  const loadMore = async (before: number) => {
    setPending(true);
    const result = await listStockMovementsAction({ productId: target.productId, centerId: target.centerId, before });
    setPending(false);
    apply(result, true);
  };

  return (
    <Modal open onClose={onClose} title={t("Historique des mouvements")} wide>
      <p className="mb-4 text-sm text-white/60">
        {target.productName} · {target.centerName}
      </p>
      {state === "loading" && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}
      {state === "error" && <Alert>{t(error ?? "")}</Alert>}
      {state === "ready" && rows.length === 0 && <p className="py-8 text-center text-sm text-white/50">{t("Aucun mouvement enregistré.")}</p>}
      {state === "ready" && rows.length > 0 && (
        <ul className="divide-y divide-white/5">
          {rows.map((m) => (
            <li key={m.seq} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-white">
                  <Chip tone={m.delta > 0 ? "ok" : m.delta < 0 ? "warn" : "muted"}>{t(STOCK_MOVEMENT_KIND_LABELS[m.kind])}</Chip>
                  <Qty value={m.delta} unit={unit} signed />
                </p>
                <p className="mt-1 text-xs text-white/45">
                  <DateText value={m.createdAt} withTime />
                  {m.note && ` · ${m.note}`}
                  {m.purchaseOrderId && ` · ${t("Commande d'achat")}`}
                  {m.bookingId && ` · ${t("Rendez-vous")}`}
                </p>
                {m.kind === "CONSUMPTION" && m.requested !== null && m.shortfall !== null && m.shortfall > 0 && (
                  <p className="mt-1 text-xs text-amber-200">
                    {t("Manquant")} : <Qty value={m.shortfall} unit={unit} /> ({t("demandé")} : <Qty value={m.requested} unit={unit} />)
                  </p>
                )}
              </div>
              <div className="text-end text-xs text-white/45">
                {t("Solde")}
                <p className="text-sm text-white">
                  <Qty value={m.balanceAfter} unit={unit} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {state === "ready" && nextBefore !== null && (
        <button
          type="button"
          disabled={pending}
          onClick={() => void loadMore(nextBefore)}
          className="mt-4 w-full rounded-2xl border border-white/10 py-2.5 text-sm text-white/70 transition hover:bg-white/5 disabled:opacity-60"
        >
          {pending ? t("Un instant…") : t("Charger les mouvements plus anciens")}
        </button>
      )}
    </Modal>
  );
}

// ── Fiche produit partagée (propriétaire) : création et modification ──
export function ProductModal({ product, onClose, onDone }: { product: ProductItem | null; onClose: () => void; onDone: Done }) {
  const { t } = useI18n();
  const uid = useId();
  const [name, setName] = useState(product?.name ?? "");
  const [unit, setUnit] = useState<StockUnit>(product?.unit ?? "ML");
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t(product ? "Modifier le produit" : "Nouveau produit")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => (product ? updateStockProductAction({ productId: product.id, name, unit }) : createStockProductAction({ name, unit })));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-name`}>{t("Nom")}</label>
          <input id={`${uid}-name`} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          <FieldError errors={errors} name="name" />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${uid}-unit`}>{t("Unité de base")}</label>
          <select id={`${uid}-unit`} value={unit} onChange={(e) => setUnit(e.target.value as StockUnit)} className={`${selectClass} w-full`}>
            {STOCK_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(STOCK_UNIT_LABELS[u])}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-white/40">{t("Les quantités sont des nombres entiers dans l'unité de base. 1 litre = 1000 ml. L'unité ne peut plus changer dès qu'un mouvement existe.")}</p>
          <FieldError errors={errors} name="unit" />
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}
