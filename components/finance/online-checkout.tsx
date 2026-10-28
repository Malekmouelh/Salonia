"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/online-checkout.tsx — LE FORMULAIRE DE PAIEMENT PAR CARTE (F6.2)
// ═══════════════════════════════════════════════════════════════════════════
// Affiché sur la page publique /paiement/<jeton> (voir app/paiement/[token]/page.tsx).
// Trois « écrans » possibles selon l'état du lien :
//   1. PAYÉ      → « Paiement confirmé » + bouton de téléchargement du reçu ;
//   2. INVALIDE  → « Ce lien n'est plus valable » (expiré, remplacé ou rendez-vous annulé) ;
//   3. À PAYER   → formulaire de carte.
//
// SÉCURITÉ DES DONNÉES DE CARTE : elles sont saisies ici, envoyées UNE fois à la Server Action
// `payOnlineAction`, transmises à la passerelle, puis jetées. Elles ne sont jamais enregistrées en base.
// (En production avec un vrai prestataire, la saisie se ferait sur LEUR page sécurisée, ce qui
// dispense le site de manipuler des numéros de carte : norme PCI-DSS.)
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useTransition } from "react";
import { payOnlineAction } from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert } from "@/components/ui/form";
import { LockIcon } from "@/components/ui/icons";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { PaymentKind, PaymentStatus } from "@/lib/enums";

// Résumé du lien de paiement (fourni par getPaymentLink dans lib/data/finance.ts).
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
  const [pending, startTransition] = useTransition(); // true pendant le traitement du paiement
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null); // essais restants avant verrouillage du lien
  // `paid` démarre à true si le lien a déjà été payé (le client rouvre son lien après coup).
  const [paid, setPaid] = useState(link.status === "PAID");
  const [card, setCard] = useState({ holder: "", cardNumber: "", expiry: "", cvc: "" });

  // Mise en forme pendant la frappe : n'accepte que des chiffres (\D = non-chiffre, supprimé), 19 max,
  // et insère un espace tous les 4 chiffres (« 4242 4242 … »). `(?=\d)` : « suivi d'un chiffre ».
  const formatCard = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
  // Date d'expiration : 4 chiffres max, avec « / » inséré après les 2 premiers (« 1228 » → « 12/28 »).
  const formatExpiry = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  // Encadré récapitulatif (nature du paiement, montant, prestation, lieu et date), affiché dans les écrans 1 et 3.
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

  // ── Écran 1 : paiement confirmé ──
  if (paid) {
    return (
      <div className="glass mt-6 space-y-5 rounded-[2rem] p-7 text-center animate-fade-up">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</span>
        <h1 className="font-display text-3xl text-white">{t("Paiement confirmé")}</h1>
        <p className="text-white/65">
          {t("Merci")} {link.firstName} ! {t("Votre paiement a bien été reçu par")} {link.salon}.
        </p>
        {summary}
        {/* Reçu PDF : route publique /paiement/<jeton>/recu (accessible grâce au jeton, sans connexion). */}
        <a href={`/paiement/${token}/recu`} target="_blank" rel="noreferrer" className="btn-shine inline-block rounded-2xl px-6 py-3 text-sm font-semibold text-plum-950">
          {t("Télécharger le reçu (PDF)")}
        </a>
      </div>
    );
  }

  // ── Écran 2 : lien invalide (expiré, annulé, remplacé par un nouveau lien, ou rendez-vous annulé) ──
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

  // ── Écran 3 : le formulaire de carte ──
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
          e.preventDefault(); // empêche le rechargement de la page
          setError(null);
          // On envoie jeton + champs de la carte à la Server Action. `...card` insère holder, cardNumber, expiry, cvc.
          startTransition(async () => {
            const r = await payOnlineAction({ token, ...card });
            if (r.error) {
              setError(r.error);
              setAttemptsLeft(r.attemptsLeft ?? null);
            }
            else setPaid(true); // succès : on bascule sur l'écran 1
          });
        }}
      >
        {/* Les attributs `autoComplete="cc-…"` permettent au navigateur de proposer la carte enregistrée.
            `dir="ltr"` force l'écriture de gauche à droite pour les numéros, même en interface arabe.
            `inputMode="numeric"` ouvre le clavier numérique sur téléphone. */}
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
        {/* Message d'erreur de la passerelle (« Numéro de carte invalide », « Paiement refusé par la banque »…). */}
        {error && (
          <Alert>
            {t(error)}
            {attemptsLeft !== null && ` · ${attemptsLeft} ${t("essai(s) restant(s)")}`}
          </Alert>
        )}
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
