"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { addRecipeLineAction, removeRecipeLineAction, updateRecipeLineAction } from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { SearchIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { STOCK_UNIT_LABELS } from "@/lib/stock/labels";
import type { RecipeLineView } from "@/lib/stock/recipes";
import { recipeStockWarning, servicesBeforeAlert, type RecipeStockWarning, type StockCover } from "@/lib/stock/recipe-warning";
import { Chip, EmptyState, FieldError, Qty, fmtQty, useConfirm, useFeedback, useSubmit, type ProductItem } from "./stock-shared";

// F5.3 — Recettes de consommation par service (propriétaire seulement). Configuration pure : une recette ne crée aucun mouvement de stock
// et ne modifie pas l'historique ; la consommation automatique lors d'un rendez-vous terminé n'existe pas encore. L'unité vient du produit.

// Phrase d'alerte d'une ligne de recette (déjà traduite) ; null si rien à signaler.
function useStockWarning() {
  const { t, lang } = useI18n();
  return (warning: RecipeStockWarning, cover: StockCover | undefined, quantity: number, unit: ProductItem["unit"]): string | null => {
    const u = t(STOCK_UNIT_LABELS[unit]);
    if (warning === "NOT_TRACKED") return t("Ce produit n'est pas activé dans ce centre : il ne sera pas décompté ici. Activez-le d'abord depuis la vue d'ensemble.");
    if (warning === "INSUFFICIENT") {
      return `${t("Stock de ce centre")} : ${fmtQty(cover?.best ?? 0, lang)} ${u} · ${t("quantité demandée par prestation")} : ${fmtQty(quantity, lang)} ${u}. ${t("À la fin du rendez-vous, la sortie sera limitée à ce qui reste et le manque sera noté dans l'historique.")}`;
    }
    return null;
  };
}

type ServiceItem = { id: string; name: string; category: string; requiredEquipment: string[] };
type CenterItem = { id: string; name: string };

