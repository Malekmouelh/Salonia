"use client";

import { useId, useState, useTransition } from "react";
import { createPurchaseOrderAction, placePurchaseOrderAction, recordStockMovementAction } from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import type { ForecastRow } from "@/lib/stock/forecast-data";
import { STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import { Qty, centerName, fmtQty, useConfirm, type CenterItem } from "./stock-shared";

// Réapprovisionner un produit depuis une carte de prévision : trois sorties, toutes décidées et confirmées par l'utilisateur.
//  - Créer le brouillon : commande modifiable dans l'onglet Commandes.
//  - Passer la commande : la commande est créée puis passée (statut seulement : rien n'est envoyé au fournisseur ; le stock n'augmente qu'à la réception).
//  - Entrée de stock : marchandise DÉJÀ reçue sans commande (mouvement « entrée »). Si une commande est en route pour ce produit, on avertit : l'ajouter
//    à la main puis réceptionner la commande compterait la marchandise deux fois.
// Les droits et le périmètre des centres sont revérifiés par les actions serveur (un gérant ne réapprovisionne que ses centres).

const ENTRY_NOTE = "Entrée rapide depuis les prévisions";

export function ReplenishModal({
  row,
  suppliers,
  centers,
  onClose,
  onDone,
}: {
  row: ForecastRow;
  suppliers: { id: string; name: string }[];
  centers: CenterItem[];
  onClose: () => void;
  onDone: (message: string, tone?: "success" | "error") => void;
}) {
  const { t, lang } = useI18n();
  const uid = useId();
  const dialog = useConfirm();
  const [pending, start] = useTransition();
  const [quantity, setQuantity] = useState(row.suggestedQuantity > 0 ? String(row.suggestedQuantity) : "");
  const [supplierId, setSupplierId] = useState(row.supplierId && suppliers.some((s) => s.id === row.supplierId) ? row.supplierId : "");
  const [error, setError] = useState<string | null>(null);
  const unit = t(STOCK_UNIT_LABELS[row.unit]);
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? "";
  const where = centerName(centers, row.centerId);

  // Quantité entière strictement positive, sinon message (jamais envoyée au serveur).
  const parsed = (): number | null => {
    const value = quantity.trim() === "" ? Number.NaN : Number(quantity);
    if (!Number.isInteger(value) || value <= 0) {
      setError(t("Quantité entière attendue."));
      return null;
    }
    setError(null);
    return value;
  };
  const needSupplier = (): boolean => {
    if (supplierId) return true;
    setError(t("Choisissez un fournisseur."));
    return false;
  };
  const failure = (res: { message?: string; errors?: Record<string, string[]> }) => {
    const first = res.errors ? Object.values(res.errors)[0]?.[0] : undefined;
    return res.message ?? first ?? "Une erreur est survenue. Réessayez.";
  };

  // Création du brouillon (et passage de la commande si demandé). Une erreur au passage laisse le brouillon dans l'onglet Commandes.
  const order = (place: boolean) => {
    const qty = parsed();
    if (qty === null || !needSupplier()) return;
    const run = () =>
      start(async () => {
        const created = await createPurchaseOrderAction({ centerId: row.centerId, supplierId, lines: [{ productId: row.productId, quantity: qty }] });
        if (!created.ok) {
          setError(t(failure(created)));
          return;
        }
        if (!place) {
          onDone(created.message ?? "Commande créée.");
          onClose();
          return;
        }
        const placed = await placePurchaseOrderAction({ orderId: created.order.id });
        if (placed.ok) onDone(placed.message ?? "Commande passée.");
        else onDone(`${t("Le brouillon est créé dans l'onglet Commandes, mais la commande n'a pas pu être passée")} : ${t(failure(placed))}`, "error");
        onClose();
      });
    if (!place) {
      run();
      return;
    }
    dialog.ask(
      {
        title: t("Passer cette commande ?"),
        message: `${fmtQty(qty, lang)} ${unit} · ${row.productName} · ${supplierName} · ${where}. ${t("Rien n'est envoyé au fournisseur : l'application passe la commande en statut « commandée ». Le stock augmente à la réception.")}`,
        confirmLabel: t("Passer la commande"),
      },
      run,
    );
  };

  const enter = () => {
    const qty = parsed();
    if (qty === null) return;
    dialog.ask(
      {
        title: t("Enregistrer une entrée de stock ?"),
        message: `+${fmtQty(qty, lang)} ${unit} · ${row.productName} · ${where}. ${
          row.onOrder > 0 ? t("Une commande est déjà en route pour ce produit : si cette marchandise en fait partie, réceptionnez la commande à la place, sinon elle serait comptée deux fois.") : t("Le stock du centre augmente tout de suite.")
        }`,
        confirmLabel: t("Enregistrer l'entrée"),
        danger: row.onOrder > 0,
      },
      () =>
        start(async () => {
          const res = await recordStockMovementAction({ productId: row.productId, centerId: row.centerId, kind: "IN", quantity: qty, note: ENTRY_NOTE });
          if (res.ok) {
            onDone(res.message ?? "Mouvement enregistré.");
            onClose();
          } else setError(t(failure(res)));
        }),
    );
  };

  return (
    <Modal open onClose={onClose} title={t("Réapprovisionner")}>
      <div className="space-y-5">
        <div>
          <p className="font-medium text-white">{row.productName}</p>
          <p className="text-xs text-white/45">
            {where} · {t("Stock actuel")} : <Qty value={row.stock} unit={row.unit} />
            {row.onOrder > 0 && (
              <>
                {" "}
                · {t("déjà commandé")} : <Qty value={row.onOrder} unit={row.unit} />
              </>
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${uid}-qty`}>
              {t("Quantité")} ({unit})
            </label>
            <input id={`${uid}-qty`} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            {row.suggestedQuantity > 0 ? (
              <p className="mt-1 text-xs text-white/40">
                {t("Suggestion")} : <bdi>{fmtQty(row.suggestedQuantity, lang)}</bdi> {unit}
              </p>
            ) : (
              <p className="mt-1 text-xs text-white/40">{t("Pas de suggestion (historique insuffisant) : saisissez la quantité voulue.")}</p>
            )}
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-supplier`}>
              {t("Fournisseur")}
            </label>
            <select id={`${uid}-supplier`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${selectClass} w-full`}>
              <option value="">{t("Choisir un fournisseur")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {suppliers.length === 0 && <p className="mt-1 text-xs text-amber-200">{t("Aucun fournisseur actif : ajoutez-en un depuis l'onglet Fournisseurs.")}</p>}
          </div>
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={pending} onClick={() => order(false)} className="rounded-2xl border border-white/10 px-5 py-2.5 text-sm text-white/80 transition hover:bg-white/5 disabled:opacity-60">
            {t("Créer le brouillon")}
          </button>
          <button type="button" disabled={pending} onClick={() => order(true)} className="btn-shine rounded-2xl px-5 py-2.5 text-sm font-semibold text-plum-950 disabled:opacity-60">
            {pending ? t("Un instant…") : t("Passer la commande")}
          </button>
        </div>

        <div className="border-t border-white/10 pt-4">
          <p className="text-sm text-white">{t("Marchandise déjà reçue ?")}</p>
          <p className="mt-1 text-xs text-white/45">{t("Si elle est arrivée sans commande, enregistrez directement l'entrée dans le stock du centre. Si elle vient d'une commande, réceptionnez la commande à la place.")}</p>
          <button type="button" disabled={pending} onClick={enter} className="mt-3 rounded-2xl border border-white/10 px-5 py-2.5 text-sm text-white/80 transition hover:bg-white/5 disabled:opacity-60">
            {t("Entrée de stock")}
          </button>
        </div>
      </div>
      {dialog.node}
    </Modal>
  );
}
