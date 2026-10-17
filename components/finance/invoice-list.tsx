"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cancelInvoiceAction, type FinanceResult } from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal, Toast } from "@/components/ui/modal";
import { fmtDay, fmtMoney } from "@/lib/booking/format";
import type { InvoiceRow } from "@/lib/data/finance";
import { INVOICE_STATUS_META } from "@/lib/finance/labels";
import { selectClass } from "./finance-ui";

// F6.3 — Liste des factures : recherche, filtre par statut, PDF, annulation (propriétaire).
export function InvoiceList({ invoices, initialQuery, status, canCancel }: { invoices: InvoiceRow[]; initialQuery: string; status: string; canCancel: boolean }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState<FinanceResult | null>(null);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (query === initialQuery) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (query) next.set("q", query);
      else next.delete("q");
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(id);
  }, [query, initialQuery, params, pathname, router]);

  const total = invoices.filter((i) => i.status !== "CANCELLED").reduce((n, i) => n + i.totalTnd, 0);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("N° de facture ou nom du client…")}
          aria-label={t("Rechercher une facture")}
          className={`${selectClass} min-w-56 flex-1`}
        />
        <select aria-label={t("Statut")} value={status} onChange={(e) => update("status", e.target.value)} className={selectClass}>
          <option value="">{t("Tous les statuts")}</option>
          {Object.entries(INVOICE_STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {t(meta.label)}
            </option>
          ))}
        </select>
        {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
      </div>
      <p className="text-xs text-white/45">
        {invoices.length} {t("factures")} · {t("total")} {fmtMoney(total, lang)}
      </p>

      {invoices.length === 0 ? (
        <p className="glass rounded-[2rem] p-10 text-center text-white/50">{t("Aucune facture trouvée.")}</p>
      ) : (
        <div className="glass overflow-x-auto rounded-[2rem] p-2">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs text-white/45">
                <th className="px-3 py-3 text-start font-medium">{t("Numéro")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Date")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Client")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Prestations")}</th>
                <th className="px-3 py-3 text-end font-medium">{t("Total TTC")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Statut")}</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-white/5">
                  <td className="px-3 py-3 font-medium text-white" dir="ltr">{i.number}</td>
                  <td className="px-3 py-3 text-white/60">{fmtDay(i.issuedAt, lang, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="px-3 py-3 text-white/85">
                    {i.customerName}
                    <p className="text-xs text-white/40">{i.center}</p>
                  </td>
                  <td className="max-w-56 truncate px-3 py-3 text-white/60" title={i.lines}>{i.lines}</td>
                  <td className="px-3 py-3 text-end tabular-nums text-white">
                    {fmtMoney(i.totalTnd, lang)}
                    {i.discountTnd > 0 && <p className="text-xs text-white/40">{t("remise")} {fmtMoney(i.discountTnd, lang)}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${INVOICE_STATUS_META[i.status].chip}`} title={i.cancelReason ?? undefined}>
                      {t(INVOICE_STATUS_META[i.status].label)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-end text-xs">
                    <a href={`/api/finance/invoices/${i.id}`} target="_blank" rel="noreferrer" className="text-rose-gold underline-offset-4 hover:underline">
                      PDF
                    </a>
                    {canCancel && i.status !== "CANCELLED" && (
                      <button type="button" onClick={() => setCancelling(i)} className="ms-3 text-white/45 hover:text-red-300">
                        {t("Annuler")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelling && (
        <Modal open onClose={() => setCancelling(null)} title={`${t("Annuler la facture")} ${cancelling.number}`}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await cancelInvoiceAction({ invoiceId: cancelling.id, reason });
                setToast(r);
                if (r.ok) {
                  setCancelling(null);
                  setReason("");
                  router.refresh();
                }
              });
            }}
          >
            <p className="text-sm text-white/65">
              {t("Le numéro reste attribué et la facture est conservée avec la mention « annulée ». Les paiements restent enregistrés : remboursez-les depuis la caisse si nécessaire.")}
            </p>
            <div>
              <label className={labelClass} htmlFor="cancel-reason">{t("Motif")}</label>
              <input id="cancel-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </div>
            <button type="submit" disabled={pending} className="w-full rounded-2xl bg-red-500/80 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60">
              {t("Annuler la facture")}
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
