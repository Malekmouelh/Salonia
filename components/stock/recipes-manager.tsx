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
import { Chip, EmptyState, FieldError, Qty, useFeedback, useSubmit, type ProductItem } from "./stock-shared";

// F5.3 — Recettes de consommation par service (propriétaire seulement). Configuration pure : une recette ne crée aucun mouvement de stock
// et ne modifie pas l'historique ; la consommation automatique lors d'un rendez-vous terminé n'existe pas encore. L'unité vient du produit.

type ServiceItem = { id: string; name: string; category: string };

export function RecipesManager({ services, selectedServiceId, lines, products }: { services: ServiceItem[]; selectedServiceId: string | null; lines: RecipeLineView[]; products: ProductItem[] }) {
  const { t } = useI18n();
  const uid = useId();
  const feedback = useFeedback();
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

  const remove = (line: RecipeLineView) => {
    if (!confirm(t("Retirer ce produit de la recette ?"))) return;
    startRemove(async () => {
      const r = await removeRecipeLineAction({ serviceId: line.serviceId, productId: line.productId });
      feedback.show(r.ok ? (r.message ?? "Ligne de recette supprimée.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
    });
  };

  if (services.length === 0) return <div className="mt-6"><EmptyState>{t("Aucun service dans le catalogue. Créez d'abord vos prestations.")}</EmptyState></div>;

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-3">
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
                href={`/dashboard/stock/recettes?service=${s.id}`}
                aria-current={s.id === selectedServiceId ? "page" : undefined}
                className={`block rounded-2xl px-4 py-2.5 transition ${s.id === selectedServiceId ? "bg-gradient-to-r from-blush/20 to-champagne/20 text-white" : "text-white/70 hover:bg-white/5"}`}
              >
                <p className="truncate text-sm">{s.name}</p>
                <p className="text-xs text-white/40">{s.category}</p>
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

            <form
              className="glass space-y-3 rounded-[2rem] p-6"
              onSubmit={(e) => {
                e.preventDefault();
                add.submit(() => addRecipeLineAction({ serviceId: selected.id, productId, quantityPerService: quantity.trim() === "" ? undefined : Number(quantity) }));
              }}
            >
              <h3 className="text-sm font-medium text-white">{t("Ajouter un produit à la recette")}</h3>
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
              <p className="text-xs text-white/40">{t("L'unité vient du produit. Une recette modifiée ne change pas les mouvements passés.")}</p>
              <FieldError errors={add.errors} name="serviceId" />
              {add.message && <Alert>{t(add.message)}</Alert>}
              <SubmitButton pending={add.pending}>{t("Ajouter à la recette")}</SubmitButton>
            </form>
          </>
        )}
      </section>

      {editing && <QuantityModal line={editing} onClose={() => setEditing(null)} onDone={(m) => feedback.show(m)} />}
      {feedback.node}
    </div>
  );
}

function QuantityModal({ line, onClose, onDone }: { line: RecipeLineView; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
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
          submit(() => updateRecipeLineAction({ serviceId: line.serviceId, productId: line.productId, quantityPerService: quantity.trim() === "" ? undefined : Number(quantity) }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-qty`}>
            {t("Quantité")} ({t(STOCK_UNIT_LABELS[line.unit])})
          </label>
          <input id={`${uid}-qty`} inputMode="numeric" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
          <FieldError errors={errors} name="quantityPerService" />
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}
