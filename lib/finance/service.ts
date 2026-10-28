// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/service.ts — LA LOGIQUE MÉTIER DU MODULE 6 (le « cerveau »)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Contient les RÈGLES de l'argent : qui a le droit de faire quoi, comment on encaisse,
//   quand une facture est émise, comment on rembourse, comment fonctionne le paiement en ligne.
//   C'est ici que se trouvent toutes les vérifications importantes.
//
// ARCHITECTURE EN COUCHES (à savoir expliquer à l'enseignant)
//   Interface (components/…)  →  Server Actions (app/actions/finance.ts : validation Zod)
//        →  service.ts (règles métier + droits)  →  modèles Mongoose (lib/models/finance.ts)  →  MongoDB
//   Les vérifications de droits sont refaites ICI (et pas seulement dans l'interface) car
//   un utilisateur malveillant peut appeler le serveur sans passer par nos boutons.
//
// VOCABULAIRE
//   • Tender  = un « moyen de règlement » saisi à la caisse (ex. 30 DT en espèces).
//   • Acompte = somme versée AVANT la prestation (kind = DEPOSIT).
//   • Solde   = ce qu'il reste à payer.
// ═══════════════════════════════════════════════════════════════════════════
import "server-only"; // interdit l'import de ce fichier côté navigateur (il accède à la base)
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { accessibleCenterIds, type CurrentUser } from "@/lib/dal";
import type { PaymentKind, PaymentMethod } from "@/lib/enums";
import { Booking, Customer } from "@/lib/models/booking";
import { CashClosing, FinanceCounter, Invoice, Payment } from "@/lib/models/finance";
import { dayKey, toLocal } from "@/lib/booking/time";
import { getFinanceSettings } from "./settings";
import { balanceDue, computeTotals, formatDocNumber, netPaid, roundTnd, sumTnd, type LineInput } from "./money";

// Logique métier du Module 6. Les Server Actions (app/actions/finance.ts) valident les entrées
// et appellent ces fonctions ; chaque fonction revérifie l'organisation et les droits.

// Erreur « attendue » (règle métier non respectée) : son message est montré tel quel à l'utilisateur.
// Les autres erreurs (bugs, base indisponible) sont masquées derrière un message générique
// dans app/actions/finance.ts (fonction run) pour ne pas exposer de détails techniques.
export class FinanceError extends Error {}

// Empreinte SHA-256 d'un jeton de paiement : seule l'empreinte est stockée en base (jamais le jeton).
// Une fonction de hachage est à sens unique : on ne peut pas retrouver le jeton à partir de l'empreinte,
// mais on peut vérifier qu'un jeton donné correspond (on re-hache et on compare).
export const hashPaymentToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ── Droits (cahier des charges §4) ──
// Propriétaire : tout. Gérant : caisse, factures et dépenses de son centre.
// Staff : encaisser ses propres rendez-vous, sans remise ni remboursement.

// Peut voir le tableau de bord, les factures et les dépenses (propriétaire et gérant seulement).
export function canViewFinance(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}
// Peut encaisser (le staff aussi, mais seulement ses propres rendez-vous : voir loadBookingForCheckout).
export function canCollect(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER" || user.role === "STAFF";
}
// Peut rembourser et accorder des remises : mêmes droits que la consultation (gestion).
export function canRefund(user: CurrentUser) {
  return canViewFinance(user);
}

// Liste des identifiants de centres sur lesquels l'utilisateur peut travailler côté finances :
// tous pour le propriétaire, ses centres affectés pour gérant/staff, aucun pour un client.
// (`accessibleCenterIds` vient du socle de comptes, lib/dal.ts.)
export function financeCenterIds(user: CurrentUser) {
  return canCollect(user) ? accessibleCenterIds(user) : [];
}

// Garde-fou : lève une erreur si le centre demandé n'est pas dans le périmètre de l'utilisateur.
// Empêche le gérant de Sousse de manipuler les données de Tunis.
export function assertCenter(user: CurrentUser, centerId: string) {
  if (!financeCenterIds(user).includes(centerId)) throw new FinanceError("Accès refusé à ce centre.");
}

