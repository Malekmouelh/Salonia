import "server-only";
import { Types } from "mongoose";
import { addDays, dayKey, parseDayKey, startOfLocalDay } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { EXPENSE_CATEGORIES, INVOICE_STATUSES, type BookingStatus, type ExpenseCategory, type InvoiceStatus, type PaymentKind, type PaymentMethod, type PaymentStatus } from "@/lib/enums";
import { Booking } from "@/lib/models/booking";
import { Expense, Invoice, Payment } from "@/lib/models/finance";
import { netPaid, roundTnd, sumTnd } from "@/lib/finance/money";
import { canViewFinance, financeCenterIds, hashPaymentToken } from "@/lib/finance/service";
import { Center, Organization } from "@/lib/models/core";

// Lectures du Module 6 pour les pages (données sérialisables).

const oid = (id: string) => new Types.ObjectId(id);

export function resolveFinanceCenter(user: CurrentUser, centerId?: string | null) {
  const allowed = financeCenterIds(user);
  if (centerId && allowed.includes(centerId)) return centerId;
  return allowed[0] ?? null;
}

export type CashDeskBooking = {
  id: string;
  start: string;
  status: BookingStatus;
  customer: string;
  phone: string;
  staff: string;
  services: string;
  totalTnd: number;
  paidTnd: number;
  dueTnd: number;
  invoice: { id: string; number: string } | null;
  pendingLink: boolean;
};

export type CashPayment = {
  id: string;
  paidAt: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amountTnd: number;
  receiptNumber: string | null;
  label: string;
  reference: string | null;
  refundable: number;
};

// F6.1 — Caisse d'un centre pour une journée : rendez-vous à encaisser, acomptes possibles
// sur les 7 prochains jours, impayés des 14 derniers jours, et journal des paiements du jour.
export async function getCashDesk(user: CurrentUser, centerId: string, dayParam?: string) {
  if (!user.organization) return null;
  await connectDB();
  const day = (dayParam && parseDayKey(dayParam)) || startOfLocalDay(new Date());
  const organizationId = user.organization.id;
  const staffOnly = user.role === "STAFF" ? { staffId: oid(user.id) } : {};

  const bookings = await Booking.find({
    organizationId,
    centerId,
    ...staffOnly,
    status: { $ne: "CANCELLED" },
    start: { $gte: addDays(day, -14), $lt: addDays(day, 8) },
  })
    .sort({ start: 1 })
    .populate<{ customerId: { firstName: string; lastName: string; phone: string } }>("customerId", "firstName lastName phone")
    .populate<{ staffId: { firstName: string } }>("staffId", "firstName")
    .lean();

  const ids = bookings.map((b) => b._id);
  const [payments, invoices] = await Promise.all([
    Payment.find({ bookingId: { $in: ids }, status: { $in: ["PAID", "PENDING"] } }).select("bookingId kind amountTnd status method").lean(),
    Invoice.find({ bookingId: { $in: ids }, status: { $ne: "CANCELLED" } }).select("bookingId number discountTnd").lean(),
  ]);

  const rows: CashDeskBooking[] = bookings.map((b) => {
    const mine = payments.filter((p) => String(p.bookingId) === String(b._id));
    const paid = netPaid(mine);
    const invoice = invoices.find((i) => String(i.bookingId) === String(b._id));
    return {
      id: String(b._id),
      start: b.start.toISOString(),
      status: b.status as BookingStatus,
      customer: `${b.customerId.firstName} ${b.customerId.lastName}`,
      phone: b.customerId.phone,
      staff: b.staffId.firstName,
      services: b.packName ?? b.items.map((i) => i.name).join(" + "),
      totalTnd: b.totalTnd,
      paidTnd: paid,
      dueTnd: invoice ? 0 : Math.max(0, roundTnd(b.totalTnd - paid)),
      invoice: invoice ? { id: String(invoice._id), number: invoice.number } : null,
      pendingLink: mine.some((p) => p.status === "PENDING" && p.method === "ONLINE"),
    };
  });

  const dayEnd = addDays(day, 1);
  const todayRows = rows.filter((r) => new Date(r.start) >= day && new Date(r.start) < dayEnd);
  // Impayés : prestations passées réalisées (ou non marquées) sans facture.
  const unpaid = rows.filter((r) => new Date(r.start) < day && r.dueTnd > 0 && r.status !== "NO_SHOW" && r.status !== "PENDING");
  const upcoming = rows.filter((r) => new Date(r.start) >= dayEnd && r.dueTnd > 0);

  const journal = await getCashJournal(user, centerId, day);
  return { day: dayKey(day), today: todayRows, unpaid, upcoming, ...journal };
}

