"use client";

import { useState, useTransition } from "react";
import { payOnlineAction } from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert } from "@/components/ui/form";
import { LockIcon } from "@/components/ui/icons";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { PaymentKind, PaymentStatus } from "@/lib/enums";

type Link = {
  salon: string;
  center: string;
  firstName: string;
  services: string;
  start: string;
  kind: PaymentKind;
  amountTnd: number;
  status: PaymentStatus | "EXPIRED";
  bookingCancelled: boolean;
  receiptNumber: string | null;
};

// Formulaire de carte de la passerelle (sandbox). Les données de carte sont transmises une seule fois
// à la passerelle et ne sont jamais enregistrées.
export function OnlineCheckout({ token, link }: { token: string; link: Link }) {
  const { t, lang } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(link.status === "PAID");
  const [card, setCard] = useState({ holder: "", cardNumber: "", expiry: "", cvc: "" });

  const formatCard = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
  const formatExpiry = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  const summary = (
    <div className="rounded-2xl bg-white/[0.05] p-5">
      <p className="text-xs uppercase tracking-wider text-white/45">{t(link.kind === "DEPOSIT" ? "Acompte de réservation" : "Règlement de votre rendez-vous")}</p>
      <p className="mt-2 text-4xl font-semibold text-white">{fmtMoney(link.amountTnd, lang)}</p>
      <p className="mt-3 text-sm text-white/75">{link.services}</p>
      <p className="text-xs text-white/50">
        {link.center} · {fmtDay(link.start, lang)} · {fmtTime(link.start, lang)}
      </p>
    </div>
  );

  if (paid) {
    return (
      <div className="glass mt-6 space-y-5 rounded-[2rem] p-7 text-center animate-fade-up">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</span>
        <h1 className="font-display text-3xl text-white">{t("Paiement confirmé")}</h1>
        <p className="text-white/65">
          {t("Merci")} {link.firstName} ! {t("Votre paiement a bien été reçu par")} {link.salon}.
        </p>
        {summary}
        <a href={`/paiement/${token}/recu`} target="_blank" rel="noreferrer" className="btn-shine inline-block rounded-2xl px-6 py-3 text-sm font-semibold text-plum-950">
          {t("Télécharger le reçu (PDF)")}
        </a>
      </div>
    );
  }

  if (link.status !== "PENDING" || link.bookingCancelled) {
    return (
      <div className="glass mt-6 space-y-4 rounded-[2rem] p-7 text-center">
        <h1 className="font-display text-2xl text-white">{t("Ce lien n'est plus valable")}</h1>
        <p className="text-sm text-white/60">
          {t(link.bookingCancelled ? "Le rendez-vous a été annulé." : "Il a expiré ou a été remplacé. Demandez un nouveau lien au salon.")}
        </p>
      </div>
    );
  }

  return (
    <div className="glass mt-6 rounded-[2rem] p-7 animate-fade-up">
      <h1 className="font-display text-3xl text-white">
        {t("Bonjour")} {link.firstName}
      </h1>
      <p className="mt-1 text-sm text-white/60">
        {t("Réglez en toute sécurité par carte bancaire (CIB, Visa, Mastercard).")}
      </p>
      <div className="mt-5">{summary}</div>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = await payOnlineAction({ token, ...card });
            if (r.error) setError(r.error);
            else setPaid(true);
          });
        }}
      >
        <div>
          <label className={labelClass} htmlFor="holder">{t("Titulaire de la carte")}</label>
          <input id="holder" autoComplete="cc-name" required value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="card">{t("Numéro de carte")}</label>
          <input id="card" dir="ltr" inputMode="numeric" autoComplete="cc-number" required placeholder="4242 4242 4242 4242" value={card.cardNumber} onChange={(e) => setCard({ ...card, cardNumber: formatCard(e.target.value) })} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="expiry">{t("Expiration")}</label>
            <input id="expiry" dir="ltr" inputMode="numeric" autoComplete="cc-exp" required placeholder="MM/AA" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="cvc">{t("Code (CVC)")}</label>
            <input id="cvc" dir="ltr" inputMode="numeric" autoComplete="cc-csc" required maxLength={4} value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "") })} className={inputClass} />
          </div>
        </div>
        {error && <Alert>{t(error)}</Alert>}
        <button type="submit" disabled={pending} className="btn-shine flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-plum-950 disabled:opacity-60">
          <LockIcon width={16} height={16} />
          {pending ? t("Paiement en cours…") : `${t("Payer")} ${fmtMoney(link.amountTnd, lang)}`}
        </button>
        <p className="text-center text-[11px] text-white/40">
          {t("Passerelle de démonstration : carte de test 4242 4242 4242 4242, toute date future, tout code.")}
        </p>
      </form>
    </div>
  );
}