// Droit d'encaisser configurable (cahier §4 : le staff « encaisse selon ses droits »).
// Le propriétaire peut désactiver l'encaissement pour le staff dans les paramètres financiers.
// Propriétaire et gérant ne sont jamais concernés. Appelée au début de chaque opération d'encaissement.
export async function assertCanCollect(user: CurrentUser) {
  if (user.role !== "STAFF" || !user.organization) return;
  const settings = await getFinanceSettings(user.organization.id);
  if (!settings.staffCanCollect) throw new FinanceError("L'encaissement par le staff est désactivé. Adressez-vous au gérant.");
}

// Garde-fou de CLÔTURE : une fois la caisse d'un centre clôturée pour un jour, plus aucun mouvement
// d'argent ne peut y être ajouté (sinon le comptage validé serait faussé). Le propriétaire peut rouvrir la caisse.
export async function assertDayOpen(organizationId: string, centerId: string, at = new Date()) {
  await connectDB();
  const closed = await CashClosing.exists({ organizationId, centerId, day: dayKey(at) });
  if (closed) throw new FinanceError("La caisse de ce jour est clôturée. Le propriétaire doit la rouvrir pour enregistrer un nouveau mouvement.");
}

// Numéro suivant (incrément atomique par organisation, type de pièce et année civile).
// Fonctionnement : on cherche le compteur « salon:FAC:2026 » ; `$inc: { seq: 1 }` ajoute 1 ;
// `upsert: true` le crée s'il n'existe pas encore (premier numéro de l'année) ;
// `returnDocument: "after"` renvoie la valeur APRÈS incrément. Toute l'opération est ATOMIQUE :
// MongoDB la traite d'un seul bloc, donc deux caisses simultanées ne peuvent pas obtenir le même numéro.
export async function nextNumber(organizationId: string, prefix: "FAC" | "REC", at = new Date()) {
  const year = toLocal(at).year; // année en heure de Tunis (pas UTC)
  const counter = await FinanceCounter.findOneAndUpdate(
    { _id: `${organizationId}:${prefix}:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean(); // .lean() = renvoie un objet JavaScript simple (plus rapide qu'un document Mongoose)
  return formatDocNumber(prefix, year, counter!.seq);
}

// ── Rendez-vous à encaisser ──

// Charge une réservation À CONDITION que l'utilisateur ait le droit de l'encaisser.
// Renvoie null (=« introuvable ») dans tous les cas interdits, sans dire pourquoi : on ne révèle
// pas à un utilisateur l'existence d'un rendez-vous d'un autre salon.
export async function loadBookingForCheckout(user: CurrentUser, bookingId: string) {
  // Identifiant mal formé ou utilisateur sans salon : on arrête tout de suite.
  if (!user.organization || !Types.ObjectId.isValid(bookingId)) return null;
  await connectDB();
  // Le filtre `organizationId` garantit l'isolation entre salons.
  const booking = await Booking.findOne({ _id: bookingId, organizationId: user.organization.id });
  if (!booking) return null;
  // Le centre de la réservation doit faire partie des centres de l'utilisateur.
  if (!financeCenterIds(user).includes(String(booking.centerId))) return null;
  // Un membre du staff ne voit que SES rendez-vous (cahier des charges §4).
  if (user.role === "STAFF" && String(booking.staffId) !== user.id) return null;
  return booking;
}

// Type TypeScript d'une réservation chargée avec succès (on retire le cas « null »).
type BookingDoc = NonNullable<Awaited<ReturnType<typeof loadBookingForCheckout>>>;

// Paiements CONFIRMÉS d'une réservation (acomptes + encaissements + remboursements).
async function bookingPayments(bookingId: Types.ObjectId | string) {
  return Payment.find({ bookingId, status: "PAID" }).lean();
}

// Facture valide (non annulée) d'une réservation, s'il y en a une.
async function activeInvoice(bookingId: Types.ObjectId | string) {
  return Invoice.findOne({ bookingId, status: { $ne: "CANCELLED" } });
}

// Un règlement saisi à la caisse : moyen, montant, référence facultative (n° de ticket TPE…).
export type Tender = { method: PaymentMethod; amountTnd: number; reference?: string };

// Enregistre un paiement confirmé avec son numéro de reçu.
// Fonction interne utilisée par tous les encaissements (acompte, caisse, vente directe, remboursement).
async function createPaidPayment(data: {
  organizationId: string;
  centerId: string;
  bookingId?: string | null;
  customerId?: string | null;
  invoiceId?: string | null;
  kind: PaymentKind;
  tender: Tender;
  receivedBy: string | null;
  note?: string;
  refundOf?: string | null;
}) {
  const now = new Date();
  await assertDayOpen(data.organizationId, data.centerId, now); // refuse si la caisse du jour est clôturée
  return Payment.create({
    organizationId: data.organizationId,
    centerId: data.centerId,
    // `?? null` : si la valeur est absente (undefined), on enregistre null.
    bookingId: data.bookingId ?? null,
    customerId: data.customerId ?? null,
    invoiceId: data.invoiceId ?? null,
    kind: data.kind,
    method: data.tender.method,
    status: "PAID",
    amountTnd: roundTnd(data.tender.amountTnd),
    reference: data.tender.reference || undefined, // chaîne vide → on n'enregistre rien
    note: data.note,
    receivedBy: data.receivedBy,
    paidAt: now,
    // Chaque paiement reçoit son numéro de reçu séquentiel.
    receiptNumber: await nextNumber(data.organizationId, "REC", now),
    refundOf: data.refundOf ?? null,
  });
}

// Transforme une réservation en lignes de facture.
function bookingLines(booking: BookingDoc): LineInput[] {
  // Pack : une seule ligne au prix du pack ; sinon une ligne par service.
  if (booking.packId) return [{ label: booking.packName ?? "Pack", quantity: 1, unitPriceTnd: booking.totalTnd }];
  return booking.items.map((i) => ({ label: i.name, quantity: 1, unitPriceTnd: i.priceTnd, serviceId: String(i.serviceId) }));
}

// Facture d'un rendez-vous entièrement réglé : relie tous ses paiements à la facture.
async function issueBookingInvoice(booking: BookingDoc, discountTnd: number, issuedBy: string | null) {
  // IDEMPOTENT : si une facture valide existe déjà, on la renvoie au lieu d'en créer une seconde
  // (évite les doublons en cas de double clic ou de rappel de la passerelle).
  const existing = await activeInvoice(booking._id);
  if (existing) return existing;
  const customer = await Customer.findById(booking.customerId).select("firstName lastName phone").lean();
  const totals = computeTotals(bookingLines(booking), discountTnd);
  const payments = await bookingPayments(booking._id);
  // Taux de TVA configuré par le salon (19 % par défaut) : copié dans la facture, qui ne changera plus.
  const { vatRate } = await getFinanceSettings(String(booking.organizationId));
  const now = new Date();
  const invoice = await Invoice.create({
    organizationId: booking.organizationId,
    centerId: booking.centerId,
    number: await nextNumber(String(booking.organizationId), "FAC", now),
    bookingId: booking._id,
    customerId: booking.customerId,
    // Nom et téléphone COPIÉS dans la facture (elle doit rester figée même si la fiche client change).
    customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Client",
    customerPhone: customer?.phone,
    ...totals, // lines, subtotalTnd, discountTnd, totalTnd calculés par computeTotals
    vatRate,
    paidTnd: netPaid(payments),
    // Soldée (PAID) si l'argent net reçu couvre le total, sinon « À régler » (ISSUED).
    status: netPaid(payments) >= totals.totalTnd ? "PAID" : "ISSUED",
    issuedAt: now,
    issuedBy,
  });
  // On rattache tous les paiements de la réservation à cette facture (champ invoiceId).
  await Payment.updateMany({ bookingId: booking._id, status: "PAID" }, { $set: { invoiceId: invoice._id } });
  return invoice;
}

// Résumé financier d'une réservation (pour l'interface de la caisse).
export type CheckoutSummary = {
  totalTnd: number;
  discountTnd: number;
  paidTnd: number;
  dueTnd: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export async function bookingSummary(booking: BookingDoc): Promise<CheckoutSummary> {
  // Les deux requêtes sont indépendantes : Promise.all les lance EN PARALLÈLE (plus rapide).
  const [payments, invoice] = await Promise.all([bookingPayments(booking._id), activeInvoice(booking._id)]);
  const discount = invoice?.discountTnd ?? 0;
  const paid = netPaid(payments);
  return {
    totalTnd: booking.totalTnd,
    discountTnd: discount,
    paidTnd: paid,
    // Reste à payer = total − remise − déjà payé, jamais négatif (Math.max(0, …)).
    dueTnd: Math.max(0, roundTnd(booking.totalTnd - discount - paid)),
    invoiceId: invoice ? String(invoice._id) : null,
    invoiceNumber: invoice?.number ?? null,
  };
}

// F6.1 — Acompte de réservation (avant la prestation).
export async function recordDeposit(user: CurrentUser, bookingId: string, tender: Tender) {
  await assertCanCollect(user);
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  // Un acompte n'a de sens que pour un rendez-vous à venir.
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW" || booking.status === "COMPLETED") {
    throw new FinanceError("Un acompte ne peut être pris que sur un rendez-vous à venir.");
  }
  const due = balanceDue(booking.totalTnd, await bookingPayments(booking._id));
  // L'acompte doit être > 0 et ne peut pas dépasser ce qu'il reste à payer.
  if (tender.amountTnd <= 0 || tender.amountTnd > due) throw new FinanceError(`L'acompte doit être compris entre 0 et ${due} DT.`);
  return createPaidPayment({
    organizationId: String(booking.organizationId),
    centerId: String(booking.centerId),
    bookingId: String(booking._id),
    customerId: String(booking.customerId),
    kind: "DEPOSIT",
    tender,
    receivedBy: user.id,
  });
}

// F6.1 — Encaissement d'un rendez-vous (paiement fractionné possible : espèces + carte…).
// Si le solde est réglé, la facture est émise et la prestation passe à « Terminé ».
export async function checkoutBooking(user: CurrentUser, bookingId: string, tenders: Tender[], discountTnd = 0) {
  // 1) Contrôles préalables (droits, état du rendez-vous).
  await assertCanCollect(user);
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  if (booking.status === "CANCELLED") throw new FinanceError("Ce rendez-vous est annulé.");
  // Seuls gérant et propriétaire peuvent accorder une remise (le staff, non).
  if (discountTnd > 0 && !canRefund(user)) throw new FinanceError("Seul le gérant ou le propriétaire peut accorder une remise.");
  if (await activeInvoice(booking._id)) throw new FinanceError("Ce rendez-vous est déjà facturé.");

  // 2) Calcul de ce qui reste à payer : total − remise (bornée) − acomptes déjà versés.
  const payments = await bookingPayments(booking._id);
  const discount = roundTnd(Math.min(Math.max(discountTnd, 0), booking.totalTnd));
  const due = roundTnd(booking.totalTnd - discount - netPaid(payments));
  const amount = sumTnd(tenders.map((t) => t.amountTnd)); // somme des règlements saisis
  if (tenders.some((t) => t.amountTnd <= 0)) throw new FinanceError("Chaque montant doit être positif.");
  // Tolérance de 0,0005 DT (= un demi-millime) pour absorber les petites erreurs de virgule flottante.
  if (amount > due + 0.0005) throw new FinanceError(`Le montant dépasse le solde dû (${due} DT).`);
  if (discount > 0 && Math.abs(amount - due) > 0.0005) throw new FinanceError("Une remise s'applique au règlement complet du solde.");

  // 3) Un document Payment par moyen de règlement (ex. 30 espèces + 26 carte = 2 paiements).
  const created = [];
  for (const tender of tenders) {
    created.push(
      await createPaidPayment({
        organizationId: String(booking.organizationId),
        centerId: String(booking.centerId),
        bookingId: String(booking._id),
        customerId: String(booking.customerId),
        kind: "PAYMENT",
        tender,
        receivedBy: user.id,
      }),
    );
  }

  // 4) Si le solde est entièrement réglé : émission automatique de la facture.
  let invoice = null;
  if (Math.abs(amount - due) <= 0.0005) {
    invoice = await issueBookingInvoice(booking, discount, user.id);
    // Prestation réglée et commencée : elle passe à « Terminé » dans le calendrier (Module 3).
    if ((booking.status === "CONFIRMED" || booking.status === "PENDING") && booking.start <= new Date()) {
      booking.status = "COMPLETED";
      await booking.save();
    }
  }
  return { payments: created, invoice };
}

// Facture d'un rendez-vous déjà réglé (ex. après annulation d'une facture erronée).
export async function invoiceSettledBooking(user: CurrentUser, bookingId: string) {
  await assertCanCollect(user);
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  const summary = await bookingSummary(booking);
  if (summary.invoiceId) throw new FinanceError("Ce rendez-vous est déjà facturé.");
  if (summary.paidTnd < booking.totalTnd) throw new FinanceError("Le rendez-vous n'est pas entièrement réglé.");
  return issueBookingInvoice(booking, 0, user.id);
}

// F6.1 — Vente directe (client de passage, prestation non réservée, produit) : facture immédiate.
export async function directSale(
  user: CurrentUser,
  input: { centerId: string; lines: LineInput[]; tenders: Tender[]; discountTnd: number; customerId?: string | null; customerName?: string },
) {
  // Contrôles : salon, rôle (pas le staff), centre autorisé, au moins une ligne.
  if (!user.organization) throw new FinanceError("Accès refusé.");
  if (user.role === "STAFF") throw new FinanceError("La vente directe est réservée au gérant et au propriétaire.");
  assertCenter(user, input.centerId);
  if (input.lines.length === 0) throw new FinanceError("Ajoutez au moins une ligne.");
  const totals = computeTotals(input.lines, input.discountTnd);
  const amount = sumTnd(input.tenders.map((t) => t.amountTnd));
  if (totals.totalTnd <= 0) throw new FinanceError("Le total doit être positif.");
  // Une vente directe est payée immédiatement et en totalité : règlement = total exact.
  if (Math.abs(amount - totals.totalTnd) > 0.0005) throw new FinanceError(`Le règlement (${amount} DT) doit égaler le total (${totals.totalTnd} DT).`);

  // Client : par défaut « Client de passage » ; si une fiche client valide est fournie (et qu'elle
  // appartient bien au salon !), on utilise son nom et son téléphone.
  let customerName = input.customerName?.trim() || "Client de passage";
  let customerPhone: string | undefined;
  let customerId: string | null = null;
  if (input.customerId && Types.ObjectId.isValid(input.customerId)) {
    const c = await Customer.findOne({ _id: input.customerId, organizationId: user.organization.id }).lean();
    if (c) {
      customerId = String(c._id);
      customerName = `${c.firstName} ${c.lastName}`;
      customerPhone = c.phone;
    }
  }

  const organizationId = user.organization.id;
  const { vatRate } = await getFinanceSettings(organizationId);
  await assertDayOpen(organizationId, input.centerId); // pas de vente dans une caisse clôturée
  const now = new Date();
  // La facture est créée directement « PAID » (soldée) : le client part en ayant tout payé.
  const invoice = await Invoice.create({
    organizationId,
    centerId: input.centerId,
    number: await nextNumber(organizationId, "FAC", now),
    customerId,
    customerName,
    customerPhone,
    ...totals,
    vatRate,
    paidTnd: totals.totalTnd,
    status: "PAID",
    issuedAt: now,
    issuedBy: user.id,
  });
  // Un Payment par moyen de règlement (on ignore d'éventuelles lignes à 0 DT).
  const payments = [];
  for (const tender of input.tenders.filter((t) => t.amountTnd > 0)) {
    payments.push(
      await createPaidPayment({ organizationId, centerId: input.centerId, customerId, invoiceId: String(invoice._id), kind: "PAYMENT", tender, receivedBy: user.id }),
    );
  }
  return { invoice, payments };
}

// Remboursement total ou partiel d'un paiement (gérant / propriétaire).
export async function refundPayment(user: CurrentUser, paymentId: string, amountTnd: number, reason: string) {
  if (!user.organization || !canRefund(user) || !Types.ObjectId.isValid(paymentId)) throw new FinanceError("Accès refusé.");
  await connectDB();
  // On ne rembourse qu'un paiement CONFIRMÉ, de CE salon, et qui n'est pas déjà un remboursement.
  const original = await Payment.findOne({ _id: paymentId, organizationId: user.organization.id, status: "PAID", kind: { $ne: "REFUND" } });
  if (!original) throw new FinanceError("Paiement introuvable.");
  assertCenter(user, String(original.centerId));
  // Montant déjà remboursé sur ce paiement → on calcule ce qu'il est encore possible de rembourser
  // (on ne peut jamais rembourser plus que le paiement d'origine, même en plusieurs fois).
  const already = sumTnd((await Payment.find({ refundOf: original._id, status: "PAID" }).lean()).map((p) => p.amountTnd));
  const max = roundTnd(original.amountTnd - already);
  if (amountTnd <= 0 || amountTnd > max + 0.0005) throw new FinanceError(`Montant remboursable : ${max} DT au maximum.`);

  // Le remboursement est un nouveau Payment (kind REFUND, montant positif) lié à l'original (refundOf).
  const refund = await createPaidPayment({
    organizationId: user.organization.id,
    centerId: String(original.centerId),
    bookingId: original.bookingId ? String(original.bookingId) : null,
    customerId: original.customerId ? String(original.customerId) : null,
    invoiceId: original.invoiceId ? String(original.invoiceId) : null,
    kind: "REFUND",
    // Remboursement par le même moyen ; un paiement en ligne est remboursé en espèces au comptoir.
    tender: { method: original.method === "ONLINE" ? "CASH" : (original.method as PaymentMethod), amountTnd },
    receivedBy: user.id,
    note: reason,
    refundOf: String(original._id),
  });
  // La facture n'est pas modifiée : le remboursement apparaît dans ses règlements (ligne négative).
  return refund;
}

// Annulation d'une facture (le numéro n'est jamais réutilisé ; les paiements restent enregistrés).
// Réservé au propriétaire. On ne SUPPRIME jamais une facture (obligation comptable) : on la marque annulée.
export async function cancelInvoice(user: CurrentUser, invoiceId: string, reason: string) {
  if (!user.organization || user.role !== "OWNER" || !Types.ObjectId.isValid(invoiceId)) {
    throw new FinanceError("Seul le propriétaire peut annuler une facture.");
  }
  await connectDB();
  const invoice = await Invoice.findOne({ _id: invoiceId, organizationId: user.organization.id });
  if (!invoice || invoice.status === "CANCELLED") throw new FinanceError("Facture introuvable ou déjà annulée.");
  invoice.status = "CANCELLED";
  invoice.cancelledAt = new Date();
  invoice.cancelReason = reason;
  await invoice.save();
  // On détache les paiements de la facture annulée (invoiceId = null) : ils restent enregistrés
  // et la réservation peut être refacturée (voir invoiceSettledBooking).
  await Payment.updateMany({ invoiceId: invoice._id }, { $set: { invoiceId: null } });
  return invoice;
}

// ── F6.2 — Paiement en ligne (passerelle locale) ──
// Le salon génère un lien ; le client paie sur la page /paiement/[jeton]. La passerelle de démonstration
// (« sandbox ») simule l'autorisation : brancher Konnect, Flouci ou ClicToPay se fait dans lib/finance/gateway.ts.
//
// DÉROULÉ COMPLET
//   1. createPaymentLink : le salon crée un Payment « PENDING » + un jeton secret → lien à envoyer.
//   2. Le client ouvre /paiement/<jeton> et saisit sa carte (components/finance/online-checkout.tsx).
//   3. payOnlineAction (app/actions/finance.ts) interroge la passerelle (gateway.ts).
//   4. Si acceptée : confirmOnlinePayment passe le Payment en « PAID » et émet la facture si soldé.

// Durée de validité d'un lien : 48 h exprimées en millisecondes (48 × 3600 s × 1000 ; `_` = séparateur lisible).
const LINK_TTL_MS = 48 * 3600_000;

export async function createPaymentLink(user: CurrentUser, bookingId: string, amountTnd: number, kind: "DEPOSIT" | "PAYMENT") {
  await assertCanCollect(user);
  // Le salon peut désactiver le paiement en ligne (cahier F1.2 : fonctionnalités activables).
  if (user.organization && !(await getFinanceSettings(user.organization.id)).onlinePaymentsEnabled) {
    throw new FinanceError("Le paiement en ligne est désactivé dans les paramètres financiers.");
  }
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  if (booking.status === "CANCELLED") throw new FinanceError("Ce rendez-vous est annulé.");
  const due = balanceDue(booking.totalTnd, await bookingPayments(booking._id));
  if (amountTnd <= 0 || amountTnd > due + 0.0005) throw new FinanceError(`Le montant doit être compris entre 0 et ${due} DT.`);
  // Un seul lien actif par rendez-vous : les anciens sont annulés.
  await Payment.updateMany({ bookingId: booking._id, status: "PENDING", method: "ONLINE" }, { $set: { status: "CANCELLED" } });
  // Jeton secret : 24 octets aléatoires cryptographiquement sûrs (192 bits), encodés en base64url
  // (caractères utilisables dans une adresse web). Impossible à deviner.
  const token = randomBytes(24).toString("base64url");
  await Payment.create({
    organizationId: booking.organizationId,
    centerId: booking.centerId,
    bookingId: booking._id,
    customerId: booking.customerId,
    kind,
    method: "ONLINE",
    status: "PENDING", // pas encore payé : ne compte pas dans les chiffres
    amountTnd: roundTnd(amountTnd),
    receivedBy: user.id,
    gatewayTokenHash: hashPaymentToken(token), // on ne garde que l'empreinte du jeton
    gatewayExpiresAt: new Date(Date.now() + LINK_TTL_MS),
  });
  // Le jeton en clair n'est renvoyé qu'ici, une seule fois, pour construire le lien.
  return token;
}

// Retrouve le paiement lié à un jeton (on hache le jeton reçu et on cherche l'empreinte).
export async function findPendingOnlinePayment(token: string) {
  await connectDB();
  return Payment.findOne({ gatewayTokenHash: hashPaymentToken(token) });
}

// Confirmation par la passerelle : le paiement est accepté, numéroté, et la facture émise si le solde est réglé.
export async function confirmOnlinePayment(token: string, reference: string) {
  const payment = await findPendingOnlinePayment(token);
  if (!payment) throw new FinanceError("Lien de paiement invalide.");
  if (payment.status === "PAID") return payment; // idempotent (double clic, rappel de la passerelle)
  // Refus si le lien a été remplacé/annulé (statut ≠ PENDING) ou s'il a expiré.
  if (payment.status !== "PENDING" || (payment.gatewayExpiresAt && payment.gatewayExpiresAt < new Date())) {
    throw new FinanceError("Ce lien de paiement a expiré. Demandez-en un nouveau au salon.");
  }
  const booking = payment.bookingId ? await Booking.findById(payment.bookingId) : null;
  if (!booking || booking.status === "CANCELLED") throw new FinanceError("Le rendez-vous lié n'est plus actif.");
  // Entre-temps, le client a pu payer autrement (ex. en espèces au salon) : on revérifie le solde.
  const due = balanceDue(booking.totalTnd, await bookingPayments(booking._id));
  if (payment.amountTnd > due + 0.0005) throw new FinanceError("Ce rendez-vous a déjà été réglé.");

  // On « valide » le paiement : statut PAID, date, référence de la passerelle, numéro de reçu.
  const now = new Date();
  payment.status = "PAID";
  payment.paidAt = now;
  payment.reference = reference;
  payment.receiptNumber = await nextNumber(String(payment.organizationId), "REC", now);
  await payment.save();

  // Si ce paiement solde exactement le rendez-vous, on émet la facture (sans utilisateur : c'est le client qui a payé).
  if (Math.abs(payment.amountTnd - due) <= 0.0005) await issueBookingInvoice(booking, 0, null);
  return payment;
}

// Annule un lien de paiement en ligne encore en attente (le client ne pourra plus l'utiliser).
// Cas d'usage : lien envoyé au mauvais numéro, montant erroné, client qui renonce.
// Seuls les paiements « PENDING » en ligne sont concernés : un paiement déjà encaissé ne s'annule pas
// (il se REMBOURSE, voir refundPayment).
export async function cancelPendingPayment(user: CurrentUser, paymentId: string) {
  if (!user.organization || !canCollect(user) || !Types.ObjectId.isValid(paymentId)) throw new FinanceError("Accès refusé.");
  await assertCanCollect(user);
  await connectDB();
  const payment = await Payment.findOne({ _id: paymentId, organizationId: user.organization.id, method: "ONLINE", status: "PENDING" });
  if (!payment) throw new FinanceError("Lien de paiement introuvable ou déjà utilisé.");
  assertCenter(user, String(payment.centerId));
  payment.status = "CANCELLED";
  await payment.save();
  return payment;
}

// ── Protection contre le « test de cartes » ──
// Sans limite, quelqu'un qui connaît un lien pourrait essayer des milliers de numéros de carte volés.
// Après MAX_ONLINE_ATTEMPTS essais ratés, le lien est définitivement verrouillé (statut FAILED) :
// le salon doit en générer un nouveau.
export const MAX_ONLINE_ATTEMPTS = 5;

// Enregistre un essai raté et renvoie `locked: true` si le lien vient d'être verrouillé.
export async function registerFailedAttempt(token: string) {
  await connectDB();
  // `$inc` incrémente atomiquement (deux essais simultanés comptent bien pour deux).
  const payment = await Payment.findOneAndUpdate(
    { gatewayTokenHash: hashPaymentToken(token), status: "PENDING" },
    { $inc: { gatewayAttempts: 1 } },
    { returnDocument: "after" },
  );
  if (!payment) return { locked: true };
  if (payment.gatewayAttempts >= MAX_ONLINE_ATTEMPTS) {
    payment.status = "FAILED";
    await payment.save();
    return { locked: true };
  }
  return { locked: false, remaining: MAX_ONLINE_ATTEMPTS - payment.gatewayAttempts };
}

// ── Espace client (cahier §4 : le client final peut « payer » et « consulter son historique ») ──
// Retrouve les fiches client d'un compte CLIENT : par lien direct (userId), ou par même e-mail ou même
// téléphone (un client réserve souvent SANS compte, la fiche est créée par le salon). Même logique que
// getMyBookings (module 3) pour que le client retrouve réservations ET paiements.
export async function clientCustomerIds(user: CurrentUser) {
  if (!user.organization || user.role !== "CLIENT") return [];
  await connectDB();
  const customers = await Customer.find({
    organizationId: user.organization.id,
    $or: [{ userId: user.id }, ...(user.email ? [{ email: user.email }] : []), ...(user.phone ? [{ phone: user.phone }] : [])],
  })
    .select("_id")
    .lean();
  return customers.map((c) => c._id);
}

