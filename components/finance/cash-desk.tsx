"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/cash-desk.tsx — L'INTERFACE DE LA CAISSE (F6.1, F6.2)
// ═══════════════════════════════════════════════════════════════════════════
// C'est le composant le plus riche du module. Il regroupe :
//   • CashDesk       : la page de caisse (listes de rendez-vous + journal de caisse), qui ouvre…
//   • …des FENÊTRES MODALES (popups), une par action :
//       CheckoutModal  → encaisser un rendez-vous (paiement fractionné, remise, rendu de monnaie)
//       DepositModal   → prendre un acompte
//       LinkModal      → créer un lien de paiement en ligne (copier / envoyer par WhatsApp)
//       RefundModal    → rembourser un paiement
//       SaleModal      → vente directe (sans rendez-vous), avec lignes libres ou du catalogue
//   • des petits composants : BookingSection, BookingActions, TenderEditor, BookingRecap…
//
// PRINCIPE GÉNÉRAL : ce composant ne calcule ni n'enregistre rien d'important. Il collecte la saisie,
// l'envoie aux Server Actions (app/actions/finance.ts) et affiche leur réponse. Les montants affichés
// ici (reste à payer, total) sont des AIDES de confort : le serveur recalcule tout et fait foi.
//
// RAPPEL SUR L'ÉTAT : chaque `useState` est une « mémoire » du composant. Quand on la modifie avec son
// `setXxx`, React ré-affiche automatiquement le composant avec la nouvelle valeur.
// ═══════════════════════════════════════════════════════════════════════════

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  checkoutAction,
  closeCashAction,
  createPaymentLinkAction,
  directSaleAction,
  invoiceBookingAction,
  recordDepositAction,
  refundAction,
  reopenCashAction,
  type FinanceResult,
} from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { STATUS_META } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal, Toast } from "@/components/ui/modal";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { BookingStatus, PaymentMethod } from "@/lib/enums";
import type { CashDeskBooking, CashPayment } from "@/lib/data/finance";
import type { ClosingRow, ExpectedTotal } from "@/lib/finance/closing";
import { KIND_LABELS, METHOD_LABELS } from "@/lib/finance/labels";
import { cashVariance, roundTnd, sumTnd } from "@/lib/finance/money";
import { selectClass } from "./finance-ui";

// F6.1 — Caisse : encaissement des rendez-vous (paiement fractionné, remise), acomptes,
// liens de paiement en ligne (F6.2), vente directe, journal de caisse et remboursements.

// Un service du catalogue (module 2), proposé dans la vente directe.
type Service = { id: string; name: string; category: string; priceTnd: number };
// Un règlement en cours de saisie. Le montant est du TEXTE (un champ de formulaire contient du texte) ;
// il est converti en nombre au moment de l'envoi (voir `toTenders`).
type Tender = { method: PaymentMethod; amountTnd: string; reference: string };

// Moyens proposés au comptoir : le paiement « en ligne » n'y figure pas (il passe par un lien de paiement).
const COUNTER_METHODS: PaymentMethod[] = ["CASH", "CARD", "MOBILE"];

