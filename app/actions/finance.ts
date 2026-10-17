"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Types } from "mongoose";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import { whatsappLink } from "@/lib/booking/messages";
import { parseDayKey } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/lib/enums";
import { financeAssistantReply, type FinanceReply } from "@/lib/finance/assistant";
import { getGateway } from "@/lib/finance/gateway";
import { roundTnd } from "@/lib/finance/money";
import { financeScope } from "@/lib/finance/reports";
import {
  FinanceError,
  assertCenter,
  canCollect,
  canViewFinance,
  cancelInvoice,
  checkoutBooking,
  confirmOnlinePayment,
  createPaymentLink,
  directSale,
  findPendingOnlinePayment,
  invoiceSettledBooking,
  loadBookingForCheckout,
  recordDeposit,
  refundPayment,
} from "@/lib/finance/service";
import { Customer } from "@/lib/models/booking";
import { Expense } from "@/lib/models/finance";

// Server Actions du Module 6. Entrées validées avec Zod, droits revérifiés dans lib/finance/service.ts.

export type FinanceResult = {
  ok?: true;
  error?: string;
  message?: string;
  receiptId?: string;
  invoiceId?: string;
  link?: string;
  whatsapp?: string;
};

const amount = z.coerce.number().finite().min(0).max(1_000_000).transform(roundTnd);
const TenderSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountTnd: amount,
  reference: z.string().trim().max(80).optional(),
});

const refresh = () => {
  revalidatePath("/dashboard/finances", "layout");
  revalidatePath("/dashboard/calendar");
};

async function run<T>(fn: () => Promise<T>): Promise<T | FinanceResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FinanceError) return { error: e.message };
    console.error("Module finances :", e);
    return { error: "Une erreur est survenue. Réessayez." };
  }
}

// ── F6.1 Acompte ──
const DepositSchema = z.object({ bookingId: z.string().min(1), tender: TenderSchema });

export async function recordDepositAction(input: z.input<typeof DepositSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user)) return { error: "Accès refusé." };
  const parsed = DepositSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  if (parsed.data.tender.method === "ONLINE") return { error: "Pour un paiement en ligne, envoyez un lien de paiement au client." };
  return run(async () => {
    const payment = await recordDeposit(user, parsed.data.bookingId, parsed.data.tender);
    await logEvent("PAYMENT_RECORDED", { userId: user.id, organizationId: user.organization?.id, detail: `${payment.receiptNumber} acompte ${payment.amountTnd} DT` });
    refresh();
    return { ok: true as const, message: `Acompte encaissé · reçu ${payment.receiptNumber}`, receiptId: String(payment._id) };
  });
}

// ── F6.1 Encaissement d'un rendez-vous ──
const CheckoutSchema = z.object({
  bookingId: z.string().min(1),
  tenders: z.array(TenderSchema).min(1, "Ajoutez un moyen de paiement.").max(4),
  discountTnd: amount.default(0),
});

export async function checkoutAction(input: z.input<typeof CheckoutSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user)) return { error: "Accès refusé." };
  const parsed = CheckoutSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  if (parsed.data.tenders.some((t) => t.method === "ONLINE")) return { error: "Pour un paiement en ligne, envoyez un lien de paiement au client." };
  return run(async () => {
    const { payments, invoice } = await checkoutBooking(user, parsed.data.bookingId, parsed.data.tenders, parsed.data.discountTnd);
    const organizationId = user.organization?.id;
    for (const p of payments) {
      await logEvent("PAYMENT_RECORDED", { userId: user.id, organizationId, detail: `${p.receiptNumber} ${p.method} ${p.amountTnd} DT` });
    }
    if (invoice) await logEvent("INVOICE_ISSUED", { userId: user.id, organizationId, detail: `${invoice.number} ${invoice.totalTnd} DT` });
    refresh();
    return {
      ok: true as const,
      message: invoice ? `Encaissé · facture ${invoice.number} émise` : `Paiement partiel enregistré · reçu ${payments[0]?.receiptNumber}`,
      invoiceId: invoice ? String(invoice._id) : undefined,
      receiptId: payments[0] ? String(payments[0]._id) : undefined,
    };
  });
}

export async function invoiceBookingAction(bookingId: string): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user)) return { error: "Accès refusé." };
  return run(async () => {
    const invoice = await invoiceSettledBooking(user, bookingId);
    await logEvent("INVOICE_ISSUED", { userId: user.id, organizationId: user.organization?.id, detail: `${invoice.number} ${invoice.totalTnd} DT` });
    refresh();
    return { ok: true as const, message: `Facture ${invoice.number} émise`, invoiceId: String(invoice._id) };
  });
}

// ── F6.1 Vente directe ──
const SaleSchema = z.object({
  centerId: z.string().min(1),
  customerId: z.string().optional(),
  customerName: z.string().trim().max(80).optional(),
  lines: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Libellé manquant.").max(120),
        quantity: z.coerce.number().int().min(1).max(99),
        unitPriceTnd: amount,
        serviceId: z.string().optional().nullable(),
      }),
    )
    .min(1, "Ajoutez au moins une prestation.")
    .max(30),
  tenders: z.array(TenderSchema).min(1).max(4),
  discountTnd: amount.default(0),
});

