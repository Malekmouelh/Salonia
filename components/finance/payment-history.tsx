"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/payment-history.tsx — HISTORIQUE DES PAIEMENTS ET DES CLÔTURES
// ═══════════════════════════════════════════════════════════════════════════
// Deux tableaux :
//   • PaymentHistory : le REGISTRE de tous les mouvements d'argent (payés, en attente de lien, échoués,
//     annulés), avec recherche et filtres, et deux actions : REMBOURSER un paiement et ANNULER un lien
//     de paiement en ligne encore en attente.
//   • ClosingHistory : les clôtures de caisse passées (compté, attendu, écart) avec le rapport PDF.
// Les filtres sont écrits dans l'ADRESSE (comme pour les factures) : la page serveur relit et recalcule.
// ═══════════════════════════════════════════════════════════════════════════

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cancelPaymentLinkAction, type FinanceResult } from "@/app/actions/finance";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Toast } from "@/components/ui/modal";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { PaymentHistoryRow } from "@/lib/data/finance";
import { PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_STATUSES } from "@/lib/enums";
import type { ClosingRow } from "@/lib/finance/closing";
import { KIND_LABELS, METHOD_LABELS, PAYMENT_STATUS_META } from "@/lib/finance/labels";
import { RefundModal } from "./cash-desk";
import { selectClass } from "./finance-ui";

