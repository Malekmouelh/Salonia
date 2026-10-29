"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/my-payments.tsx — LISTES « MES FACTURES » ET « MES REÇUS » (client final)
// ═══════════════════════════════════════════════════════════════════════════
// Affichage simple, sans action de modification : le client consulte et télécharge ses documents.
// Les PDF passent par les mêmes routes que le salon (/api/finance/invoices/[id] et /receipts/[id]) ; côté
// serveur, ces routes n'autorisent un CLIENT que pour ses propres documents.
// ═══════════════════════════════════════════════════════════════════════════

import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtMoney } from "@/lib/booking/format";
import type { MyInvoice, MyPayment } from "@/lib/data/finance";
import { INVOICE_STATUS_META, KIND_LABELS, METHOD_LABELS } from "@/lib/finance/labels";

export function MyPayments({ invoices, payments }: { invoices: MyInvoice[]; payments: MyPayment[] }) {
  const { t, lang } = useI18n();
  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="mb-3 font-display text-2xl text-white">{t("Mes factures")}</h2>
        {invoices.length === 0 ? (
          <p className="glass rounded-[2rem] p-8 text-center text-sm text-white/50">{t("Aucune facture pour le moment.")}</p>
        ) : (
          <ul className="space-y-2">
            {invoices.map((i) => (
              <li key={i.id} className="glass flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white" dir="ltr">{i.number}</p>
                  <p className="truncate text-xs text-white/50">
                    {fmtDay(i.issuedAt, lang, { day: "numeric", month: "long", year: "numeric" })} · {i.center} · {i.lines}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${INVOICE_STATUS_META[i.status].chip}`}>{t(INVOICE_STATUS_META[i.status].label)}</span>
                <span className="tabular-nums text-sm text-white">{fmtMoney(i.totalTnd, lang)}</span>
                {/* Une facture annulée n'est plus téléchargeable par le client (refusée aussi côté serveur). */}
                {i.status !== "CANCELLED" && (
                  <a href={`/api/finance/invoices/${i.id}`} target="_blank" rel="noreferrer" className="text-xs text-rose-gold underline-offset-4 hover:underline">
                    PDF
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl text-white">{t("Mes reçus")}</h2>
        {payments.length === 0 ? (
          <p className="glass rounded-[2rem] p-8 text-center text-sm text-white/50">{t("Aucun paiement pour le moment.")}</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((p) => (
              <li key={p.id} className="glass flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white" dir="ltr">{p.receiptNumber}</p>
                  <p className="text-xs text-white/50">
                    {fmtDay(p.paidAt, lang, { day: "numeric", month: "long", year: "numeric" })} · {p.center} · {t(KIND_LABELS[p.kind])} · {t(METHOD_LABELS[p.method])}
                  </p>
                </div>
                <span className={`tabular-nums text-sm ${p.kind === "REFUND" ? "text-red-300" : "text-white"}`}>
                  {p.kind === "REFUND" ? "− " : ""}
                  {fmtMoney(p.amountTnd, lang)}
                </span>
                <a href={`/api/finance/receipts/${p.id}`} target="_blank" rel="noreferrer" className="text-xs text-rose-gold underline-offset-4 hover:underline">
                  PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