export async function directSaleAction(input: z.input<typeof SaleSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canViewFinance(user)) return { error: "La vente directe est réservée au gérant et au propriétaire." };
  const parsed = SaleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  if (parsed.data.tenders.some((t) => t.method === "ONLINE")) return { error: "Moyen de paiement non disponible au comptoir." };
  return run(async () => {
    const { invoice, payments } = await directSale(user, parsed.data);
    const organizationId = user.organization?.id;
    for (const p of payments) await logEvent("PAYMENT_RECORDED", { userId: user.id, organizationId, detail: `${p.receiptNumber} ${p.method} ${p.amountTnd} DT` });
    await logEvent("INVOICE_ISSUED", { userId: user.id, organizationId, detail: `${invoice.number} ${invoice.totalTnd} DT` });
    refresh();
    return { ok: true as const, message: `Vente enregistrée · facture ${invoice.number}`, invoiceId: String(invoice._id) };
  });
}

// ── Remboursement et annulation ──
const RefundSchema = z.object({ paymentId: z.string().min(1), amountTnd: amount, reason: z.string().trim().min(3, "Indiquez le motif.").max(200) });

export async function refundAction(input: z.input<typeof RefundSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  const parsed = RefundSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return run(async () => {
    const refund = await refundPayment(user, parsed.data.paymentId, parsed.data.amountTnd, parsed.data.reason);
    await logEvent("PAYMENT_REFUNDED", { userId: user.id, organizationId: user.organization?.id, detail: `${refund.receiptNumber} ${refund.amountTnd} DT · ${parsed.data.reason}` });
    refresh();
    return { ok: true as const, message: `Remboursement enregistré · ${refund.receiptNumber}`, receiptId: String(refund._id) };
  });
}

const CancelInvoiceSchema = z.object({ invoiceId: z.string().min(1), reason: z.string().trim().min(3, "Indiquez le motif.").max(200) });

export async function cancelInvoiceAction(input: z.input<typeof CancelInvoiceSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  const parsed = CancelInvoiceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return run(async () => {
    const invoice = await cancelInvoice(user, parsed.data.invoiceId, parsed.data.reason);
    await logEvent("INVOICE_CANCELLED", { userId: user.id, organizationId: user.organization?.id, detail: `${invoice.number} · ${parsed.data.reason}` });
    refresh();
    return { ok: true as const, message: `Facture ${invoice.number} annulée` };
  });
}

// ── F6.2 Lien de paiement en ligne ──
async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const LinkSchema = z.object({ bookingId: z.string().min(1), amountTnd: amount, kind: z.enum(["DEPOSIT", "PAYMENT"]) });

export async function createPaymentLinkAction(input: z.input<typeof LinkSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user) || !user.organization) return { error: "Accès refusé." };
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return run(async () => {
    const booking = await loadBookingForCheckout(user, parsed.data.bookingId);
    if (!booking) throw new FinanceError("Rendez-vous introuvable.");
    const token = await createPaymentLink(user, parsed.data.bookingId, parsed.data.amountTnd, parsed.data.kind);
    const link = `${await baseUrl()}/paiement/${token}`;
    const customer = await Customer.findById(booking.customerId).select("firstName phone").lean();
    const message =
      `Bonjour ${customer?.firstName ?? ""}, voici le lien pour régler ${parsed.data.kind === "DEPOSIT" ? "l'acompte de" : ""} ` +
      `${parsed.data.amountTnd} DT pour votre rendez-vous chez ${user.organization!.name} le ${fmtDay(booking.start)} à ${fmtTime(booking.start)} : ${link}`;
    refresh();
    return {
      ok: true as const,
      message: "Lien de paiement créé (valable 48 h).",
      link,
      whatsapp: customer?.phone ? whatsappLink(customer.phone, message.replace(/\s+/g, " ")) : undefined,
    };
  });
}

// Paiement par le client sur la page publique /paiement/[jeton] (aucune session requise).
const CardSchema = z.object({
  token: z.string().min(10).max(100),
  cardNumber: z.string().trim().min(12).max(23),
  expiry: z.string().trim().max(7),
  cvc: z.string().trim().max(4),
  holder: z.string().trim().min(2, "Nom du titulaire manquant.").max(80),
});