export function PaymentHistory({
  rows,
  initialQuery,
  filters,
}: {
  rows: PaymentHistoryRow[];
  initialQuery: string;
  filters: { method: string; kind: string; status: string };
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery); // texte de recherche en cours de saisie
  const [pending, startTransition] = useTransition();
  const [refunding, setRefunding] = useState<PaymentHistoryRow | null>(null); // paiement dont on ouvre le remboursement
  const [toast, setToast] = useState<FinanceResult | null>(null);

  // Modifie un paramètre de l'adresse en gardant les autres (valeur vide = on retire le paramètre).
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // « Debounce » : on attend 300 ms sans frappe avant de lancer la recherche (voir invoice-list.tsx).
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

  // Total net des paiements CONFIRMÉS affichés (les remboursements sont soustraits).
  const total = rows.filter((r) => r.status === "PAID").reduce((n, r) => n + (r.kind === "REFUND" ? -r.amountTnd : r.amountTnd), 0);

  const cancelLink = (id: string) => {
    if (!confirm(t("Annuler ce lien de paiement ? Le client ne pourra plus l'utiliser."))) return;
    startTransition(async () => {
      const r = await cancelPaymentLinkAction(id);
      setToast(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("N° de reçu ou référence…")}
          aria-label={t("Rechercher un paiement")}
          className={`${selectClass} min-w-48 flex-1`}
        />
        <select aria-label={t("Moyen de paiement")} value={filters.method} onChange={(e) => update("method", e.target.value)} className={selectClass}>
          <option value="">{t("Tous les moyens")}</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(METHOD_LABELS[m])}
            </option>
          ))}
        </select>
        <select aria-label={t("Nature")} value={filters.kind} onChange={(e) => update("kind", e.target.value)} className={selectClass}>
          <option value="">{t("Toutes les natures")}</option>
          {PAYMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABELS[k])}
            </option>
          ))}
        </select>
        <select aria-label={t("Statut")} value={filters.status} onChange={(e) => update("status", e.target.value)} className={selectClass}>
          <option value="">{t("Tous les statuts")}</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(PAYMENT_STATUS_META[s].label)}
            </option>
          ))}
        </select>
        {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
      </div>
      <p className="text-xs text-white/45">
        {rows.length} {t("paiements")} · {t("net encaissé")} {fmtMoney(total, lang)}
      </p>

      {rows.length === 0 ? (
        <p className="glass rounded-[2rem] p-10 text-center text-white/50">{t("Aucun paiement trouvé.")}</p>
      ) : (
        <div className="glass overflow-x-auto rounded-[2rem] p-2">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="text-xs text-white/45">
                <th className="px-3 py-3 text-start font-medium">{t("Date")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Client")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Nature")}</th>
                <th className="px-3 py-3 text-end font-medium">{t("Montant")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Statut")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Pièces")}</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="whitespace-nowrap px-3 py-3 text-white/60">
                    {fmtDay(p.at, lang, { day: "numeric", month: "short" })} · {fmtTime(p.at, lang)}
                  </td>
                  <td className="px-3 py-3 text-white/85">
                    {p.customer}
                    <p className="text-xs text-white/40">{p.center}</p>
                  </td>
                  <td className="px-3 py-3 text-white/70">
                    {t(KIND_LABELS[p.kind])}
                    <p className="text-xs text-white/40">
                      {t(METHOD_LABELS[p.method])}
                      {p.reference && ` · ${p.reference}`}
                    </p>
                  </td>
                  {/* Un remboursement est affiché en rouge avec un signe « − ». */}
                  <td className={`px-3 py-3 text-end tabular-nums ${p.kind === "REFUND" ? "text-red-300" : "text-white"}`}>
                    {p.kind === "REFUND" ? "− " : ""}
                    {fmtMoney(p.amountTnd, lang)}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${PAYMENT_STATUS_META[p.status].chip}`}>{t(PAYMENT_STATUS_META[p.status].label)}</span>
                    {/* Lien en attente : expiration et essais de carte déjà ratés. */}
                    {p.status === "PENDING" && p.expiresAt && (
                      <p className="mt-1 text-[11px] text-white/40">
                        {t("expire le")} {fmtDay(p.expiresAt, lang, { day: "numeric", month: "short" })}
                        {p.attempts > 0 && ` · ${p.attempts} ${t("essai(s) raté(s)")}`}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {p.receiptNumber && (
                      <a href={`/api/finance/receipts/${p.id}`} target="_blank" rel="noreferrer" className="block text-rose-gold underline-offset-4 hover:underline" dir="ltr">
                        {p.receiptNumber}
                      </a>
                    )}
                    {p.invoiceNumber && <span className="block text-white/45" dir="ltr">{p.invoiceNumber}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-end text-xs">
                    {p.refundable > 0 && (
                      <button type="button" onClick={() => setRefunding(p)} className="text-white/55 hover:text-white">
                        {t("Rembourser")}
                      </button>
                    )}
                    {p.status === "PENDING" && p.method === "ONLINE" && (
                      <button type="button" onClick={() => cancelLink(p.id)} className="text-white/55 hover:text-red-300">
                        {t("Annuler le lien")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Le remboursement réutilise la fenêtre de la caisse (cash-desk.tsx) : même règle, même action serveur. */}
      {refunding && (
        <RefundModal
          payment={{
            id: refunding.id,
            paidAt: refunding.at,
            kind: refunding.kind,
            method: refunding.method,
            amountTnd: refunding.amountTnd,
            receiptNumber: refunding.receiptNumber,
            label: refunding.customer,
            reference: refunding.reference,
            refundable: refunding.refundable,
          }}
          onClose={() => setRefunding(null)}
          onResult={(r) => {
            setToast(r);
            if (r.ok) {
              setRefunding(null);
              router.refresh();
            }
          }}
        />
      )}
      {toast && (
        <Toast tone={toast.error ? "error" : "success"} onDone={() => setToast(null)}>
          {t(toast.error ?? toast.message ?? "")}
        </Toast>
      )}
    </div>
  );
}

// Historique des clôtures de caisse : une ligne par centre et par jour clôturé.
export function ClosingHistory({ rows }: { rows: ClosingRow[] }) {
  const { t, lang } = useI18n();
  if (rows.length === 0) return <p className="glass rounded-[2rem] p-8 text-center text-sm text-white/50">{t("Aucune clôture de caisse sur la période.")}</p>;
  return (
    <div className="glass overflow-x-auto rounded-[2rem] p-2">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="text-xs text-white/45">
            <th className="px-3 py-3 text-start font-medium">{t("Jour")}</th>
            <th className="px-3 py-3 text-start font-medium">{t("Centre")}</th>
            <th className="px-3 py-3 text-end font-medium">{t("Attendu (espèces)")}</th>
            <th className="px-3 py-3 text-end font-medium">{t("Compté")}</th>
            <th className="px-3 py-3 text-end font-medium">{t("Écart")}</th>
            <th className="px-3 py-3 text-start font-medium">{t("Clôturée par")}</th>
            <th className="px-3 py-3" />
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-white/5">
              <td className="whitespace-nowrap px-3 py-3 text-white/80">{fmtDay(c.day, lang, { day: "numeric", month: "short", year: "numeric" })}</td>
              <td className="px-3 py-3 text-white/70">{c.center}</td>
              <td className="px-3 py-3 text-end text-white/70">{fmtMoney(c.expectedCashTnd, lang)}</td>
              <td className="px-3 py-3 text-end text-white/85">{fmtMoney(c.countedCashTnd, lang)}</td>
              {/* Écart : couleur + symbole (✓ / ▲ / ▼) : l'information ne dépend pas que de la couleur. */}
              <td className={`px-3 py-3 text-end font-medium ${c.varianceTnd === 0 ? "text-emerald-300" : "text-amber-200"}`}>
                {c.varianceTnd === 0 ? "✓ 0" : `${c.varianceTnd > 0 ? "▲ +" : "▼ "}${fmtMoney(c.varianceTnd, lang)}`}
              </td>
              <td className="px-3 py-3 text-white/55">{c.closedBy}</td>
              <td className="px-3 py-3 text-end text-xs">
                <a href={`/api/finance/closings/${c.id}`} target="_blank" rel="noreferrer" className="text-rose-gold underline-offset-4 hover:underline">
                  PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
