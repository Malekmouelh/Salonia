"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteExpenseAction, saveExpenseAction, type FinanceResult } from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal, Toast } from "@/components/ui/modal";
import { dayKey } from "@/lib/booking/time";
import { fmtDay, fmtMoney } from "@/lib/booking/format";
import type { ExpenseRowData } from "@/lib/data/finance";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/enums";
import { EXPENSE_LABELS, EXPENSE_METHOD_LABELS } from "@/lib/finance/labels";
import { BarList, Panel, selectClass } from "./finance-ui";

// F6.4 — Suivi des dépenses (loyer, produits, salaires…) par centre.

type Draft = { id?: string; centerId: string; category: ExpenseCategory; label: string; amountTnd: string; date: string; method: string; supplier: string };

export function ExpenseManager({
  expenses,
  centers,
  defaultCenter,
  canEditSalaries,
}: {
  expenses: ExpenseRowData[];
  centers: { id: string; name: string }[];
  defaultCenter: string;
  canEditSalaries: boolean;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState<FinanceResult | null>(null);
  const [filter, setFilter] = useState<string>("");

  const blank = (): Draft => ({ centerId: defaultCenter, category: "PRODUCTS", label: "", amountTnd: "", date: dayKey(new Date()), method: "CASH", supplier: "" });
  const visible = filter ? expenses.filter((e) => e.category === filter) : expenses;
  const total = visible.reduce((n, e) => n + e.amountTnd, 0);
  const byCategory = EXPENSE_CATEGORIES.map((c) => ({
    key: c,
    label: EXPENSE_LABELS[c],
    amount: expenses.filter((e) => e.category === c).reduce((n, e) => n + e.amountTnd, 0),
  }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const done = (r: FinanceResult) => {
    setToast(r);
    if (r.ok) {
      setDraft(null);
      router.refresh();
    }
  };

  const editable = (e: ExpenseRowData) => e.category !== "SALARIES" || canEditSalaries;

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t("Catégorie")} value={filter} onChange={(e) => setFilter(e.target.value)} className={selectClass}>
            <option value="">{t("Toutes les catégories")}</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(EXPENSE_LABELS[c])}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/45">
            {visible.length} {t("dépenses")} · {fmtMoney(total, lang)}
          </span>
          <button type="button" onClick={() => setDraft(blank())} className="btn-shine ms-auto rounded-xl px-4 py-2 text-sm font-semibold text-plum-950">
            + {t("Nouvelle dépense")}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="glass rounded-[2rem] p-10 text-center text-white/50">{t("Aucune dépense sur la période.")}</p>
        ) : (
          <ul className="glass divide-y divide-white/5 rounded-[2rem] px-5 py-2">
            {visible.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="w-20 shrink-0 text-xs text-white/50">{fmtDay(e.date, lang, { day: "numeric", month: "short" })}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{e.label}</p>
                  <p className="text-xs text-white/45">
                    {t(EXPENSE_LABELS[e.category])} · {e.center}
                    {e.supplier && ` · ${e.supplier}`} · {t(EXPENSE_METHOD_LABELS[e.method] ?? e.method)}
                  </p>
                </div>
                <span className="tabular-nums text-sm text-white">{fmtMoney(e.amountTnd, lang)}</span>
                {editable(e) && (
                  <span className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ id: e.id, centerId: e.centerId, category: e.category, label: e.label, amountTnd: String(e.amountTnd), date: e.date, method: e.method, supplier: e.supplier ?? "" })
                      }
                      className="text-white/50 hover:text-white"
                    >
                      {t("Modifier")}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (confirm(t("Supprimer cette dépense ?"))) startTransition(async () => done(await deleteExpenseAction(e.id)));
                      }}
                      className="text-white/50 hover:text-red-300"
                    >
                      {t("Supprimer")}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Panel title="Répartition" subtitle="Dépenses de la période par catégorie" className="h-fit">
        <BarList rows={byCategory} empty="Aucune dépense sur la période." translateLabels />
      </Panel>

      {draft && (
        <Modal open onClose={() => setDraft(null)} title={t(draft.id ? "Modifier la dépense" : "Nouvelle dépense")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => done(await saveExpenseAction({ ...draft, amountTnd: Number(draft.amountTnd) || 0, method: draft.method as never })));
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="exp-category">{t("Catégorie")}</label>
                <select id="exp-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as ExpenseCategory })} className={`${selectClass} w-full`}>
                  {EXPENSE_CATEGORIES.filter((c) => c !== "SALARIES" || canEditSalaries).map((c) => (
                    <option key={c} value={c}>
                      {t(EXPENSE_LABELS[c])}
                    </option>
                  ))}
                </select>
              </div>
              {centers.length > 1 ? (
                <div>
                  <label className={labelClass} htmlFor="exp-center">{t("Centre")}</label>
                  <select id="exp-center" value={draft.centerId} onChange={(e) => setDraft({ ...draft, centerId: e.target.value })} className={`${selectClass} w-full`}>
                    {centers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div />
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="exp-label">{t("Libellé")}</label>
              <input id="exp-label" required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder={t("Ex. loyer d'octobre, colorations L'Oréal…")} className={inputClass} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="exp-amount">{t("Montant (DT)")}</label>
                <input id="exp-amount" required inputMode="decimal" value={draft.amountTnd} onChange={(e) => setDraft({ ...draft, amountTnd: e.target.value.replace(",", ".") })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="exp-date">{t("Date")}</label>
                <input id="exp-date" type="date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={`${inputClass} [color-scheme:dark]`} />
              </div>
              <div>
                <label className={labelClass} htmlFor="exp-method">{t("Moyen de paiement")}</label>
                <select id="exp-method" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })} className={`${selectClass} w-full`}>
                  {["CASH", "CARD", "TRANSFER", "CHECK", "MOBILE"].map((m) => (
                    <option key={m} value={m}>
                      {t(EXPENSE_METHOD_LABELS[m])}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="exp-supplier">{t("Fournisseur (facultatif)")}</label>
                <input id="exp-supplier" value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} className={inputClass} />
              </div>
            </div>
            <button type="submit" disabled={pending} className="btn-shine w-full rounded-2xl py-3 text-sm font-semibold text-plum-950 disabled:opacity-60">
              {pending ? t("Un instant…") : t("Enregistrer")}
            </button>
          </form>
        </Modal>
      )}
      {toast && (
        <Toast tone={toast.error ? "error" : "success"} onDone={() => setToast(null)}>
          {t(toast.error ?? toast.message ?? "")}
        </Toast>
      )}
    </div>
  );
}
