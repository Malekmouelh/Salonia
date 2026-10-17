import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  EXPENSE_CATEGORIES,
  INVOICE_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from "@/lib/enums";

// Module 6 : Paiements, factures et pilotage financier (Salsabil).
// Collections : payments, invoices, expenses, financecounters.
// Montants en dinars tunisiens (3 décimales : millimes), toujours arrondis avec roundTnd().

const { ObjectId } = Schema.Types;

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

// F6.1 / F6.2 — Encaissement, acompte ou remboursement.
const PaymentSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    bookingId: { type: ObjectId, ref: "Booking", default: null },
    customerId: { type: ObjectId, ref: "Customer", default: null },
    invoiceId: { type: ObjectId, ref: "Invoice", default: null },
    kind: { type: String, enum: PAYMENT_KINDS, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: "PAID" },
    amountTnd: { type: Number, required: true, min: 0 },
    // Reçu numéroté (REC-2026-00001), attribué quand le paiement est confirmé.
    receiptNumber: { type: String, default: null },
    // Référence externe : n° de transaction TPE, D17, Flouci, passerelle en ligne…
    reference: String,
    note: String,
    receivedBy: { type: ObjectId, ref: "User", default: null },
    paidAt: { type: Date, default: null },
    // Paiement en ligne : jeton (haché) du lien envoyé au client et date d'expiration.
    gatewayTokenHash: { type: String, default: undefined },
    gatewayExpiresAt: Date,
    // Remboursement : paiement d'origine.
    refundOf: { type: ObjectId, ref: "Payment", default: null },
  },
  { timestamps: true },
);
PaymentSchema.index({ organizationId: 1, status: 1, paidAt: -1 });
PaymentSchema.index({ centerId: 1, paidAt: -1 });
PaymentSchema.index({ bookingId: 1 });
PaymentSchema.index({ gatewayTokenHash: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ organizationId: 1, receiptNumber: 1 }, { unique: true, partialFilterExpression: { receiptNumber: { $type: "string" } } });
export const Payment = model("Payment", PaymentSchema);

const InvoiceLineSchema = new Schema(
  {
    label: { type: String, required: true },
    serviceId: { type: ObjectId, ref: "Service", default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceTnd: { type: Number, required: true, min: 0 },
    totalTnd: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// F6.3 — Facture numérotée (FAC-2026-00001). Les montants sont TTC ; la TVA incluse est recalculée à l'affichage.
const InvoiceSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    number: { type: String, required: true },
    bookingId: { type: ObjectId, ref: "Booking", default: null },
    customerId: { type: ObjectId, ref: "Customer", default: null },
    // Copie au moment de l'émission : la facture ne change pas si la fiche client change.
    customerName: { type: String, required: true },
    customerPhone: String,
    lines: { type: [InvoiceLineSchema], required: true },
    subtotalTnd: { type: Number, required: true },
    discountTnd: { type: Number, default: 0 },
    totalTnd: { type: Number, required: true },
    vatRate: { type: Number, default: 0.19 },
    paidTnd: { type: Number, default: 0 },
    status: { type: String, enum: INVOICE_STATUSES, default: "ISSUED" },
    issuedAt: { type: Date, required: true },
    issuedBy: { type: ObjectId, ref: "User", default: null },
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true },
);
InvoiceSchema.index({ organizationId: 1, number: 1 }, { unique: true });
InvoiceSchema.index({ organizationId: 1, issuedAt: -1 });
InvoiceSchema.index({ bookingId: 1 });
export const Invoice = model("Invoice", InvoiceSchema);

// F6.4 — Dépense d'un centre (loyer, produits, salaires…).
const ExpenseSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    label: { type: String, required: true, trim: true },
    amountTnd: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true },
    method: { type: String, enum: [...PAYMENT_METHODS, "TRANSFER", "CHECK"], default: "CASH" },
    supplier: String,
    createdBy: { type: ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
ExpenseSchema.index({ organizationId: 1, date: -1 });
ExpenseSchema.index({ centerId: 1, date: -1 });
export const Expense = model("Expense", ExpenseSchema);

// Compteurs de numérotation séquentielle (incrément atomique) : _id = "<organisation>:<FAC|REC>:<année>".
const FinanceCounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
export const FinanceCounter = model("FinanceCounter", FinanceCounterSchema);