export async function payOnlineAction(input: z.input<typeof CardSchema>): Promise<FinanceResult> {
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const { token, cardNumber, expiry, cvc } = parsed.data;
  try {
    const pending = await findPendingOnlinePayment(token);
    if (!pending) return { error: "Lien de paiement invalide." };
    if (pending.status === "PAID") return { ok: true, message: "Ce paiement a déjà été effectué." };
    if (pending.status !== "PENDING" || (pending.gatewayExpiresAt && pending.gatewayExpiresAt < new Date())) {
      return { error: "Ce lien de paiement a expiré. Demandez-en un nouveau au salon." };
    }
    const result = await getGateway().authorize({ amountTnd: pending.amountTnd, cardNumber, expiry, cvc });
    // Un refus ne grille pas le lien : le client peut réessayer avec une autre carte.
    if (!result.ok) return { error: result.error };
    const payment = await confirmOnlinePayment(token, result.reference);
    await logEvent("PAYMENT_RECORDED", { organizationId: String(payment.organizationId), detail: `${payment.receiptNumber} en ligne ${payment.amountTnd} DT (${result.reference})` });
    refresh();
    return { ok: true, message: `Paiement accepté · reçu ${payment.receiptNumber}` };
  } catch (e) {
    if (e instanceof FinanceError) return { error: e.message };
    console.error("Paiement en ligne :", e);
    return { error: "Le paiement n'a pas pu aboutir. Réessayez." };
  }
}

// ── F6.4 Dépenses ──
const ExpenseSchema = z.object({
  id: z.string().optional(),
  centerId: z.string().min(1, "Choisissez un centre."),
  category: z.enum(EXPENSE_CATEGORIES),
  label: z.string().trim().min(2, "Libellé trop court.").max(120),
  amountTnd: amount.refine((v) => v > 0, "Le montant doit être positif."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  method: z.enum([...PAYMENT_METHODS, "TRANSFER", "CHECK"]).default("CASH"),
  supplier: z.string().trim().max(80).optional(),
});

export async function saveExpenseAction(input: z.input<typeof ExpenseSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization) return { error: "Accès refusé." };
  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const d = parsed.data;
  return run(async () => {
    assertCenter(user, d.centerId);
    // Le gérant ne saisit pas les salaires : donnée réservée au propriétaire.
    if (d.category === "SALARIES" && user.role !== "OWNER") throw new FinanceError("Les salaires sont gérés par le propriétaire.");
    const date = parseDayKey(d.date)!;
    if (date > new Date(Date.now() + 31 * 86_400_000)) throw new FinanceError("Date trop lointaine.");
    await connectDB();
    const data = { centerId: d.centerId, category: d.category, label: d.label, amountTnd: d.amountTnd, date, method: d.method, supplier: d.supplier || undefined };
    if (d.id) {
      if (!Types.ObjectId.isValid(d.id)) throw new FinanceError("Dépense introuvable.");
      const existing = await Expense.findOne({ _id: d.id, organizationId: user.organization!.id });
      if (!existing) throw new FinanceError("Dépense introuvable.");
      assertCenter(user, String(existing.centerId));
      if (existing.category === "SALARIES" && user.role !== "OWNER") throw new FinanceError("Les salaires sont gérés par le propriétaire.");
      existing.set(data);
      await existing.save();
      refresh();
      return { ok: true as const, message: "Dépense modifiée." };
    }
    const expense = await Expense.create({ ...data, organizationId: user.organization!.id, createdBy: user.id });
    await logEvent("EXPENSE_CREATED", { userId: user.id, organizationId: user.organization!.id, detail: `${expense.label} ${expense.amountTnd} DT` });
    refresh();
    return { ok: true as const, message: "Dépense enregistrée." };
  });
}

export async function deleteExpenseAction(id: string): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization || !Types.ObjectId.isValid(id)) return { error: "Accès refusé." };
  return run(async () => {
    await connectDB();
    const expense = await Expense.findOne({ _id: id, organizationId: user.organization!.id });
    if (!expense) throw new FinanceError("Dépense introuvable.");
    assertCenter(user, String(expense.centerId));
    if (expense.category === "SALARIES" && user.role !== "OWNER") throw new FinanceError("Les salaires sont gérés par le propriétaire.");
    await expense.deleteOne();
    await logEvent("EXPENSE_DELETED", { userId: user.id, organizationId: user.organization!.id, detail: `${expense.label} ${expense.amountTnd} DT` });
    refresh();
    return { ok: true as const, message: "Dépense supprimée." };
  });
}


// ── IA : assistant d'analyse financière ──
const ChatSchema = z.object({
  centerId: z.string().optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(12),
});

const MAX_QUESTIONS_PER_HOUR = 30;
const questions = new Map<string, number[]>();

function allowQuestion(userId: string) {
  const now = Date.now();
  const recent = (questions.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_QUESTIONS_PER_HOUR) return false;
  questions.set(userId, [...recent, now]);
  return true;
}

export async function askFinanceAssistantAction(input: z.input<typeof ChatSchema>): Promise<FinanceReply | { error: string }> {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization) return { error: "Accès refusé." };
  const parsed = ChatSchema.safeParse(input);
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return { error: "Question invalide." };
  const scope = financeScope(user, parsed.data.centerId);
  if (!scope) return { error: "Aucun centre accessible." };
  if (!allowQuestion(user.id)) return { error: "Limite atteinte : réessayez dans une heure." };
  try {
    return await financeAssistantReply(scope, user.organization.name, parsed.data.messages.slice(-10));
  } catch (e) {
    console.error("Assistant financier :", e);
    return { error: "L'assistant est momentanément indisponible." };
  }
}
