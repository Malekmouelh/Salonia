// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/documents.ts — CHARGEMENT DES DONNÉES DES DOCUMENTS (avec contrôle d'accès)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Fait le lien entre la BASE DE DONNÉES et la génération PDF (pdf.ts). Pour une facture ou un
//   reçu demandé, il : (1) vérifie que l'utilisateur a le droit de le voir, (2) rassemble toutes
//   les informations nécessaires (client, centre, paiements…) et (3) les renvoie dans le format
//   attendu par pdf.ts. Il renvoie `null` si le document n'existe pas OU n'est pas autorisé
//   (la route API répond alors « 404 introuvable » dans les deux cas : on ne révèle rien).
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { Booking, Customer } from "@/lib/models/booking";
import { Center, Organization } from "@/lib/models/core";
import { CashClosing, Invoice, Payment } from "@/lib/models/finance";
import { balanceDue } from "./money";
import type { ClosingPdfData, InvoicePdfData, ReceiptPdfData } from "./pdf";
import { getFinanceSettings } from "./settings";
import { canViewFinance, clientCustomerIds, financeCenterIds, hashPaymentToken } from "./service";

// Chargement des pièces (facture, reçu) avec contrôle d'accès, pour la génération PDF.

// « Papier à en-tête » : nom du salon + nom, adresse et téléphone du centre (communs à tous les documents).
async function letterhead(organizationId: unknown, centerId: unknown) {
  // Deux lectures indépendantes en parallèle ; `.select(...)` limite les champs lus ; `.lean()` = objet simple.
  const [org, center] = await Promise.all([
    Organization.findById(organizationId).select("name").lean(),
    Center.findById(centerId).select("name address phone").lean(),
  ]);
  return {
    organization: { name: org?.name ?? "Salon" },
    center: { name: center?.name ?? "", address: center?.address ?? null, phone: center?.phone ?? null },
  };
}

// Données d'une FACTURE pour le PDF. Renvoie null si la facture est introuvable ou interdite.
export async function loadInvoicePdf(user: CurrentUser, invoiceId: string): Promise<InvoicePdfData | null> {
  if (!user.organization || !Types.ObjectId.isValid(invoiceId)) return null;
  await connectDB();
  // Filtre sur l'organisation : impossible d'ouvrir la facture d'un autre salon, même en connaissant son identifiant.
  const invoice = await Invoice.findOne({ _id: invoiceId, organizationId: user.organization.id }).lean();
  if (!invoice) return null;
  if (user.role === "CLIENT") {
    // Espace client : un client ne peut ouvrir QUE ses propres factures non annulées.
    const mine = (await clientCustomerIds(user)).map(String);
    if (!invoice.customerId || !mine.includes(String(invoice.customerId)) || invoice.status === "CANCELLED") return null;
  } else if (!financeCenterIds(user).includes(String(invoice.centerId))) {
    // Et le centre de la facture doit faire partie des centres de l'utilisateur.
    return null;
  }
  // Le staff peut imprimer la facture d'un de ses rendez-vous ; les autres factures sont réservées à la gestion.
  if (user.role !== "CLIENT" && !canViewFinance(user)) {
    const booking = invoice.bookingId ? await Booking.findById(invoice.bookingId).select("staffId").lean() : null;
    if (!booking || String(booking.staffId) !== user.id) return null;
  }
  // Paiements rattachés à la facture, du plus ancien au plus récent (`sort({ paidAt: 1 })` = ordre croissant).
  const payments = await Payment.find({ invoiceId: invoice._id, status: "PAID" }).sort({ paidAt: 1 }).lean();
  const settings = await getFinanceSettings(user.organization.id); // matricule fiscal et mentions légales
  return {
    ...(await letterhead(invoice.organizationId, invoice.centerId)),
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    status: invoice.status,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone ?? null,
    lines: invoice.lines.map((l) => ({ label: l.label, quantity: l.quantity, unitPriceTnd: l.unitPriceTnd, totalTnd: l.totalTnd })),
    subtotalTnd: invoice.subtotalTnd,
    discountTnd: invoice.discountTnd ?? 0,
    totalTnd: invoice.totalTnd,
    vatRate: invoice.vatRate ?? 0.19,
    paidTnd: invoice.paidTnd,
    // `p.paidAt!` : le « ! » dit à TypeScript « cette date existe forcément » (un paiement PAID a toujours une date).
    payments: payments.map((p) => ({ paidAt: p.paidAt!, method: p.method, kind: p.kind, amountTnd: p.amountTnd, receiptNumber: p.receiptNumber ?? null })),
    cancelReason: invoice.cancelReason ?? null,
    taxId: settings.taxId || null,
    footerNote: settings.invoiceFooter || null,
  };
}

