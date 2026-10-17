import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { Booking, Customer } from "@/lib/models/booking";
import { Center, Organization } from "@/lib/models/core";
import { Invoice, Payment } from "@/lib/models/finance";
import { balanceDue } from "./money";
import type { InvoicePdfData, ReceiptPdfData } from "./pdf";
import { canViewFinance, financeCenterIds, hashPaymentToken } from "./service";

// Chargement des pièces (facture, reçu) avec contrôle d'accès, pour la génération PDF.

async function letterhead(organizationId: unknown, centerId: unknown) {
  const [org, center] = await Promise.all([
    Organization.findById(organizationId).select("name").lean(),
    Center.findById(centerId).select("name address phone").lean(),
  ]);
  return {
    organization: { name: org?.name ?? "Salon" },
    center: { name: center?.name ?? "", address: center?.address ?? null, phone: center?.phone ?? null },
  };
}

export async function loadInvoicePdf(user: CurrentUser, invoiceId: string): Promise<InvoicePdfData | null> {
  if (!user.organization || !Types.ObjectId.isValid(invoiceId)) return null;
  await connectDB();
  const invoice = await Invoice.findOne({ _id: invoiceId, organizationId: user.organization.id }).lean();
  if (!invoice || !financeCenterIds(user).includes(String(invoice.centerId))) return null;
  // Le staff peut imprimer la facture d'un de ses rendez-vous ; les autres factures sont réservées à la gestion.
  if (!canViewFinance(user)) {
    const booking = invoice.bookingId ? await Booking.findById(invoice.bookingId).select("staffId").lean() : null;
    if (!booking || String(booking.staffId) !== user.id) return null;
  }
  const payments = await Payment.find({ invoiceId: invoice._id, status: "PAID" }).sort({ paidAt: 1 }).lean();
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
    payments: payments.map((p) => ({ paidAt: p.paidAt!, method: p.method, kind: p.kind, amountTnd: p.amountTnd, receiptNumber: p.receiptNumber ?? null })),
    cancelReason: invoice.cancelReason ?? null,
  };
}

async function receiptData(payment: NonNullable<Awaited<ReturnType<typeof Payment.findOne>>>): Promise<ReceiptPdfData | null> {
  if (payment.status !== "PAID" || !payment.receiptNumber) return null;
  const [customer, booking, invoice] = await Promise.all([
    payment.customerId ? Customer.findById(payment.customerId).select("firstName lastName").lean() : null,
    payment.bookingId ? Booking.findById(payment.bookingId).select("items packName start totalTnd").lean() : null,
    payment.invoiceId ? Invoice.findById(payment.invoiceId).select("number status").lean() : null,
  ]);
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
    services: booking ? (booking.packName ?? booking.items.map((i) => i.name).join(" + ")) : null,
    bookingStart: booking?.start ?? null,
    invoiceNumber: invoice && invoice.status !== "CANCELLED" ? invoice.number : null,
    remainingTnd: invoice ? null : remaining !== null ? Math.max(0, remaining) : null,
    note: payment.note ?? null,
  };
}

export async function loadReceiptPdf(user: CurrentUser, paymentId: string) {
  if (!user.organization || !Types.ObjectId.isValid(paymentId)) return null;
  await connectDB();
  const payment = await Payment.findOne({ _id: paymentId, organizationId: user.organization.id });
  if (!payment || !financeCenterIds(user).includes(String(payment.centerId))) return null;
  if (user.role === "STAFF" && String(payment.receivedBy) !== user.id) return null;
  return receiptData(payment);
}

// Reçu du paiement en ligne, accessible au client par le jeton de son lien de paiement.
export async function loadReceiptPdfByToken(token: string) {
  await connectDB();
  const payment = await Payment.findOne({ gatewayTokenHash: hashPaymentToken(token) });
  return payment ? receiptData(payment) : null;
}