// Journal de caisse du jour et totaux par moyen de paiement (clôture de caisse).
export async function getCashJournal(user: CurrentUser, centerId: string, day: Date) {
  const list = await Payment.find({
    organizationId: user.organization!.id,
    centerId,
    status: "PAID",
    paidAt: { $gte: day, $lt: addDays(day, 1) },
    ...(user.role === "STAFF" ? { receivedBy: user.id } : {}),
  })
    .sort({ paidAt: -1 })
    .populate<{ customerId: { firstName: string; lastName: string } | null }>("customerId", "firstName lastName")
    .lean();
  const refunded = await Payment.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { refundOf: { $in: list.map((p) => p._id) }, status: "PAID" } },
    { $group: { _id: "$refundOf", total: { $sum: "$amountTnd" } } },
  ]);
  const payments: CashPayment[] = list.map((p) => ({
    id: String(p._id),
    paidAt: p.paidAt!.toISOString(),
    kind: p.kind as PaymentKind,
    method: p.method as PaymentMethod,
    amountTnd: p.amountTnd,
    receiptNumber: p.receiptNumber ?? null,
    label: p.customerId ? `${p.customerId.firstName} ${p.customerId.lastName}` : "Client de passage",
    reference: p.reference ?? null,
    refundable: p.kind === "REFUND" ? 0 : roundTnd(p.amountTnd - (refunded.find((r) => String(r._id) === String(p._id))?.total ?? 0)),
  }));
  const totals = new Map<PaymentMethod, number>();
  for (const p of payments) totals.set(p.method, roundTnd((totals.get(p.method) ?? 0) + (p.kind === "REFUND" ? -p.amountTnd : p.amountTnd)));
  return {
    payments,
    totals: [...totals].map(([method, amount]) => ({ method, amount })),
    totalTnd: sumTnd([...totals.values()]),
  };
}

export type InvoiceRow = {
  id: string;
  number: string;
  issuedAt: string;
  center: string;
  customerName: string;
  totalTnd: number;
  paidTnd: number;
  discountTnd: number;
  status: InvoiceStatus;
  lines: string;
  cancelReason: string | null;
};