export function RecipesManager({ centers, selectedCenterId, recipeCounts, thresholdByProduct, services, selectedServiceId, lines, products, stockByProduct }: { centers: CenterItem[]; selectedCenterId: string | null; recipeCounts: Record<string, number>; thresholdByProduct: Record<string, number>; services: ServiceItem[]; selectedServiceId: string | null; lines: RecipeLineView[]; products: ProductItem[]; stockByProduct: Record<string, StockCover> }) {
  const { t, lang } = useI18n();
  const uid = useId();
  const feedback = useFeedback();
  const dialog = useConfirm();
  const describe = useStockWarning();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RecipeLineView | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [removing, startRemove] = useTransition();
  const add = useSubmit((m) => {
    feedback.show(m);
    setQuantity("");
    setProductId("");
  });
  const needle = query.trim().toLowerCase();
  const visibleServices = useMemo(() => services.filter((s) => !needle || `${s.name} ${s.category}`.toLowerCase().includes(needle)), [services, needle]);
  const selected = services.find((s) => s.id === selectedServiceId) ?? null;
  const usable = products.filter((p) => !lines.some((l) => l.productId === p.id));
  const chosenUnit = products.find((p) => p.id === productId)?.unit;
  const typed = quantity.trim() === "" ? 0 : Number(quantity);
  const addWarning = productId && chosenUnit ? recipeStockWarning(stockByProduct[productId], typed) : null;
  const addWarningText = addWarning && chosenUnit ? describe(addWarning, stockByProduct[productId], typed, chosenUnit) : null;

  const remove = (line: RecipeLineView) => {
    dialog.ask({ title: t("Retirer ce produit de la recette ?"), message: t("Les mouvements de stock passés ne sont pas modifiés."), confirmLabel: t("Retirer"), danger: true }, () =>
      startRemove(async () => {
        const r = await removeRecipeLineAction({ centerId: line.centerId, serviceId: line.serviceId, productId: line.productId });
        feedback.show(r.ok ? (r.message ?? "Ligne de recette supprimée.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
      }),
    );
  };

  if (!selectedCenterId) return <div className="mt-6"><EmptyState>{t("Aucun centre disponible pour configurer des recettes.")}</EmptyState></div>;
  if (services.length === 0) return <div className="mt-6"><EmptyState>{t("Aucun service dans le catalogue. Créez d'abord vos prestations.")}</EmptyState></div>;

  return (
    <div className="mt-6 space-y-5">
      <div role="note" className="glass rounded-3xl p-5 text-sm text-white/70">
        <p className="font-medium text-white">{t("À quoi sert une recette ?")}</p>
        <p className="mt-1">{t("Une recette indique quels produits consommables une prestation utilise, et en quelle quantité (par exemple : 30 ml de shampoing pour un brushing).")}</p>
        <p className="mt-2">{t("Quand un rendez-vous est marqué terminé, ces quantités sortent automatiquement du stock du centre où il a eu lieu, une seule fois par rendez-vous.")}</p>
        <p className="mt-2 text-xs text-white/50">{t("Le matériel durable (sèche-cheveux, fauteuil, casque…) n'est jamais décompté : il se gère dans l'onglet Matériel. Si le stock est insuffisant, la sortie est limitée à ce qui reste et le manque est noté dans l'historique. Un produit non activé dans le centre n'est pas décompté.")}</p>
      </div>
      <nav aria-label={t("Centre de la recette")} className="glass rounded-3xl p-5">
        <p className="text-sm font-medium text-white">{t("Centre de la recette")}</p>
        <p className="mt-1 text-xs text-white/50">{t("Chaque centre a sa propre recette : une même prestation peut consommer des quantités différentes d'un centre à l'autre. Choisissez d'abord le centre.")}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {centers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/stock/recettes?center=${c.id}${selectedServiceId ? `&service=${selectedServiceId}` : ""}`}
                aria-current={c.id === selectedCenterId ? "page" : undefined}
                className={`block rounded-full border px-4 py-1.5 text-sm transition ${c.id === selectedCenterId ? "border-rose-gold/60 bg-gradient-to-r from-blush/20 to-champagne/20 text-white" : "border-white/10 text-white/70 hover:bg-white/5"}`}
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-5 lg:grid-cols-3">
      <aside className="space-y-3">
        <label className="relative block">
          <span className="sr-only">{t("Rechercher un service")}</span>
          <SearchIcon width={16} height={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Rechercher un service")} className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pe-3 ps-9 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60" />
        </label>
        <ul className="glass max-h-[28rem] divide-y divide-white/5 overflow-y-auto rounded-[2rem] px-2 py-2">
          {visibleServices.length === 0 && <li className="p-4 text-center text-sm text-white/45">{t("Aucun service ne correspond.")}</li>}
          {visibleServices.map((s) => (
            <li key={s.id}>
              <Link
                href={`/dashboard/stock/recettes?center=${selectedCenterId}&service=${s.id}`}
                aria-current={s.id === selectedServiceId ? "page" : undefined}
                className={`block rounded-2xl px-4 py-2.5 transition ${s.id === selectedServiceId ? "bg-gradient-to-r from-blush/20 to-champagne/20 text-white" : "text-white/70 hover:bg-white/5"}`}
              >
                <p className="truncate text-sm">{s.name}</p>
                <p className="flex items-center gap-2 text-xs text-white/40">
                  <span className="truncate">{s.category}</span>
                  {recipeCounts[s.id] ? <Chip tone="info"><bdi>{recipeCounts[s.id]}</bdi> {t("produit(s) décompté(s)")}</Chip> : <Chip tone="muted">{t("Sans recette : rien n'est décompté")}</Chip>}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="space-y-4 lg:col-span-2">
        {selected && (
          <>
            <div className="glass rounded-[2rem] p-6">
              <h2 className="font-display text-xl text-white">{selected.name}</h2>
              <p className="text-xs text-champagne">{centers.find((c) => c.id === selectedCenterId)?.name}</p>
              <p className="text-xs text-white/45">{t("Consommation attendue à chaque prestation terminée")}</p>
              {lines.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/45">{t("Aucun produit dans cette recette.")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-white/5">
                  {lines.map((l) => (
                    <li key={l.productId} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white">{l.productName}</p>
                        {!l.productActive && <Chip tone="muted">{t("Archivé")}</Chip>}
                        <p className="text-xs text-white/45">
                          {t("Stock actuel")} : <Qty value={stockByProduct[l.productId]?.total ?? 0} unit={l.unit} /> · ≈ <bdi>{fmtQty(Math.floor((stockByProduct[l.productId]?.best ?? 0) / l.quantityPerService), lang)}</bdi> {t("prestation(s) possibles dans ce centre")}
                        </p>
                        {(() => {
                          const cover = stockByProduct[l.productId];
                          if (!cover || cover.centers === 0) return null;
                          const threshold = thresholdByProduct[l.productId] ?? 0;
                          const n = servicesBeforeAlert(cover.best, threshold, l.quantityPerService);
                          if (n === null) return null;
                          return (
                            <p className={`text-xs ${n === 0 ? "text-amber-200" : "text-white/45"}`}>
                              {t("Seuil d'alerte")} : <Qty value={threshold} unit={l.unit} /> · {n === 0 ? t("seuil déjà atteint dans ce centre") : <>{t("alerte de stock après environ")} <bdi>{fmtQty(n, lang)}</bdi> {t("prestation(s)")}</>}
                            </p>
                          );
                        })()}
                      </div>
                      <span className="text-sm text-white">
                        <Qty value={l.quantityPerService} unit={l.unit} />
                      </span>
                      <span className="flex gap-3 text-xs">
                        <button type="button" onClick={() => setEditing(l)} className="text-white/60 hover:text-white">
                          {t("Modifier")}
                        </button>
                        <button type="button" disabled={removing} onClick={() => remove(l)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                          {t("Retirer")}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="glass rounded-[2rem] p-6">
              <h3 className="text-sm font-medium text-white">{t("Matériel utilisé (non consommé)")}</h3>
              {selected.requiredEquipment.length === 0 ? (
                <p className="mt-2 text-sm text-white/45">{t("Aucun matériel renseigné pour cette prestation.")}</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {selected.requiredEquipment.map((name) => (
                    <li key={name}>
                      <Chip tone="info">{name}</Chip>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-white/40">
                {t("Renseigné dans la fiche du service (catalogue). Ces équipements restent en place : leur suivi et leur maintenance sont dans l'onglet Matériel.")}{" "}
                <Link href="/dashboard/stock/materiel" className="text-champagne hover:underline">
                  {t("Gérer le matériel")}
                </Link>
              </p>
            </div>

            <form
              className="glass space-y-3 rounded-[2rem] p-6"
              onSubmit={(e) => {
                e.preventDefault();
                const send = () => add.submit(() => addRecipeLineAction({ centerId: selectedCenterId, serviceId: selected.id, productId, quantityPerService: quantity.trim() === "" ? undefined : Number(quantity) }));
                if (addWarningText) dialog.ask({ title: t("Stock insuffisant pour cette recette"), message: addWarningText, confirmLabel: t("Ajouter quand même") }, send);
                else send();
              }}
            >
              <h3 className="text-sm font-medium text-white">{t("Ajouter un produit consommable")}</h3>
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <div>
                  <label className={labelClass} htmlFor={`${uid}-product`}>{t("Produit")}</label>
                  <select id={`${uid}-product`} value={productId} onChange={(e) => setProductId(e.target.value)} required className={`${selectClass} w-full`}>
                    <option value="">{t("Choisir un produit")}</option>
                    {usable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({t(STOCK_UNIT_LABELS[p.unit])})
                      </option>
                    ))}
                  </select>
                  <FieldError errors={add.errors} name="productId" />
                </div>
                <div>
                  <label className={labelClass} htmlFor={`${uid}-qty`}>
                    {t("Quantité")} {chosenUnit ? `(${t(STOCK_UNIT_LABELS[chosenUnit])})` : ""}
                  </label>
                  <input id={`${uid}-qty`} inputMode="numeric" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
                  <FieldError errors={add.errors} name="quantityPerService" />
                </div>
              </div>
              <p className="text-xs text-white/40">{t("Seulement ce qui se consomme et se rachète (shampoing, kératine, gants…). L'unité vient du produit. Une recette modifiée ne change pas les mouvements passés.")}</p>
              {addWarningText && (
                <p role="alert" className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {addWarningText}
                </p>
              )}
              <FieldError errors={add.errors} name="serviceId" />
              {add.message && <Alert>{t(add.message)}</Alert>}
              <SubmitButton pending={add.pending}>{t("Ajouter à la recette")}</SubmitButton>
            </form>
          </>
        )}
      </section>
      </div>

      {editing && <QuantityModal line={editing} cover={stockByProduct[editing.productId]} onClose={() => setEditing(null)} onDone={(m) => feedback.show(m)} />}
      {feedback.node}
      {dialog.node}
    </div>
  );
}

function QuantityModal({ line, cover, onClose, onDone }: { line: RecipeLineView; cover: StockCover | undefined; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const describe = useStockWarning();
  const uid = useId();
  const [quantity, setQuantity] = useState(String(line.quantityPerService));
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Modifier la quantité")}>
      <p className="mb-4 text-sm text-white/60">{line.productName}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => updateRecipeLineAction({ centerId: line.centerId, serviceId: line.serviceId, productId: line.productId, quantityPerService: quantity.trim() === "" ? undefined : Number(quantity) }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-qty`}>
            {t("Quantité")} ({t(STOCK_UNIT_LABELS[line.unit])})
          </label>
          <input id={`${uid}-qty`} inputMode="numeric" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
          <FieldError errors={errors} name="quantityPerService" />
        </div>
        {(() => {
          const typed = quantity.trim() === "" ? 0 : Number(quantity);
          const text = describe(recipeStockWarning(cover, typed), cover, typed, line.unit);
          return text ? (
            <p role="alert" className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {text}
            </p>
          ) : null;
        })()}
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}
