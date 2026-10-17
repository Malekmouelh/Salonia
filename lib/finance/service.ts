import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { accessibleCenterIds, type CurrentUser } from "@/lib/dal";
import type { PaymentKind, PaymentMethod } from "@/lib/enums";
import { Booking, Customer } from "@/lib/models/booking";
import { FinanceCounter, Invoice, Payment } from "@/lib/models/finance";
import { toLocal } from "@/lib/booking/time";
import { VAT_RATE, balanceDue, computeTotals, formatDocNumber, netPaid, roundTnd, sumTnd, type LineInput } from "./money";

// Logique métier du Module 6. Les Server Actions (app/actions/finance.ts) valident les entrées
// et appellent ces fonctions ; chaque fonction revérifie l'organisation et les droits.

export class FinanceError extends Error {}

export const hashPaymentToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ── Droits (cahier des charges §4) ──
// Propriétaire : tout. Gérant : caisse, factures et dépenses de son centre.
// Staff : encaisser ses propres rendez-vous, sans remise ni remboursement.
export function canViewFinance(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}
export function canCollect(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER" || user.role === "STAFF";
}
export function canRefund(user: CurrentUser) {
  return canViewFinance(user);
}

export function financeCenterIds(user: CurrentUser) {
  return canCollect(user) ? accessibleCenterIds(user) : [];
}

export function assertCenter(user: CurrentUser, centerId: string) {
  if (!financeCenterIds(user).includes(centerId)) throw new FinanceError("Accès refusé à ce centre.");
}