// État de la clôture de caisse du jour (calculé par getClosingState dans lib/finance/closing.ts) :
// soit la clôture déjà faite, soit les totaux attendus prêts à être comparés au comptage.
export type ClosingState = { closing: ClosingRow | null; expected: ExpectedTotal[]; expectedCashTnd: number };

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
  depositPercent,
  onlineEnabled,
  closingState,
  isOwner,
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
  depositPercent: number; // % d'acompte proposé par défaut (paramètres financiers)
  onlineEnabled: boolean; // le paiement en ligne est-il activé ? (sinon les boutons « Lien de paiement » disparaissent)
  closingState: ClosingState | null; // null pour le staff : il ne clôture pas la caisse
  isOwner: boolean; // seul le propriétaire peut rouvrir une caisse clôturée
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // LA FENÊTRE OUVERTE. Une seule variable d'état décrit quelle fenêtre est ouverte et pour quel élément :
  //   null → aucune ; {type:"checkout"|"deposit"|"link", booking} → fenêtre liée à un rendez-vous ;
  //   {type:"refund", payment} → remboursement d'un paiement ; {type:"sale"} → vente directe.
  // (« Type union discriminée » TypeScript : le champ `type` indique quelles autres propriétés existent.)
  const [modal, setModal] = useState<
    | { type: "checkout" | "deposit" | "link"; booking: CashDeskBooking }
    | { type: "refund"; payment: CashPayment }
    | { type: "sale" }
    | { type: "close" }
    | null
  >(null);
  // Notification (succès/erreur) affichée en bas de l'écran, avec d'éventuels liens (facture, reçu).
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string; links?: { href: string; label: string }[] } | null>(null);

  // Navigation : change le centre ou le jour en modifiant l'adresse (la page serveur relit et recharge).
  const go = (params: Record<string, string>) => {
    const sp = new URLSearchParams({ center: centerId, day, ...params });
    startTransition(() => router.replace(`/dashboard/finances/caisse?${sp.toString()}`, { scroll: false }));
  };

  // Appelée par TOUTES les fenêtres avec la réponse de la Server Action.
  const onResult = (r: FinanceResult) => {
    if (r.error) {
      setToast({ tone: "error", text: r.error });
      return; // en cas d'erreur, la fenêtre reste ouverte pour que l'utilisateur corrige
    }
    // Liens « Voir la facture » / « Voir le reçu » ajoutés à la notification selon ce qui a été créé.
    const links = [
      ...(r.closingId ? [{ href: `/api/finance/closings/${r.closingId}`, label: "Voir le rapport" }] : []),
      ...(r.invoiceId ? [{ href: `/api/finance/invoices/${r.invoiceId}`, label: "Voir la facture" }] : []),
      ...(r.receiptId ? [{ href: `/api/finance/receipts/${r.receiptId}`, label: "Voir le reçu" }] : []),
    ];
    setToast({ tone: "success", text: r.message ?? "OK", links });
    // On ferme la fenêtre, SAUF pour la création d'un lien de paiement (la fenêtre doit afficher le lien).
    if (!r.link) setModal(null);
    // Recharge les données de la page serveur (nouveaux soldes, nouvelles factures…).
    router.refresh();
  };

  // Émission d'une facture pour un rendez-vous déjà soldé (bouton « Émettre la facture »).
  const issueInvoice = (b: CashDeskBooking) =>
    startTransition(async () => onResult(await invoiceBookingAction(b.id)));

  return (
    <div className="mt-5 space-y-5">
      {/* Barre du haut : choix du centre (si plusieurs), choix du jour, bouton « Vente directe » (gestion seulement). */}
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
        {/* `e.target.value && go(...)` : n'agit que si une date valide est choisie (le champ peut être vidé). */}
        <input type="date" aria-label={t("Jour")} value={day} onChange={(e) => e.target.value && go({ day: e.target.value })} className={`${selectClass} [color-scheme:dark]`} />
        {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
        {canManage && (
          <button type="button" onClick={() => setModal({ type: "sale" })} className="btn-shine ms-auto rounded-xl px-4 py-2 text-sm font-semibold text-plum-950">
            + {t("Vente directe")}
          </button>
        )}
      </div>

      {/* Clôture de caisse : seulement pour la gestion (le staff n'a pas `closingState`). */}
      {closingState && (
        <ClosingPanel
          state={closingState}
          day={day}
          isOwner={isOwner}
          onClose={() => setModal({ type: "close" })}
          onReopen={(id) => {
            if (confirm(t("Rouvrir cette caisse ? Les mouvements du jour redeviennent possibles."))) startTransition(async () => onResult(await reopenCashAction(id)));
          }}
        />
      )}

      {/* Mise en page en grille : 3/5 pour les listes de rendez-vous, 2/5 pour le journal de caisse. */}
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          {/* Section 1 : rendez-vous du jour (boutons d'encaissement). */}
          <BookingSection title="Rendez-vous du jour" empty="Aucun rendez-vous ce jour-là." rows={today}>
            {(b) => <BookingActions b={b} onOpen={(type) => setModal({ type, booking: b })} onInvoice={() => issueInvoice(b)} onlineEnabled={onlineEnabled} />}
          </BookingSection>
          {/* Section 2 : impayés des 14 derniers jours (affichée seulement s'il y en a). */}
          {unpaid.length > 0 && (
            <BookingSection title="Impayés des 14 derniers jours" empty="" rows={unpaid} showDay>
              {(b) => <BookingActions b={b} onOpen={(type) => setModal({ type, booking: b })} onInvoice={() => issueInvoice(b)} onlineEnabled={onlineEnabled} />}
            </BookingSection>
          )}
          {/* Section 3 : rendez-vous à venir (acompte ou lien de paiement). */}
          <BookingSection title="Acomptes : rendez-vous à venir" empty="Aucun rendez-vous à venir sur 7 jours." rows={upcoming} showDay>
            {(b) => (
              <div className="flex flex-wrap gap-2">
                <SmallButton onClick={() => setModal({ type: "deposit", booking: b })}>{t("Acompte")}</SmallButton>
                {onlineEnabled && <SmallButton onClick={() => setModal({ type: "link", booking: b })}>{b.pendingLink ? t("Nouveau lien") : t("Lien de paiement")}</SmallButton>}
              </div>
            )}
          </BookingSection>
        </div>

        {/* Journal de caisse du jour : total, détail par moyen de paiement, liste des paiements. */}
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
                  {/* Un remboursement est affiché en rouge avec un signe « − ». */}
                  <span className={`shrink-0 tabular-nums ${p.kind === "REFUND" ? "text-red-300" : "text-white"}`}>
                    {p.kind === "REFUND" ? "− " : ""}
                    {fmtMoney(p.amountTnd, lang)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                  {/* Numéro de reçu cliquable : ouvre le reçu PDF. */}
                  {p.receiptNumber && (
                    <a href={`/api/finance/receipts/${p.id}`} target="_blank" rel="noreferrer" className="text-rose-gold underline-offset-4 hover:underline">
                      {p.receiptNumber}
                    </a>
                  )}
                  {/* « Rembourser » : gestion seulement, et s'il reste quelque chose à rembourser. */}
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

      {/* LES FENÊTRES : une seule est affichée à la fois, selon `modal.type`. `modal?.type` : le « ? »
          évite une erreur quand `modal` est null (« chaînage optionnel »). */}
      {modal?.type === "checkout" && <CheckoutModal booking={modal.booking} canDiscount={canManage} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "close" && closingState && <CloseModal centerId={centerId} day={day} state={closingState} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "deposit" && <DepositModal booking={modal.booking} depositPercent={depositPercent} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "link" && <LinkModal booking={modal.booking} depositPercent={depositPercent} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "refund" && <RefundModal payment={modal.payment} onClose={() => setModal(null)} onResult={onResult} />}
      {modal?.type === "sale" && <SaleModal centerId={centerId} services={services} onClose={() => setModal(null)} onResult={onResult} />}
      {/* Notification éphémère, avec ses liens « Voir la facture / le reçu ». */}
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

// Petit bouton réutilisable : « primary » = bouton principal doré, sinon bouton à contour.
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

// Boutons affichés à droite d'un rendez-vous, selon sa situation financière :
//   facture émise → lien vers la facture ; soldé sans facture → « Émettre la facture » ; sinon → Encaisser / Acompte / Lien.
function BookingActions({ b, onOpen, onInvoice, onlineEnabled }: { b: CashDeskBooking; onOpen: (type: "checkout" | "deposit" | "link") => void; onInvoice: () => void; onlineEnabled: boolean }) {
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
      {/* L'acompte n'a de sens que pour un rendez-vous À VENIR. */}
      {new Date(b.start) > new Date() && <SmallButton onClick={() => onOpen("deposit")}>{t("Acompte")}</SmallButton>}
      {onlineEnabled && <SmallButton onClick={() => onOpen("link")}>{t("Lien de paiement")}</SmallButton>}
    </div>
  );
}

// Une section « liste de rendez-vous » (titre + lignes). `children` est une FONCTION qui, pour chaque
// rendez-vous, renvoie les boutons d'action à afficher (technique des « render props » : la section gère
// la mise en page, l'appelant décide du contenu à droite).
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
            // Pastille de statut du rendez-vous (confirmé, terminé…), définie dans le module 3.
            const status = STATUS_META[b.status as BookingStatus];
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="w-14 shrink-0 text-center">
                  <p className="text-sm font-semibold text-white">{fmtTime(b.start, lang)}</p>
                  {/* Pour les sections qui couvrent plusieurs jours, on précise la date. */}
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
                    {/* Situation de paiement : « ✓ Payé » / « Reste X » / rien (aucun paiement). */}
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

// ─────────────────────── Saisie des règlements ───────────────────────
// Saisie des moyens de paiement (paiement fractionné : jusqu'à 4 lignes).
// Reçoit la liste des règlements (`tenders`), sa fonction de modification (`setTenders`) et le montant
// à régler (`due`). Chaque ligne = un moyen + un montant (+ une référence pour carte/mobile).
function TenderEditor({ tenders, setTenders, due }: { tenders: Tender[]; setTenders: (t: Tender[]) => void; due: number }) {
  const { t, lang } = useI18n();
  const [received, setReceived] = useState(""); // espèces remises par le client (pour calculer la monnaie)
  // Modifie la ligne n° i en fusionnant `patch` (les autres lignes sont inchangées).
  const update = (i: number, patch: Partial<Tender>) => setTenders(tenders.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const cash = tenders.find((x) => x.method === "CASH");
  // Monnaie à rendre = espèces reçues − part payée en espèces.
  const change = cash && received ? roundTnd(Number(received) - Number(cash.amountTnd || 0)) : null;
  // Total saisi (pour le comparer au montant dû).
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
          {/* `.replace(",", ".")` : accepte la virgule décimale française. */}
          <input aria-label={t("Montant")} inputMode="decimal" value={tender.amountTnd} onChange={(e) => update(i, { amountTnd: e.target.value.replace(",", ".") })} className={`${inputClass} w-28`} />
          {/* Une référence (n° de ticket TPE, D17…) n'a pas de sens pour les espèces. */}
          {tender.method !== "CASH" && (
            <input aria-label={t("Référence")} placeholder={t("Réf. (TPE, D17…)")} value={tender.reference} onChange={(e) => update(i, { reference: e.target.value })} className={inputClass} />
          )}
          {/* Bouton « ✕ » pour retirer une ligne (seulement s'il y en a plusieurs). */}
          {tenders.length > 1 && (
            <button type="button" aria-label={t("Retirer")} onClick={() => setTenders(tenders.filter((_, j) => j !== i))} className="px-2 text-white/40 hover:text-white">
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* « Fractionner » : ajoute une ligne (par carte) préremplie avec ce qu'il reste à répartir. */}
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
        {/* Compteur « Saisi : X / Y » : devient vert quand le total saisi égale le montant dû. */}
        <span className={Math.abs(total - due) < 0.0005 ? "text-emerald-300" : "text-white/55"}>
          {t("Saisi")} : {fmtMoney(total, lang)} / {fmtMoney(due, lang)}
        </span>
      </div>
      {/* Calculateur de monnaie à rendre (si un règlement en espèces existe). */}
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

// Convertit les règlements saisis (montants en texte) en règlements prêts à envoyer au serveur
// (montants en nombres), en écartant les lignes à 0 DT et les références vides.
const toTenders = (list: Tender[]) =>
  list.map((x) => ({ method: x.method, amountTnd: Number(x.amountTnd) || 0, reference: x.reference || undefined })).filter((x) => x.amountTnd > 0);

// « Hook personnalisé » : factorise le code commun à toutes les fenêtres. Renvoie [pending, submit] :
// `submit(fn)` exécute l'action serveur `fn` en arrière-plan et transmet sa réponse à `onResult`.
// (`as const` fige le résultat en tuple pour que TypeScript connaisse le type de chaque élément.)
function useSubmit(onResult: (r: FinanceResult) => void) {
  const [pending, startTransition] = useTransition();
  return [pending, (fn: () => Promise<FinanceResult>) => startTransition(async () => onResult(await fn()))] as const;
}

// Bouton de validation commun aux formulaires (affiche « Un instant… » pendant le traitement).
function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <button type="submit" disabled={pending} className="btn-shine w-full rounded-2xl py-3 text-sm font-semibold text-plum-950 disabled:opacity-60">
      {pending ? t("Un instant…") : children}
    </button>
  );
}

// Récapitulatif d'un rendez-vous en tête de fenêtre : prestations, date, praticien, total et déjà payé.
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

// ─────────────────────── Fenêtre : ENCAISSER un rendez-vous ───────────────────────
function CheckoutModal({ booking, canDiscount, onClose, onResult }: { booking: CashDeskBooking; canDiscount: boolean; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  const [discount, setDiscount] = useState(""); // remise saisie (texte)
  // Reste à payer = dû − remise (le serveur refait ce calcul : ici c'est pour l'affichage).
  const due = roundTnd(booking.dueTnd - (Number(discount) || 0));
  // Règlement initial : tout le solde en espèces (cas le plus fréquent) ; l'utilisateur peut le modifier.
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountTnd: String(booking.dueTnd), reference: "" }]);
  const [pending, submit] = useSubmit(onResult);
  return (
    <Modal open onClose={onClose} title={`${t("Encaisser")} · ${booking.customer}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Envoi à la Server Action checkoutAction : règlements convertis en nombres + remise.
          submit(() => checkoutAction({ bookingId: booking.id, tenders: toTenders(tenders), discountTnd: Number(discount) || 0 }));
        }}
      >
        <BookingRecap booking={booking} />
        {/* Champ « Remise » : réservé à la gestion (`canDiscount`). Quand on le modifie, on met aussi à jour
            le montant de la 1re ligne de règlement pour qu'il corresponde au nouveau reste à payer. */}
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

// ─────────────────────── Fenêtre : prendre un ACOMPTE ───────────────────────
function DepositModal({ booking, depositPercent, onClose, onResult }: { booking: CashDeskBooking; depositPercent: number; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t } = useI18n();
  // Acompte suggéré : le pourcentage configuré (30 % par défaut) du total (arrondi au dinar supérieur), sans dépasser le reste à payer.
  const suggested = Math.min(booking.dueTnd, Math.ceil((booking.totalTnd * depositPercent) / 100));
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountTnd: String(suggested), reference: "" }]);
  const [pending, submit] = useSubmit(onResult);
  return (
    <Modal open onClose={onClose} title={`${t("Acompte")} · ${booking.customer}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Un acompte = UN seul règlement : on prend le premier (`const [tender] = …`).
          const [tender] = toTenders(tenders);
          if (!tender) return; // montant nul : rien à envoyer
          submit(() => recordDepositAction({ bookingId: booking.id, tender }));
        }}
      >
        <BookingRecap booking={booking} />
        <div>
          <p className={labelClass}>{t("Montant de l'acompte")}</p>
          {/* On limite l'éditeur à une seule ligne (pas de paiement fractionné pour un acompte). */}
          <TenderEditor tenders={tenders.slice(0, 1)} setTenders={(list) => setTenders(list.slice(0, 1))} due={Number(tenders[0].amountTnd) || 0} />
        </div>
        <Submit pending={pending}>{t("Encaisser l'acompte")}</Submit>
      </form>
    </Modal>
  );
}

// ─────────────────────── Fenêtre : LIEN DE PAIEMENT EN LIGNE ───────────────────────
// Deux étapes dans la même fenêtre : (1) choisir acompte/solde et le montant, (2) afficher le lien créé.
function LinkModal({ booking, depositPercent, onClose, onResult }: { booking: CashDeskBooking; depositPercent: number; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t } = useI18n();
  const isFuture = new Date(booking.start) > new Date();
  // Par défaut : acompte pour un rendez-vous à venir, solde complet pour un rendez-vous passé.
  const [kind, setKind] = useState<"DEPOSIT" | "PAYMENT">(isFuture ? "DEPOSIT" : "PAYMENT");
  const [amountTnd, setAmount] = useState(String(isFuture ? Math.min(booking.dueTnd, Math.ceil((booking.totalTnd * depositPercent) / 100)) : booking.dueTnd));
  const [result, setResult] = useState<FinanceResult | null>(null); // réponse contenant le lien (étape 2)
  const [copied, setCopied] = useState(false); // le lien a-t-il été copié ?
  const [pending, submit] = useSubmit((r) => {
    if (r.link) setResult(r); // lien créé → on passe à l'étape 2
    onResult(r);
  });
  return (
    <Modal open onClose={onClose} title={`${t("Paiement en ligne")} · ${booking.customer}`}>
      {result?.link ? (
        // ── Étape 2 : le lien est prêt ──
        <div className="space-y-4">
          <p className="text-sm text-white/70">{t("Envoyez ce lien au client : il pourra payer par carte depuis son téléphone. Le lien est valable 48 h.")}</p>
          {/* `break-all` coupe le long lien ; `dir="ltr"` garde l'adresse lisible en interface arabe. */}
          <div className="break-all rounded-2xl bg-white/[0.05] p-3 text-xs text-white/80" dir="ltr">{result.link}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              // `navigator.clipboard` : copie dans le presse-papiers (`?.` = au cas où non disponible).
              onClick={() => navigator.clipboard?.writeText(result.link!).then(() => setCopied(true))}
              className="rounded-2xl border border-white/10 py-3 text-sm text-white/80 transition hover:border-rose-gold/40"
            >
              {copied ? `✓ ${t("Copié")}` : t("Copier le lien")}
            </button>
            {/* Lien WhatsApp prérempli (seulement si le client a un numéro de téléphone). */}
            {result.whatsapp && (
              <a href={result.whatsapp} target="_blank" rel="noreferrer" className="rounded-2xl bg-[#25d366]/15 py-3 text-center text-sm font-medium text-[#7ef0a8] transition hover:bg-[#25d366]/25">
                {t("Envoyer par WhatsApp")}
              </a>
            )}
          </div>
        </div>
      ) : (
        // ── Étape 1 : choix du type et du montant ──
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(() => createPaymentLinkAction({ bookingId: booking.id, amountTnd: Number(amountTnd) || 0, kind }));
          }}
        >
          <BookingRecap booking={booking} />
          {/* Deux boutons « à bascule » : Acompte / Solde complet. Le montant se préremplit selon le choix. */}
          <div className="grid grid-cols-2 gap-2">
            {(["DEPOSIT", "PAYMENT"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setAmount(String(k === "PAYMENT" ? booking.dueTnd : Math.min(booking.dueTnd, Math.ceil((booking.totalTnd * depositPercent) / 100))));
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

// ─────────────────────── Fenêtre : REMBOURSER un paiement ───────────────────────
export function RefundModal({ payment, onClose, onResult }: { payment: CashPayment; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  // Montant proposé par défaut : tout ce qui est encore remboursable.
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
          {/* Le motif est obligatoire (au moins 3 caractères) : il sert de justification et est tracé dans le journal. */}
          <input id="refund-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Ex. prestation annulée, geste commercial…")} className={inputClass} />
        </div>
        <Submit pending={pending}>{t("Confirmer le remboursement")}</Submit>
      </form>
    </Modal>
  );
}

// ─────────────────────── Fenêtre : VENTE DIRECTE ───────────────────────
// Une ligne de la vente (texte pendant la saisie ; converti en nombres à l'envoi).
type Line = { label: string; quantity: string; unitPriceTnd: string; serviceId: string | null };

function SaleModal({ centerId, services, onClose, onResult }: { centerId: string; services: Service[]; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  const [lines, setLines] = useState<Line[]>([]); // lignes de la vente
  const [customerName, setCustomerName] = useState("");
  const [discount, setDiscount] = useState("");
  const [tenders, setTenders] = useState<Tender[]>([{ method: "CASH", amountTnd: "0", reference: "" }]);
  const [pending, submit] = useSubmit(onResult);
  // Sous-total et total affichés (aides de confort ; le serveur recalcule avec computeTotals).
  const subtotal = sumTnd(lines.map((l) => (Number(l.quantity) || 0) * (Number(l.unitPriceTnd) || 0)));
  const total = Math.max(0, roundTnd(subtotal - (Number(discount) || 0)));
  // Synchronisation du règlement : tant qu'il n'y a qu'UNE ligne de règlement, son montant suit
  // automatiquement le total (confort : l'utilisateur n'a pas à le retaper). Si le paiement est déjà
  // fractionné, on n'y touche pas pour ne pas écraser sa répartition.
  const sync = (nextLines: Line[], nextDiscount = discount) => {
    const sub = sumTnd(nextLines.map((l) => (Number(l.quantity) || 0) * (Number(l.unitPriceTnd) || 0)));
    const tot = Math.max(0, roundTnd(sub - (Number(nextDiscount) || 0)));
    if (tenders.length === 1) setTenders([{ ...tenders[0], amountTnd: String(tot) }]);
  };
  // Modifie les lignes ET resynchronise le règlement en une seule opération.
  const setLinesAndSync = (next: Line[]) => {
    setLines(next);
    sync(next);
  };
  // Catégories distinctes du catalogue (pour regrouper la liste déroulante). `new Set` supprime les doublons.
  const categories = [...new Set(services.map((s) => s.category))];

  return (
    <Modal open onClose={onClose} title={t("Vente directe")} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Conversion des saisies (texte) en données typées pour la Server Action directSaleAction.
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
          {/* Liste déroulante du catalogue (module 2) : choisir une prestation ajoute une ligne préremplie.
              `value=""` la remet à « + Ajouter… » après chaque choix (composant « contrôlé »). */}
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
            {/* `<optgroup>` : regroupe les prestations par catégorie (Coiffure, Onglerie…). */}
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
          {/* Les lignes ajoutées : libellé, quantité, prix unitaire, bouton de retrait. */}
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
          {/* Ligne LIBRE : pour vendre un produit ou un supplément absent du catalogue. */}
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
                sync(lines, v); // on passe la NOUVELLE valeur : `discount` n'est pas encore mis à jour à ce stade
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

// ─────────────────────── CLÔTURE DE CAISSE ───────────────────────
// Bandeau affiché en haut de la page Caisse. Deux états :
//   • caisse clôturée : résumé (compté, écart), lien vers le rapport PDF, bouton « Rouvrir » (propriétaire) ;
//   • caisse ouverte  : espèces attendues + bouton « Clôturer la caisse ».
function ClosingPanel({ state, day, isOwner, onClose, onReopen }: { state: ClosingState; day: string; isOwner: boolean; onClose: () => void; onReopen: (id: string) => void }) {
  const { t, lang } = useI18n();
  const c = state.closing;
  if (c) {
    const ok = c.varianceTnd === 0;
    return (
      <section className={`rounded-[2rem] border p-5 ${ok ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-amber-400/30 bg-amber-400/[0.07]"}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="font-display text-xl text-white">🔒 {t("Caisse clôturée")}</p>
          <p className="text-sm text-white/70">
            {t("Espèces comptées")} : <span className="tabular-nums text-white">{fmtMoney(c.countedCashTnd, lang)}</span> · {t("attendues")} :{" "}
            <span className="tabular-nums text-white">{fmtMoney(c.expectedCashTnd, lang)}</span>
          </p>
          {/* Écart : couleur ET symbole (▲/▼/✓) pour ne pas dépendre que de la couleur. */}
          <p className={`text-sm font-semibold tabular-nums ${ok ? "text-emerald-300" : "text-amber-200"}`}>
            {ok ? `✓ ${t("Aucun écart")}` : `${c.varianceTnd > 0 ? "▲ +" : "▼ "}${fmtMoney(c.varianceTnd, lang)} ${t("d'écart")}`}
          </p>
          <span className="ms-auto flex flex-wrap items-center gap-3 text-xs">
            <span className="text-white/45">
              {t("par")} {c.closedBy} · {fmtTime(c.closedAt, lang)}
            </span>
            <a href={`/api/finance/closings/${c.id}`} target="_blank" rel="noreferrer" className="text-rose-gold underline-offset-4 hover:underline">
              {t("Rapport PDF")}
            </a>
            {isOwner && (
              <button type="button" onClick={() => onReopen(c.id)} className="text-white/55 hover:text-white">
                {t("Rouvrir")}
              </button>
            )}
          </span>
        </div>
        {c.note && <p className="mt-2 text-xs text-white/50">{c.note}</p>}
      </section>
    );
  }
  return (
    <section className="glass flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[2rem] p-5">
      <p className="font-display text-xl text-white">{t("Clôture de caisse")}</p>
      <p className="text-sm text-white/60">
        {t("Espèces attendues dans le tiroir")} : <span className="tabular-nums text-white">{fmtMoney(state.expectedCashTnd, lang)}</span>
      </p>
      <button type="button" onClick={onClose} className="btn-shine ms-auto rounded-xl px-4 py-2 text-sm font-semibold text-plum-950" aria-label={`${t("Clôturer la caisse")} ${fmtDay(day, lang)}`}>
        {t("Clôturer la caisse")}
      </button>
    </section>
  );
}

// Fenêtre de clôture : le gérant COMPTE les espèces du tiroir, le système calcule l'écart en direct.
function CloseModal({ centerId, day, state, onClose, onResult }: { centerId: string; day: string; state: ClosingState; onClose: () => void; onResult: (r: FinanceResult) => void }) {
  const { t, lang } = useI18n();
  // Le comptage démarre à la valeur attendue (cas le plus fréquent : la caisse est juste).
  const [counted, setCounted] = useState(String(state.expectedCashTnd));
  const [note, setNote] = useState("");
  const [pending, submit] = useSubmit(onResult);
  const variance = cashVariance(state.expectedCashTnd, Number(counted) || 0);
  return (
    <Modal open onClose={onClose} title={`${t("Clôturer la caisse")} · ${fmtDay(day, lang)}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => closeCashAction({ centerId, day, countedCashTnd: Number(counted) || 0, note: note || undefined }));
        }}
      >
        {/* Ce que le système attend, moyen par moyen (les remboursements sont déjà déduits). */}
        <div className="rounded-2xl bg-white/[0.04] p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-white/45">{t("Encaissements attendus du jour")}</p>
          <ul className="mt-2 space-y-1 tabular-nums">
            {state.expected.length === 0 && <li className="text-white/45">{t("Aucun encaissement.")}</li>}
            {state.expected.map((e) => (
              <li key={e.method} className="flex justify-between text-white/75">
                <span>{t(METHOD_LABELS[e.method])}</span>
                <span>{fmtMoney(e.amountTnd, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <label className={labelClass} htmlFor="counted-cash">{t("Espèces comptées dans le tiroir (DT)")}</label>
          <input id="counted-cash" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(",", "."))} className={inputClass} />
        </div>
        {/* Écart calculé en direct : compté − attendu. */}
        <p className={`rounded-2xl px-4 py-3 text-sm font-semibold tabular-nums ${variance === 0 ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
          {t("Écart")} : {variance > 0 ? "+" : ""}
          {fmtMoney(variance, lang)} {variance === 0 ? `· ${t("caisse juste")}` : variance < 0 ? `· ${t("il manque de l'argent")}` : `· ${t("excédent")}`}
        </p>
        <div>
          <label className={labelClass} htmlFor="closing-note">{t("Note (facultatif)")}</label>
          <input id="closing-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t("Ex. erreur de monnaie sur une coloration")} className={inputClass} />
        </div>
        <p className="text-xs text-white/45">{t("Après la clôture, plus aucun paiement ne peut être ajouté à cette journée (le propriétaire peut rouvrir la caisse).")}</p>
        <Submit pending={pending}>{t("Valider la clôture")}</Submit>
      </form>
    </Modal>
  );
}
