"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  checkoutAction,
  createPaymentLinkAction,
  directSaleAction,
  invoiceBookingAction,
  recordDepositAction,
  refundAction,
  type FinanceResult,
} from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { STATUS_META } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal, Toast } from "@/components/ui/modal";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { BookingStatus, PaymentMethod } from "@/lib/enums";
import type { CashDeskBooking, CashPayment } from "@/lib/data/finance";
import { KIND_LABELS, METHOD_LABELS } from "@/lib/finance/labels";
import { roundTnd, sumTnd } from "@/lib/finance/money";
import { selectClass } from "./finance-ui";

// F6.1 — Caisse : encaissement des rendez-vous (paiement fractionné, remise), acomptes,
// liens de paiement en ligne (F6.2), vente directe, journal de caisse et remboursements.

type Service = { id: string; name: string; category: string; priceTnd: number };
type Tender = { method: PaymentMethod; amountTnd: string; reference: string };

const COUNTER_METHODS: PaymentMethod[] = ["CASH", "CARD", "MOBILE"];

export function CashDesk({
  centers,
  centerId,
  day,
  today,
  unpaid,
  upcoming,
  payments,
  totals,
  totalTnd,
  canManage,
  services,
}: {
  centers: { id: string; name: string }[];
  centerId: string;
  day: string;
  today: CashDeskBooking[];
  unpaid: CashDeskBooking[];
  upcoming: CashDeskBooking[];
  payments: CashPayment[];
  totals: { method: PaymentMethod; amount: number }[];
  totalTnd: number;
  canManage: boolean;
  services: Service[];
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<
    | { type: "checkout" | "deposit" | "link"; booking: CashDeskBooking }
    | { type: "refund"; payment: CashPayment }
    | { type: "sale" }
    | null
  >(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string; links?: { href: string; label: string }[] } | null>(null);

  const go = (params: Record<string, string>) => {
    const sp = new URLSearchParams({ center: centerId, day, ...params });
    startTransition(() => router.replace(`/dashboard/finances/caisse?${sp.toString()}`, { scroll: false }));
  };

  const onResult = (r: FinanceResult) => {
    if (r.error) {
      setToast({ tone: "error", text: r.error });
      return;
    }
    const links = [
      ...(r.invoiceId ? [{ href: `/api/finance/invoices/${r.invoiceId}`, label: "Voir la facture" }] : []),
      ...(r.receiptId ? [{ href: `/api/finance/receipts/${r.receiptId}`, label: "Voir le reçu" }] : []),
    ];
    setToast({ tone: "success", text: r.message ?? "OK", links });
    if (!r.link) setModal(null);
    router.refresh();
  };

  const issueInvoice = (b: CashDeskBooking) =>
    startTransition(async () => onResult(await invoiceBookingAction(b.id)));

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {centers.length > 1 && (
          <select aria-label={t("Centre")} value={centerId} onChange={(e) => go({ center: e.target.value })} className={selectClass}>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input type="date" aria-label={t("Jour")} value={day} onChange={(e) => e.target.value && go({ day: e.target.value })} className={`${selectClass} [color-scheme:dark]`} />
        {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
        {canManage && (
          <button type="button" onClick={() => setModal({ type: "sale" })} className="btn-shine ms-auto rounded-xl px-4 py-2 text-sm font-semibold text-plum-950">
            + {t("Vente directe")}
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <BookingSection title="Rendez-vous du jour" empty="Aucun rendez-vous ce jour-là." rows={today}>
            {(b) => <BookingActions b={b} onOpen={(type) => setModal({ type, booking: b })} onInvoice={() => issueInvoice(b)} />}
          </BookingSection>
          {unpaid.length > 0 && (
            <BookingSection title="Impayés des 14 derniers jours" empty="" rows={unpaid} showDay>
              {(b) => <BookingActions b={b} onOpen={(type) => setModal({ type, booking: b })} onInvoice={() => issueInvoice(b)} />}
            </BookingSection>
          )}
          <BookingSection title="Acomptes : rendez-vous à venir" empty="Aucun rendez-vous à venir sur 7 jours." rows={upcoming} showDay>
            {(b) => (
              <div className="flex flex-wrap gap-2">
                <SmallButton onClick={() => setModal({ type: "deposit", booking: b })}>{t("Acompte")}</SmallButton>
                <SmallButton onClick={() => setModal({ type: "link", booking: b })}>{b.pendingLink ? t("Nouveau lien") : t("Lien de paiement")}</SmallButton>
              </div>
            )}
          </BookingSection>
        </div>

        <section className="glass h-fit rounded-[2rem] p-6 lg:col-span-2">
          <h2 className="font-display text-xl text-white">{t("Journal de caisse")}</h2>
          <p className="text-xs text-white/45">{fmtDay(day, lang)}</p>
          <div className="mt-4 rounded-2xl bg-white/[0.04] p-4">
            <p className="text-xs text-white/50">{t("Total encaissé")}</p>
            <p className="text-3xl font-semibold text-white">{fmtMoney(totalTnd, lang)}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {totals.length === 0 && <li className="text-white/40">{t("Aucun encaissement.")}</li>}
              {totals.map((m) => (
                <li key={m.method} className="flex justify-between text-white/70">
                  <span>{t(METHOD_LABELS[m.method])}</span>
                  <span className="tabular-nums text-white">{fmtMoney(m.amount, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
          <ul className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto pe-1">
            {payments.map((p) => (
              <li key={p.id} className="rounded-2xl border border-white/5 px-3 py-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-white">{p.label}</p>
                    <p className="text-xs text-white/45">
                      {fmtTime(p.paidAt, lang)} · {t(KIND_LABELS[p.kind])} · {t(METHOD_LABELS[p.method])}
                    </p>
                  </div>
                  <span className={`shrink-0 tabular-nums ${p.kind === "REFUND" ? "text-red-300" : "text-white"}`}>
                    {p.kind === "REFUND" ? "− " : ""}
                    {fmtMoney(p.amountTnd, lang)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                  {p.receiptNumber && (
                    <a href={`/api/finance/receipts/${p.id}`} target="_blank" rel="noreferrer" className="text-rose-gold underline-offset-4 hover:underline">
                      {p.receiptNumber}
                    </a>
                  )}
                  {canManage && p.refundable > 0 && (
                    <button type="button" onClick={() => setModal({ type: "refund", payment: p })} className="text-white/45 hover:text-white">
                      {t("Rembourser")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {modal?.type === "checkout" && <CheckoutModal booking={modal.booking} canDiscount={canManage} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "deposit" && <DepositModal booking={modal.booking} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "link" && <LinkModal booking={modal.booking} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "refund" && <RefundModal payment={modal.payment} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "sale" && <SaleModal centerId={centerId} services={services} onClose={() => setModal(null)} onResult={onResult} />}
      {toast && (
        <Toast tone={toast.tone} onDone={() => setToast(null)}>
          {t(toast.text)}
          {toast.links?.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="ms-3 font-semibold underline underline-offset-4">
              {t(l.label)}
            </a>
          ))}
        </Toast>
      )}
    </div>
  );
}

function SmallButton({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "btn-shine rounded-xl px-3.5 py-1.5 text-xs font-semibold text-plum-950"
          : "rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/75 transition hover:border-rose-gold/40 hover:text-white"
      }
    >
      {children}
    </button>
  );
}

function BookingActions({ b, onOpen, onInvoice }: { b: CashDeskBooking; onOpen: (type: "checkout" | "deposit" | "link") => void; onInvoice: () => void }) {
  const { t } = useI18n();
  if (b.invoice) {
    return (
      <a href={`/api/finance/invoices/${b.invoice.id}`} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/75 transition hover:border-rose-gold/40 hover:text-white">
        {t("Facture")} {b.invoice.number}
      </a>
    );
  }
  if (b.dueTnd <= 0) return <SmallButton onClick={onInvoice}>{t("Émettre la facture")}</SmallButton>;
  return (
    <div className="flex flex-wrap gap-2">
      <SmallButton primary onClick={() => onOpen("checkout")}>{t("Encaisser")}</SmallButton>
      {new Date(b.start) > new Date() && <SmallButton onClick={() => onOpen("deposit")}>{t("Acompte")}</SmallButton>}
      <SmallButton onClick={() => onOpen("link")}>{t("Lien de paiement")}</SmallButton>
    </div>
  );
}

function BookingSection({
  title,
  empty,
  rows,
  showDay,
  children,
}: {
  title: string;
  empty: string;
  rows: CashDeskBooking[];
  showDay?: boolean;
  children: (b: CashDeskBooking) => ReactNode;
}) {
  const { t, lang } = useI18n();
  return (
    <section className="glass rounded-[2rem] p-6">
      <h2 className="font-display text-xl text-white">{t(title)}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-white/45">{t(empty)}</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/5">
          {rows.map((b) => {
            const status = STATUS_META[b.status as BookingStatus];
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="w-14 shrink-0 text-center">
                  <p className="text-sm font-semibold text-white">{fmtTime(b.start, lang)}</p>
                  {showDay && <p className="text-[10px] text-white/45">{fmtDay(b.start, lang, { day: "numeric", month: "short" })}</p>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">
                    {b.customer} <span className="text-white/40">· {b.staff}</span>
                  </p>
                  <p className="truncate text-xs text-white/50">{b.services}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 ${status.chip}`}>{t(status.label)}</span>
                    <span className="tabular-nums text-white/70">{fmtMoney(b.totalTnd, lang)}</span>
                    {b.invoice || b.dueTnd <= 0 ? (
                      <span className="text-emerald-300">✓ {t("Payé")}</span>
                    ) : b.paidTnd > 0 ? (
                      <span className="text-amber-200">
                        {t("Reste")} {fmtMoney(b.dueTnd, lang)}
                      </span>
                    ) : null}
                    {b.pendingLink && <span className="text-sky-200">↗ {t("lien envoyé")}</span>}
                  </p>
                </div>
                <div className="shrink-0">{children(b)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// Saisie des moyens de paiement (paiement fractionné : jusqu'à 4 lignes).
function TenderEditor({ tenders, setTenders, due }: { tenders: Tender[]; setTenders: (t: Tender[]) => void; due: number }) {
  const { t, lang } = useI18n();
  const [received, setReceived] = useState("");
  const update = (i: number, patch: Partial<Tender>) => setTenders(tenders.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const cash = tenders.find((x) => x.method === "CASH");
  const change = cash && received ? roundTnd(Number(received) - Number(cash.amountTnd || 0)) : null;
  const total = sumTnd(tenders.map((x) => Number(x.amountTnd) || 0));
  return (
    <div className="space-y-2">
      {tenders.map((tender, i) => (
        <div key={i} className="flex gap-2">
          <select aria-label={t("Moyen de paiement")} value={tender.method} onChange={(e) => update(i, { method: e.target.value as PaymentMethod })} className={`${selectClass} w-40 shrink-0`}>
            {COUNTER_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(METHOD_LABELS[m])}
              </option>
            ))}
          </select>
          <input aria-label={t("Montant")} inputMode="decimal" value={tender.amountTnd} onChange={(e) => update(i, { amountTnd: e.target.value.replace(",", ".") })} className={`${inputClass} w-28`} />
          {tender.method !== "CASH" && (
            <input aria-label={t("Référence")} placeholder={t("Réf. (TPE, D17…)")} value={tender.reference} onChange={(e) => update(i, { reference: e.target.value })} className={inputClass} />
          )}
          {tenders.length > 1 && (
            <button type="button" aria-label={t("Retirer")} onClick={() => setTenders(tenders.filter((_, j) => j !== i))} className="px-2 text-white/40 hover:text-white">
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {tenders.length < 4 ? (
          <button
            type="button"
            onClick={() => setTenders([...tenders, { method: "CARD", amountTnd: String(Math.max(0, roundTnd(due - total))), reference: "" }])}
            className="text-rose-gold hover:underline"
          >
            + {t("Fractionner le paiement")}
          </button>
        ) : (
          <span />
        )}
        <span className={Math.abs(total - due) < 0.0005 ? "text-emerald-300" : "text-white/55"}>
          {t("Saisi")} : {fmtMoney(total, lang)} / {fmtMoney(due, lang)}
        </span>
      </div>
      {cash && (
        <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          <span>{t("Espèces reçues")}</span>
          <input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(",", "."))} className={`${inputClass} w-24 py-1.5`} aria-label={t("Espèces reçues")} />
          {change !== null && change >= 0 && (
            <span className="ms-auto font-semibold text-champagne">
              {t("À rendre")} : {fmtMoney(change, lang)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const toTenders = (list: Tender[]) =>
  list.map((x) => ({ method: x.method, amountTnd: Number(x.amountTnd) || 0, reference: x.reference || undefined })).filter((x) => x.amountTnd > 0);

function useSubmit(onResult: (r: FinanceResult) => void) {
  const [pending, startTransition] = useTransition();
  return [pending, (fn: () => Promise<FinanceResult>) => startTransition(async () => onResult(await fn()))] as const;
}

function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <button type="submit" disabled={pending} className="btn-shine w-full rounded-2xl py-3 text-sm font-semibold text-plum-950 disabled:opacity-60">
      {pending ? t("Un instant…") : children}
    </button>
  );
}

function BookingRecap({ booking }: { booking: CashDeskBooking }) {
  const { t, lang } = useI18n();
  return (
    <div className="rounded-2xl bg-white/[0.04] p-4 text-sm">
      <p className="text-white">{booking.services}</p>
      <p className="text-xs text-white/50">
        {fmtDay(booking.start, lang)} · {fmtTime(booking.start, lang)} · {booking.staff}
      </p>
      <div className="mt-3 space-y-1 tabular-nums">
        <p className="flex justify-between text-white/70">
          <span>{t("Total")}</span>
          <span>{fmtMoney(booking.totalTnd, lang)}</span>
        </p>
        {booking.paidTnd > 0 && (
          <p className="flex justify-between text-white/70">
            <span>{t("Déjà réglé (acomptes)")}</span>
            <span>− {fmtMoney(booking.paidTnd, lang)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function CheckoutModal({ booking, canDiscount, onClose, onResult }: { booking: CashDeskBooking; canDiscount: boolean; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  const [discount, setDiscount] = useState("");
  const due = roundTnd(booking.dueTnd - (Number(discount) || 0));
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountTnd: String(booking.dueTnd), reference: "" }]);
  const [pending, submit] = useSubmit(onResult);
  return (
    <Modal open onClose={onClose} title={`${t("Encaisser")} · ${booking.customer}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => checkoutAction({ bookingId: booking.id, tenders: toTenders(tenders), discountTnd: Number(discount) || 0 }));
        }}
      >
        <BookingRecap booking={booking} />
        {canDiscount && (
          <div>
            <label className={labelClass} htmlFor="discount">{t("Remise (DT)")}</label>
            <input
              id="discount"
              inputMode="decimal"
              value={discount}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                setDiscount(v);
                setTenders([{ ...tenders[0], amountTnd: String(Math.max(0, roundTnd(booking.dueTnd - (Number(v) || 0)))) }, ...tenders.slice(1)]);
              }}
              placeholder="0"
              className={inputClass}
            />
          </div>
        )}
        <div>
          <p className={labelClass}>
            {t("Reste à payer")} : <span className="text-white">{fmtMoney(due, lang)}</span>
          </p>
          <TenderEditor tenders={tenders} setTenders={setTenders} due={due} />
        </div>
        <p className="text-xs text-white/45">{t("Si le solde est réglé, la facture numérotée est émise automatiquement.")}</p>
        <Submit pending={pending}>{t("Valider l'encaissement")}</Submit>
      </form>
    </Modal>
  );
}

function DepositModal({ booking, onClose, onResult }: { booking: CashDeskBooking; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t } = useI18n();
  const suggested = Math.min(booking.dueTnd, Math.ceil(booking.totalTnd * 0.3));
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountTnd: String(suggested), reference: "" }]);
  const [pending, submit] = useSubmit(onResult);
  return (
    <Modal open onClose={onClose} title={`${t("Acompte")} · ${booking.customer}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const [tender] = toTenders(tenders);
          if (!tender) return;
          submit(() => recordDepositAction({ bookingId: booking.id, tender }));
        }}
      >
        <BookingRecap booking={booking} />
        <div>
          <p className={labelClass}>{t("Montant de l'acompte")}</p>
          <TenderEditor tenders={tenders.slice(0, 1)} setTenders={(list) => setTenders(list.slice(0, 1))} due={Number(tenders[0].amountTnd) || 0} />
        </div>
        <Submit pending={pending}>{t("Encaisser l'acompte")}</Submit>
      </form>
    </Modal>
  );
}

function LinkModal({ booking, onClose, onResult }: { booking: CashDeskBooking; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t } = useI18n();
  const isFuture = new Date(booking.start) > new Date();
  const [kind, setKind] = useState<"DEPOSIT" | "PAYMENT">(isFuture ? "DEPOSIT" : "PAYMENT");
  const [amountTnd, setAmount] = useState(String(isFuture ? Math.min(booking.dueTnd, Math.ceil(booking.totalTnd * 0.3)) : booking.dueTnd));
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, submit] = useSubmit((r) => {
    if (r.link) setResult(r);
    onResult(r);
  });
  return (
    <Modal open onClose={onClose} title={`${t("Paiement en ligne")} · ${booking.customer}`}>
      {result?.link ? (
        <div className="space-y-4">
          <p className="text-sm text-white/70">{t("Envoyez ce lien au client : il pourra payer par carte depuis son téléphone. Le lien est valable 48 h.")}</p>
          <div className="break-all rounded-2xl bg-white/[0.05] p-3 text-xs text-white/80" dir="ltr">{result.link}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(result.link!).then(() => setCopied(true))}
              className="rounded-2xl border border-white/10 py-3 text-sm text-white/80 transition hover:border-rose-gold/40"
            >
              {copied ? `✓ ${t("Copié")}` : t("Copier le lien")}
            </button>
            {result.whatsapp && (
              <a href={result.whatsapp} target="_blank" rel="noreferrer" className="rounded-2xl bg-[#25d366]/15 py-3 text-center text-sm font-medium text-[#7ef0a8] transition hover:bg-[#25d366]/25">
                {t("Envoyer par WhatsApp")}
              </a>
            )}
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => createPaymentLinkAction({ bookingId: booking.id, amountTnd: Number(amountTnd) || 0, kind }));
          }}
        >
          <BookingRecap booking={booking} />
          <div className="grid grid-cols-2 gap-2">
            {(["DEPOSIT", "PAYMENT"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setAmount(String(k === "PAYMENT" ? booking.dueTnd : Math.min(booking.dueTnd, Math.ceil(booking.totalTnd * 0.3))));
                }}
                className={`rounded-2xl border py-2.5 text-sm transition ${kind === k ? "border-rose-gold/60 bg-rose-gold/10 text-white" : "border-white/10 text-white/60"}`}
              >
                {t(k === "DEPOSIT" ? "Acompte" : "Solde complet")}
              </button>
            ))}
          </div>
          <div>
            <label className={labelClass} htmlFor="link-amount">{t("Montant (DT)")}</label>
            <input id="link-amount" inputMode="decimal" value={amountTnd} onChange={(e) => setAmount(e.target.value.replace(",", "."))} className={inputClass} />
          </div>
          <Submit pending={pending}>{t("Créer le lien de paiement")}</Submit>
        </form>
      )}
    </Modal>
  );
}

function RefundModal({ payment, onClose, onResult }: { payment: CashPayment; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  const [amountTnd, setAmount] = useState(String(payment.refundable));
  const [reason, setReason] = useState("");
  const [pending, submit] = useSubmit(onResult);
  return (
    <Modal open onClose={onClose} title={t("Rembourser un paiement")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => refundAction({ paymentId: payment.id, amountTnd: Number(amountTnd) || 0, reason }));
        }}
      >
        <p className="rounded-2xl bg-white/[0.04] p-4 text-sm text-white/70">
          {payment.label} · {payment.receiptNumber} · {t(METHOD_LABELS[payment.method])}
          <br />
          {t("Remboursable")} : <span className="text-white">{fmtMoney(payment.refundable, lang)}</span>
        </p>
        <div>
          <label className={labelClass} htmlFor="refund-amount">{t("Montant (DT)")}</label>
          <input id="refund-amount" inputMode="decimal" value={amountTnd} onChange={(e) => setAmount(e.target.value.replace(",", "."))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="refund-reason">{t("Motif")}</label>
          <input id="refund-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Ex. prestation annulée, geste commercial…")} className={inputClass} />
        </div>
        <Submit pending={pending}>{t("Confirmer le remboursement")}</Submit>
      </form>
    </Modal>
  );
}

type Line = { label: string; quantity: string; unitPriceTnd: string; serviceId: string | null };

function SaleModal({ centerId, services, onClose, onResult }: { centerId: string; services: Service[]; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [discount, setDiscount] = useState("");
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountTnd: "0", reference: "" }]);
  const [pending, submit] = useSubmit(onResult);
  const subtotal = sumTnd(lines.map((l) => (Number(l.quantity) || 0) * (Number(l.unitPriceTnd) || 0)));
  const total = Math.max(0, roundTnd(subtotal - (Number(discount) || 0)));
  const sync = (nextLines: Line[], nextDiscount = discount) => {
    const sub = sumTnd(nextLines.map((l) => (Number(l.quantity) || 0) * (Number(l.unitPriceTnd) || 0)));
    const tot = Math.max(0, roundTnd(sub - (Number(nextDiscount) || 0)));
    if (tenders.length === 1) setTenders([{ ...tenders[0], amountTnd: String(tot) }]);
  };
  const setLinesAndSync = (next: Line[]) => {
    setLines(next);
    sync(next);
  };
  const categories = [...new Set(services.map((s) => s.category))];

  return (
    <Modal open onClose={onClose} title={t("Vente directe")} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() =>
            directSaleAction({
              centerId,
              customerName: customerName || undefined,
              lines: lines.map((l) => ({ label: l.label, quantity: Number(l.quantity) || 1, unitPriceTnd: Number(l.unitPriceTnd) || 0, serviceId: l.serviceId })),
              tenders: toTenders(tenders),
              discountTnd: Number(discount) || 0,
            }),
          );
        }}
      >
        <div>
          <label className={labelClass} htmlFor="sale-customer">{t("Client (facultatif)")}</label>
          <input id="sale-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t("Client de passage")} className={inputClass} />
        </div>
        <div>
          <p className={labelClass}>{t("Prestations et produits")}</p>
          <select
            aria-label={t("Ajouter une prestation du catalogue")}
            value=""
            onChange={(e) => {
              const s = services.find((x) => x.id === e.target.value);
              if (s) setLinesAndSync([...lines, { label: s.name, quantity: "1", unitPriceTnd: String(s.priceTnd), serviceId: s.id }]);
            }}
            className={`${selectClass} w-full`}
          >
            <option value="">{t("+ Ajouter une prestation du catalogue…")}</option>
            {categories.map((c) => (
              <optgroup key={c} label={c}>
                {services.filter((s) => s.category === c).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {fmtMoney(s.priceTnd, lang)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ul className="mt-2 space-y-2">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <input aria-label={t("Libellé")} value={l.label} onChange={(e) => setLinesAndSync(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={inputClass} />
                <input aria-label={t("Quantité")} inputMode="numeric" value={l.quantity} onChange={(e) => setLinesAndSync(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={`${inputClass} w-16`} />
                <input aria-label={t("Prix unitaire")} inputMode="decimal" value={l.unitPriceTnd} onChange={(e) => setLinesAndSync(lines.map((x, j) => (j === i ? { ...x, unitPriceTnd: e.target.value.replace(",", ".") } : x)))} className={`${inputClass} w-24`} />
                <button type="button" aria-label={t("Retirer")} onClick={() => setLinesAndSync(lines.filter((_, j) => j !== i))} className="px-2 text-white/40 hover:text-white">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setLines([...lines, { label: "", quantity: "1", unitPriceTnd: "", serviceId: null }])} className="mt-2 text-xs text-rose-gold hover:underline">
            + {t("Ligne libre (produit, supplément…)")}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="sale-discount">{t("Remise (DT)")}</label>
            <input
              id="sale-discount"
              inputMode="decimal"
              value={discount}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                setDiscount(v);
                sync(lines, v);
              }}
              placeholder="0"
              className={inputClass}
            />
          </div>
          <div className="rounded-2xl bg-white/[0.04] px-4 py-2 text-sm">
            <p className="text-xs text-white/50">{t("Total TTC")}</p>
            <p className="text-xl font-semibold text-white">{fmtMoney(total, lang)}</p>
          </div>
        </div>
        <div>
          <p className={labelClass}>{t("Règlement")}</p>
          <TenderEditor tenders={tenders} setTenders={setTenders} due={total} />
        </div>
        <Submit pending={pending}>{t("Encaisser et facturer")}</Submit>
      </form>
    </Modal>
  );
}