// F6.3 — Liste des factures (recherche par numéro ou client, filtre par statut et centre).
export async function listInvoices(
  user: CurrentUser,
  params: { q?: string; status?: string; centerId?: string; from?: Date; to?: Date; limit?: number },
): Promise<InvoiceRow[]> {
  if (!user.organization || !canViewFinance(user)) return [];
  await connectDB();
  const allowed = financeCenterIds(user);
  const centers = params.centerId && allowed.includes(params.centerId) ? [params.centerId] : allowed;
  const q = params.q?.trim();
  const escaped = q?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const list = await Invoice.find({
    organizationId: user.organization.id,
    centerId: { $in: centers },
    ...(params.status && (INVOICE_STATUSES as readonly string[]).includes(params.status) ? { status: params.status as InvoiceStatus } : {}),
    ...(params.from || params.to ? { issuedAt: { ...(params.from ? { $gte: params.from } : {}), ...(params.to ? { $lt: params.to } : {}) } } : {}),
    ...(escaped ? { $or: [{ number: { $regex: escaped, $options: "i" } }, { customerName: { $regex: escaped, $options: "i" } }] } : {}),
  })
    .sort({ issuedAt: -1 })
    .limit(params.limit ?? 100)
    .lean();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  return list.map((i) => ({
    id: String(i._id),
    number: i.number,
    issuedAt: i.issuedAt.toISOString(),
    center: names.get(String(i.centerId)) ?? "",
    customerName: i.customerName,
    totalTnd: i.totalTnd,
    paidTnd: i.paidTnd,
    discountTnd: i.discountTnd ?? 0,
    status: i.status as InvoiceStatus,
    lines: i.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.label}` : l.label)).join(", "),
    cancelReason: i.cancelReason ?? null,
  }));
}

export type ExpenseRowData = {
  id: string;
  date: string;
  centerId: string;
  center: string;
  category: ExpenseCategory;
  label: string;
  amountTnd: number;
  method: string;
  supplier: string | null;
};

// F6.4 — Dépenses d'une période.
export async function listExpenses(user: CurrentUser, params: { centerId?: string; from: Date; to: Date; category?: string }): Promise<ExpenseRowData[]> {
  if (!user.organization || !canViewFinance(user)) return [];
  await connectDB();
  const allowed = financeCenterIds(user);
  const centers = params.centerId && allowed.includes(params.centerId) ? [params.centerId] : allowed;
  const list = await Expense.find({
    organizationId: user.organization.id,
    centerId: { $in: centers },
    date: { $gte: params.from, $lt: params.to },
    ...(params.category && (EXPENSE_CATEGORIES as readonly string[]).includes(params.category) ? { category: params.category as ExpenseCategory } : {}),
  })
    .sort({ date: -1, createdAt: -1 })
    .limit(500)
    .lean();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  return list.map((e) => ({
    id: String(e._id),
    date: dayKey(e.date),
    centerId: String(e.centerId),
    center: names.get(String(e.centerId)) ?? "",
    category: e.category as ExpenseCategory,
    label: e.label,
    amountTnd: e.amountTnd,
    method: e.method ?? "CASH",
    supplier: e.supplier ?? null,
  }));
}

// Paiements d'une période (export CSV).
export async function listPayments(user: CurrentUser, params: { centerIds: string[]; from: Date; to: Date }) {
  if (!user.organization) return [];
  await connectDB();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  const list = await Payment.find({
    organizationId: user.organization.id,
    centerId: { $in: params.centerIds },
    status: "PAID",
    paidAt: { $gte: params.from, $lt: params.to },
  })
    .sort({ paidAt: 1 })
    .populate<{ customerId: { firstName: string; lastName: string } | null }>("customerId", "firstName lastName")
    .populate<{ invoiceId: { number: string } | null }>("invoiceId", "number")
    .lean();
  return list.map((p) => ({
    paidAt: p.paidAt!,
    receiptNumber: p.receiptNumber ?? "",
    invoiceNumber: p.invoiceId?.number ?? "",
    center: names.get(String(p.centerId)) ?? "",
    customer: p.customerId ? `${p.customerId.firstName} ${p.customerId.lastName}` : "Client de passage",
    kind: p.kind as PaymentKind,
    method: p.method as PaymentMethod,
    status: p.status as PaymentStatus,
    amountTnd: p.kind === "REFUND" ? -p.amountTnd : p.amountTnd,
    reference: p.reference ?? "",
  }));
}

// F6.2 — Page publique de paiement : résumé du lien (sans donnée sensible du salon).
export async function getPaymentLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  await connectDB();
  const payment = await Payment.findOne({ gatewayTokenHash: hashPaymentToken(token) }).lean();
  if (!payment || !payment.bookingId) return null;
  const [booking, org, center] = await Promise.all([
    Booking.findById(payment.bookingId).select("items packName start status").populate<{ customerId: { firstName: string } }>("customerId", "firstName").lean(),
    Organization.findById(payment.organizationId).select("name").lean(),
    Center.findById(payment.centerId).select("name").lean(),
  ]);
  if (!booking) return null;
  const expired = payment.status === "PENDING" && !!payment.gatewayExpiresAt && payment.gatewayExpiresAt < new Date();
  return {
    salon: org?.name ?? "Salon",
    center: center?.name ?? "",
    firstName: booking.customerId?.firstName ?? "",
    services: booking.packName ?? booking.items.map((i) => i.name).join(" + "),
    start: booking.start.toISOString(),
    kind: payment.kind as PaymentKind,
    amountTnd: payment.amountTnd,
    status: (expired ? "EXPIRED" : payment.status) as PaymentStatus | "EXPIRED",
    bookingCancelled: booking.status === "CANCELLED",
    receiptNumber: payment.receiptNumber ?? null,
    expiresAt: payment.gatewayExpiresAt?.toISOString() ?? null,
  };
}