// Numéro suivant (incrément atomique par organisation, type de pièce et année civile).
export async function nextNumber(organizationId: string, prefix: "FAC" | "REC", at = new Date()) {
  const year = toLocal(at).year;
  const counter = await FinanceCounter.findOneAndUpdate(
    { _id: `${organizationId}:${prefix}:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return formatDocNumber(prefix, year, counter!.seq);
}

// ── Rendez-vous à encaisser ──
export async function loadBookingForCheckout(user: CurrentUser, bookingId: string) {
  if (!user.organization || !Types.ObjectId.isValid(bookingId)) return null;
  await connectDB();
  const booking = await Booking.findOne({ _id: bookingId, organizationId: user.organization.id });
  if (!booking) return null;
  if (!financeCenterIds(user).includes(String(booking.centerId))) return null;
  if (user.role === "STAFF" && String(booking.staffId) !== user.id) return null;
  return booking;
}

type BookingDoc = NonNullable<Awaited<ReturnType<typeof loadBookingForCheckout>>>;

async function bookingPayments(bookingId: Types.ObjectId | string) {
  return Payment.find({ bookingId, status: "PAID" }).lean();
}

async function activeInvoice(bookingId: Types.ObjectId | string) {
  return Invoice.findOne({ bookingId, status: { $ne: "CANCELLED" } });
}

export type Tender = { method: PaymentMethod; amountTnd: number; reference?: string };

// Enregistre un paiement confirmé avec son numéro de reçu.
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
  return Payment.create({
    organizationId: data.organizationId,
    centerId: data.centerId,
    bookingId: data.bookingId ?? null,
    customerId: data.customerId ?? null,
    invoiceId: data.invoiceId ?? null,
    kind: data.kind,
    method: data.tender.method,
    status: "PAID",
    amountTnd: roundTnd(data.tender.amountTnd),
    reference: data.tender.reference || undefined,
    note: data.note,
    receivedBy: data.receivedBy,
    paidAt: now,
    receiptNumber: await nextNumber(data.organizationId, "REC", now),
    refundOf: data.refundOf ?? null,
  });
}

function bookingLines(booking: BookingDoc): LineInput[] {
  // Pack : une seule ligne au prix du pack ; sinon une ligne par service.
  if (booking.packId) return [{ label: booking.packName ?? "Pack", quantity: 1, unitPriceTnd: booking.totalTnd }];
  return booking.items.map((i) => ({ label: i.name, quantity: 1, unitPriceTnd: i.priceTnd, serviceId: String(i.serviceId) }));
}

// Facture d'un rendez-vous entièrement réglé : relie tous ses paiements à la facture.
async function issueBookingInvoice(booking: BookingDoc, discountTnd: number, issuedBy: string | null) {
  const existing = await activeInvoice(booking._id);
  if (existing) return existing;
  const customer = await Customer.findById(booking.customerId).select("firstName lastName phone").lean();
  const totals = computeTotals(bookingLines(booking), discountTnd);
  const payments = await bookingPayments(booking._id);
  const now = new Date();
  const invoice = await Invoice.create({
    organizationId: booking.organizationId,
    centerId: booking.centerId,
    number: await nextNumber(String(booking.organizationId), "FAC", now),
    bookingId: booking._id,
    customerId: booking.customerId,
    customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Client",
    customerPhone: customer?.phone,
    ...totals,
    vatRate: VAT_RATE,
    paidTnd: netPaid(payments),
    status: netPaid(payments) >= totals.totalTnd ? "PAID" : "ISSUED",
    issuedAt: now,
    issuedBy,
  });
  await Payment.updateMany({ bookingId: booking._id, status: "PAID" }, { $set: { invoiceId: invoice._id } });
  return invoice;
}

export type CheckoutSummary = {
  totalTnd: number;
  discountTnd: number;
  paidTnd: number;
  dueTnd: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export async function bookingSummary(booking: BookingDoc): Promise<CheckoutSummary> {
  const [payments, invoice] = await Promise.all([bookingPayments(booking._id), activeInvoice(booking._id)]);
  const discount = invoice?.discountTnd ?? 0;
  const paid = netPaid(payments);
  return {
    totalTnd: booking.totalTnd,
    discountTnd: discount,
    paidTnd: paid,
    dueTnd: Math.max(0, roundTnd(booking.totalTnd - discount - paid)),
    invoiceId: invoice ? String(invoice._id) : null,
    invoiceNumber: invoice?.number ?? null,
  };
}

// F6.1 — Acompte de réservation (avant la prestation).
export async function recordDeposit(user: CurrentUser, bookingId: string, tender: Tender) {
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  if (booking.status === "CANCELLED" || booking.status === "NO_SHOW" || booking.status === "COMPLETED") {
    throw new FinanceError("Un acompte ne peut être pris que sur un rendez-vous à venir.");
  }
  const due = balanceDue(booking.totalTnd, await bookingPayments(booking._id));
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
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  if (booking.status === "CANCELLED") throw new FinanceError("Ce rendez-vous est annulé.");
  if (discountTnd > 0 && !canRefund(user)) throw new FinanceError("Seul le gérant ou le propriétaire peut accorder une remise.");
  if (await activeInvoice(booking._id)) throw new FinanceError("Ce rendez-vous est déjà facturé.");

  const payments = await bookingPayments(booking._id);
  const discount = roundTnd(Math.min(Math.max(discountTnd, 0), booking.totalTnd));
  const due = roundTnd(booking.totalTnd - discount - netPaid(payments));
  const amount = sumTnd(tenders.map((t) => t.amountTnd));
  if (tenders.some((t) => t.amountTnd <= 0)) throw new FinanceError("Chaque montant doit être positif.");
  if (amount > due + 0.0005) throw new FinanceError(`Le montant dépasse le solde dû (${due} DT).`);
  if (discount > 0 && Math.abs(amount - due) > 0.0005) throw new FinanceError("Une remise s'applique au règlement complet du solde.");

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
  if (!user.organization) throw new FinanceError("Accès refusé.");
  if (user.role === "STAFF") throw new FinanceError("La vente directe est réservée au gérant et au propriétaire.");
  assertCenter(user, input.centerId);
  if (input.lines.length === 0) throw new FinanceError("Ajoutez au moins une ligne.");
  const totals = computeTotals(input.lines, input.discountTnd);
  const amount = sumTnd(input.tenders.map((t) => t.amountTnd));
  if (totals.totalTnd <= 0) throw new FinanceError("Le total doit être positif.");
  if (Math.abs(amount - totals.totalTnd) > 0.0005) throw new FinanceError(`Le règlement (${amount} DT) doit égaler le total (${totals.totalTnd} DT).`);

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
  const now = new Date();
  const invoice = await Invoice.create({
    organizationId,
    centerId: input.centerId,
    number: await nextNumber(organizationId, "FAC", now),
    customerId,
    customerName,
    customerPhone,
    ...totals,
    vatRate: VAT_RATE,
    paidTnd: totals.totalTnd,
    status: "PAID",
    issuedAt: now,
    issuedBy: user.id,
  });
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
  const original = await Payment.findOne({ _id: paymentId, organizationId: user.organization.id, status: "PAID", kind: { $ne: "REFUND" } });
  if (!original) throw new FinanceError("Paiement introuvable.");
  assertCenter(user, String(original.centerId));
  const already = sumTnd((await Payment.find({ refundOf: original._id, status: "PAID" }).lean()).map((p) => p.amountTnd));
  const max = roundTnd(original.amountTnd - already);
  if (amountTnd <= 0 || amountTnd > max + 0.0005) throw new FinanceError(`Montant remboursable : ${max} DT au maximum.`);

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
  await Payment.updateMany({ invoiceId: invoice._id }, { $set: { invoiceId: null } });
  return invoice;
}

// ── F6.2 — Paiement en ligne (passerelle locale) ──
// Le salon génère un lien ; le client paie sur la page /paiement/[jeton]. La passerelle de démonstration
// (« sandbox ») simule l'autorisation : brancher Konnect, Flouci ou ClicToPay se fait dans lib/finance/gateway.ts.
const LINK_TTL_MS = 48 * 3600_000;

export async function createPaymentLink(user: CurrentUser, bookingId: string, amountTnd: number, kind: "DEPOSIT" | "PAYMENT") {
  const booking = await loadBookingForCheckout(user, bookingId);
  if (!booking) throw new FinanceError("Rendez-vous introuvable.");
  if (booking.status === "CANCELLED") throw new FinanceError("Ce rendez-vous est annulé.");
  const due = balanceDue(booking.totalTnd, await bookingPayments(booking._id));
  if (amountTnd <= 0 || amountTnd > due + 0.0005) throw new FinanceError(`Le montant doit être compris entre 0 et ${due} DT.`);
  // Un seul lien actif par rendez-vous : les anciens sont annulés.
  await Payment.updateMany({ bookingId: booking._id, status: "PENDING", method: "ONLINE" }, { $set: { status: "CANCELLED" } });
  const token = randomBytes(24).toString("base64url");
  await Payment.create({
    organizationId: booking.organizationId,
    centerId: booking.centerId,
    bookingId: booking._id,
    customerId: booking.customerId,
    kind,
    method: "ONLINE",
    status: "PENDING",
    amountTnd: roundTnd(amountTnd),
    receivedBy: user.id,
    gatewayTokenHash: hashPaymentToken(token),
    gatewayExpiresAt: new Date(Date.now() + LINK_TTL_MS),
  });
  return token;
}

export async function findPendingOnlinePayment(token: string) {
  await connectDB();
  return Payment.findOne({ gatewayTokenHash: hashPaymentToken(token) });
}

// Confirmation par la passerelle : le paiement est accepté, numéroté, et la facture émise si le solde est réglé.
export async function confirmOnlinePayment(token: string, reference: string) {
  const payment = await findPendingOnlinePayment(token);
  if (!payment) throw new FinanceError("Lien de paiement invalide.");
  if (payment.status === "PAID") return payment; // idempotent (double clic, rappel de la passerelle)
  if (payment.status !== "PENDING" || (payment.gatewayExpiresAt && payment.gatewayExpiresAt < new Date())) {
    throw new FinanceError("Ce lien de paiement a expiré. Demandez-en un nouveau au salon.");
  }
  const booking = payment.bookingId ? await Booking.findById(payment.bookingId) : null;
  if (!booking || booking.status === "CANCELLED") throw new FinanceError("Le rendez-vous lié n'est plus actif.");
  const due = balanceDue(booking.totalTnd, await bookingPayments(booking._id));
  if (payment.amountTnd > due + 0.0005) throw new FinanceError("Ce rendez-vous a déjà été réglé.");

  const now = new Date();
  payment.status = "PAID";
  payment.paidAt = now;
  payment.reference = reference;
  payment.receiptNumber = await nextNumber(String(payment.organizationId), "REC", now);
  await payment.save();

  if (Math.abs(payment.amountTnd - due) <= 0.0005) await issueBookingInvoice(booking, 0, null);
  return payment;
}