// Données d'un REÇU à partir d'un paiement déjà chargé (fonction interne, partagée par les 2 accès ci-dessous).
// Le type du paramètre signifie : « un document Payment tel que renvoyé par Payment.findOne, non nul ».
async function receiptData(payment: NonNullable<Awaited<ReturnType<typeof Payment.findOne>>>): Promise<ReceiptPdfData | null> {
  // Pas de reçu pour un paiement non confirmé (lien en attente, échec…).
  if (payment.status !== "PAID" || !payment.receiptNumber) return null;
  // Client, réservation et facture liés (chacun peut être absent : vente directe, client de passage…).
  const [customer, booking, invoice] = await Promise.all([
    payment.customerId ? Customer.findById(payment.customerId).select("firstName lastName").lean() : null,
    payment.bookingId ? Booking.findById(payment.bookingId).select("items packName start totalTnd").lean() : null,
    payment.invoiceId ? Invoice.findById(payment.invoiceId).select("number status").lean() : null,
  ]);
  // Reste à payer sur la réservation (affiché sur le reçu d'un acompte, par exemple).
  const remaining = booking ? balanceDue(booking.totalTnd, await Payment.find({ bookingId: booking._id, status: "PAID" }).lean()) : null;
  return {
    ...(await letterhead(payment.organizationId, payment.centerId)),
    receiptNumber: payment.receiptNumber,
    paidAt: payment.paidAt!,
    kind: payment.kind,
    method: payment.method,
    amountTnd: payment.amountTnd,
    reference: payment.reference ?? null,
    customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Client de passage",
    // Pack : son nom ; sinon, les noms des services séparés par « + ».
    services: booking ? (booking.packName ?? booking.items.map((i) => i.name).join(" + ")) : null,
    bookingStart: booking?.start ?? null,
    // Numéro de facture seulement si la facture existe et n'est pas annulée.
    invoiceNumber: invoice && invoice.status !== "CANCELLED" ? invoice.number : null,
    // « Reste à payer » n'a d'intérêt que tant qu'il n'y a pas de facture soldée.
    remainingTnd: invoice ? null : remaining !== null ? Math.max(0, remaining) : null,
    note: payment.note ?? null,
  };
}

// Reçu demandé par un utilisateur CONNECTÉ (route /api/finance/receipts/[id]).
export async function loadReceiptPdf(user: CurrentUser, paymentId: string) {
  if (!user.organization || !Types.ObjectId.isValid(paymentId)) return null;
  await connectDB();
  const payment = await Payment.findOne({ _id: paymentId, organizationId: user.organization.id });
  if (!payment) return null;
  if (user.role === "CLIENT") {
    // Espace client : seulement les reçus de SES paiements.
    const mine = (await clientCustomerIds(user)).map(String);
    if (!payment.customerId || !mine.includes(String(payment.customerId))) return null;
  } else {
    if (!financeCenterIds(user).includes(String(payment.centerId))) return null;
    // Le staff ne voit que les reçus des paiements qu'il a lui-même encaissés.
    if (user.role === "STAFF" && String(payment.receivedBy) !== user.id) return null;
  }
  return receiptData(payment);
}

// Reçu du paiement en ligne, accessible au client par le jeton de son lien de paiement.
// Pas de session ici (le client n'a pas de compte) : la connaissance du jeton secret SUFFIT à prouver
// que c'est bien lui. On retrouve le paiement par l'empreinte du jeton.
export async function loadReceiptPdfByToken(token: string) {
  await connectDB();
  const payment = await Payment.findOne({ gatewayTokenHash: hashPaymentToken(token) });
  return payment ? receiptData(payment) : null;
}

// Données du rapport de CLÔTURE de caisse (propriétaire et gérant, pour leurs centres).
export async function loadClosingPdf(user: CurrentUser, closingId: string): Promise<ClosingPdfData | null> {
  if (!user.organization || !canViewFinance(user) || !Types.ObjectId.isValid(closingId)) return null;
  await connectDB();
  const closing = await CashClosing.findOne({ _id: closingId, organizationId: user.organization.id })
    .populate<{ closedBy: { firstName: string; lastName: string } | null }>("closedBy", "firstName lastName")
    .lean();
  if (!closing || !financeCenterIds(user).includes(String(closing.centerId))) return null;
  return {
    ...(await letterhead(closing.organizationId, closing.centerId)),
    day: closing.day,
    closedAt: closing.closedAt,
    closedBy: closing.closedBy ? `${closing.closedBy.firstName} ${closing.closedBy.lastName}` : "—",
    expected: closing.expected.map((e) => ({ method: e.method, amountTnd: e.amountTnd })),
    expectedCashTnd: closing.expectedCashTnd,
    countedCashTnd: closing.countedCashTnd,
    varianceTnd: closing.varianceTnd,
    note: closing.note ?? null,
  };
}
