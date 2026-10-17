import "server-only";
import { Types } from "mongoose";
import { addDays, dayKey, fromLocal, parseDayKey, startOfLocalDay, startOfLocalMonth, toLocal } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type PaymentMethod } from "@/lib/enums";
import { Expense, Invoice, Payment } from "@/lib/models/finance";
import { EXPENSE_LABELS } from "./labels";
import { roundTnd } from "./money";
import { financeCenterIds } from "./service";
import {
  cashAnomalies,
  expenseAnomalies,
  forecastMonth,
  revenueAnomalies,
  type Anomaly,
  type DayPoint,
  type Forecast,
} from "./analytics";

// Requêtes financières contrôlées : toujours filtrées par organisation ET par centres autorisés.
// Utilisées par le tableau de bord, les exports et l'assistant IA (qui n'écrit jamais de requête lui-même).

const TZ = "Africa/Tunis";
const oid = (id: string) => new Types.ObjectId(id);

export type Scope = { organizationId: string; centerIds: string[]; centers: { id: string; name: string }[] };

// Périmètre de l'utilisateur, éventuellement réduit à un centre.
export function financeScope(user: CurrentUser, centerId?: string | null): Scope | null {
  if (!user.organization) return null;
  const allowed = financeCenterIds(user);
  if (allowed.length === 0) return null;
  const centerIds = centerId && centerId !== "all" ? allowed.filter((id) => id === centerId) : allowed;
  if (centerIds.length === 0) return null;
  return {
    organizationId: user.organization.id,
    centerIds,
    centers: user.organization.centers.filter((c) => centerIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name })),
  };
}

export type Range = { from: Date; to: Date; label: string; key: string };

export const PERIODS = [
  { key: "month", label: "Ce mois-ci" },
  { key: "last-month", label: "Mois dernier" },
  { key: "30d", label: "30 derniers jours" },
  { key: "90d", label: "90 derniers jours" },
  { key: "year", label: "Cette année" },
] as const;

// Période nommée, ou dates libres « YYYY-MM-DD » (fin incluse).
export function resolveRange(period?: string | null, fromKey?: string | null, toKey?: string | null, now = new Date()): Range {
  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  const from = fromKey ? parseDayKey(fromKey) : null;
  const to = toKey ? parseDayKey(toKey) : null;
  if (from && to && from <= to) return { from, to: addDays(to, 1), label: `${fromKey} → ${toKey}`, key: "custom" };
  const p = toLocal(now);
  switch (period) {
    case "last-month": {
      const start = fromLocal(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 1);
      return { from: start, to: startOfLocalMonth(now), label: "Mois dernier", key: "last-month" };
    }
    case "30d":
      return { from: addDays(tomorrow, -30), to: tomorrow, label: "30 derniers jours", key: "30d" };
    case "90d":
      return { from: addDays(tomorrow, -90), to: tomorrow, label: "90 derniers jours", key: "90d" };
    case "year":
      return { from: fromLocal(p.year, 1, 1), to: tomorrow, label: "Cette année", key: "year" };
    default:
      return { from: startOfLocalMonth(now), to: tomorrow, label: "Ce mois-ci", key: "month" };
  }
}

// Période précédente de même durée (comparaison « vs période précédente »).
export function previousRange(range: Range): Range {
  if (range.key === "month" || range.key === "last-month") {
    const p = toLocal(range.from);
    const start = fromLocal(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 1);
    // Mois en cours : mêmes jours du mois précédent (du 1er au même quantième) ; mois complet sinon.
    const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);
    const end = range.key === "month" ? addDays(start, days) : range.from;
    return { from: start, to: end > range.from ? range.from : end, label: "Période précédente", key: "previous" };
  }
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from, label: "Période précédente", key: "previous" };
}

function paymentMatch(scope: Scope, range: { from: Date; to: Date }) {
  return {
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to },
  };
}

function invoiceMatch(scope: Scope, range: { from: Date; to: Date }) {
  return {
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    status: { $ne: "CANCELLED" },
    issuedAt: { $gte: range.from, $lt: range.to },
  };
}

function expenseMatch(scope: Scope, range: { from: Date; to: Date }) {
  return {
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    date: { $gte: range.from, $lt: range.to },
  };
}

// Montant signé : les remboursements sont soustraits.
const signedAmount = { $cond: [{ $eq: ["$kind", "REFUND"] }, { $multiply: ["$amountTnd", -1] }, "$amountTnd"] };

export type Summary = {
  revenue: number;
  refunds: number;
  deposits: number;
  expenses: number;
  profit: number;
  margin: number | null;
  sales: number;
  averageBasket: number;
  subtotal: number;
  discounts: number;
  byMethod: { method: PaymentMethod; amount: number }[];
};

// F6.5 — Indicateurs d'une période : CA encaissé, dépenses, résultat, ventes, panier moyen.
export async function getSummary(scope: Scope, range: { from: Date; to: Date }): Promise<Summary> {
  await connectDB();
  const [payments, invoices, expenses] = await Promise.all([
    Payment.aggregate<{ _id: { method: PaymentMethod; kind: string }; amount: number }>([
      { $match: paymentMatch(scope, range) },
      { $group: { _id: { method: "$method", kind: "$kind" }, amount: { $sum: "$amountTnd" } } },
    ]),
    Invoice.aggregate<{ count: number; total: number; subtotal: number; discounts: number }>([
      { $match: invoiceMatch(scope, range) },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$totalTnd" }, subtotal: { $sum: "$subtotalTnd" }, discounts: { $sum: "$discountTnd" } } },
    ]),
    Expense.aggregate<{ total: number }>([{ $match: expenseMatch(scope, range) }, { $group: { _id: null, total: { $sum: "$amountTnd" } } }]),
  ]);
  const sum = (filter: (k: string) => boolean) => payments.filter((p) => filter(p._id.kind)).reduce((n, p) => n + p.amount, 0);
  const refunds = sum((k) => k === "REFUND");
  const revenue = roundTnd(sum((k) => k !== "REFUND") - refunds);
  const expenseTotal = roundTnd(expenses[0]?.total ?? 0);
  const inv = invoices[0] ?? { count: 0, total: 0, subtotal: 0, discounts: 0 };
  const methods = new Map<PaymentMethod, number>();
  for (const p of payments) methods.set(p._id.method, (methods.get(p._id.method) ?? 0) + (p._id.kind === "REFUND" ? -p.amount : p.amount));
  return {
    revenue,
    refunds: roundTnd(refunds),
    deposits: roundTnd(sum((k) => k === "DEPOSIT")),
    expenses: expenseTotal,
    profit: roundTnd(revenue - expenseTotal),
    margin: revenue > 0 ? (revenue - expenseTotal) / revenue : null,
    sales: inv.count,
    averageBasket: inv.count ? roundTnd(inv.total / inv.count) : 0,
    subtotal: roundTnd(inv.subtotal),
    discounts: roundTnd(inv.discounts),
    byMethod: [...methods].map(([method, amount]) => ({ method, amount: roundTnd(amount) })).sort((a, b) => b.amount - a.amount),
  };
}

// CA encaissé par jour (heure de Tunis), jours sans encaissement inclus (valeur 0).
export async function getDailyRevenue(scope: Scope, range: { from: Date; to: Date }, byCenter = false) {
  await connectDB();
  const rows = await Payment.aggregate<{ _id: { day: string; center: Types.ObjectId | null }; amount: number }>([
    { $match: paymentMatch(scope, range) },
    {
      $group: {
        _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt", timezone: TZ } }, center: byCenter ? "$centerId" : null },
        amount: { $sum: signedAmount },
      },
    },
  ]);
  const keys: { day: string; weekday: number }[] = [];
  for (let d = startOfLocalDay(range.from); d < range.to; d = addDays(d, 1)) keys.push({ day: dayKey(d), weekday: toLocal(d).weekday });
  const series = (center: string | null): DayPoint[] =>
    keys.map((k) => ({
      ...k,
      value: roundTnd(rows.filter((r) => r._id.day === k.day && (center === null || String(r._id.center) === center)).reduce((n, r) => n + r.amount, 0)),
    }));
  return { total: series(null), perCenter: byCenter ? new Map(scope.centerIds.map((id) => [id, series(id)])) : null };
}

export type BreakdownDimension = "service" | "center" | "staff" | "category" | "method" | "month";
export type BreakdownRow = { key: string; label: string; amount: number; count: number };

// Ventilation d'une période selon un axe (prestations, centres, praticiens, catégories de dépenses…).
export async function getBreakdown(scope: Scope, range: { from: Date; to: Date }, dimension: BreakdownDimension, limit = 10): Promise<BreakdownRow[]> {
  await connectDB();
  const names = new Map(scope.centers.map((c) => [c.id, c.name]));
  let rows: BreakdownRow[] = [];

  if (dimension === "service") {
    // F6.5 — Services les plus demandés : lignes de factures (rendez-vous et ventes directes).
    const agg = await Invoice.aggregate<{ _id: string; amount: number; count: number }>([
      { $match: invoiceMatch(scope, range) },
      { $unwind: "$lines" },
      { $group: { _id: "$lines.label", amount: { $sum: "$lines.totalTnd" }, count: { $sum: "$lines.quantity" } } },
    ]);
    rows = agg.map((r) => ({ key: r._id, label: r._id, amount: roundTnd(r.amount), count: r.count }));
  } else if (dimension === "center" || dimension === "method" || dimension === "month") {
    const field =
      dimension === "center" ? "$centerId" : dimension === "method" ? "$method" : { $dateToString: { format: "%Y-%m", date: "$paidAt", timezone: TZ } };
    const agg = await Payment.aggregate<{ _id: unknown; amount: number; count: number }>([
      { $match: paymentMatch(scope, range) },
      { $group: { _id: field, amount: { $sum: signedAmount }, count: { $sum: { $cond: [{ $eq: ["$kind", "REFUND"] }, 0, 1] } } } },
    ]);
    rows = agg.map((r) => {
      const key = String(r._id);
      return { key, label: dimension === "center" ? (names.get(key) ?? key) : key, amount: roundTnd(r.amount), count: r.count };
    });
    if (dimension === "month") return rows.sort((a, b) => a.key.localeCompare(b.key));
  } else if (dimension === "staff") {
    const agg = await Payment.aggregate<{ _id: Types.ObjectId; amount: number; count: number; firstName: string; lastName: string }>([
      { $match: { ...paymentMatch(scope, range), bookingId: { $ne: null } } },
      { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "booking", pipeline: [{ $project: { staffId: 1 } }] } },
      { $unwind: "$booking" },
      { $group: { _id: "$booking.staffId", amount: { $sum: signedAmount }, bookings: { $addToSet: "$bookingId" } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user", pipeline: [{ $project: { firstName: 1, lastName: 1 } }] } },
      { $unwind: "$user" },
      { $project: { amount: 1, count: { $size: "$bookings" }, firstName: "$user.firstName", lastName: "$user.lastName" } },
    ]);
    rows = agg.map((r) => ({ key: String(r._id), label: `${r.firstName} ${r.lastName}`, amount: roundTnd(r.amount), count: r.count }));
  } else if (dimension === "category") {
    const agg = await Expense.aggregate<{ _id: ExpenseCategory; amount: number; count: number }>([
      { $match: expenseMatch(scope, range) },
      { $group: { _id: "$category", amount: { $sum: "$amountTnd" }, count: { $sum: 1 } } },
    ]);
    rows = agg.map((r) => ({ key: r._id, label: EXPENSE_LABELS[r._id] ?? r._id, amount: roundTnd(r.amount), count: r.count }));
  }
  return rows.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export type CenterComparison = {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number | null;
  sales: number;
  averageBasket: number;
};

// F6.5 — Comparaison entre centres (vue consolidée du propriétaire).
export async function compareCenters(scope: Scope, range: { from: Date; to: Date }): Promise<CenterComparison[]> {
  return Promise.all(
    scope.centers.map(async (c) => {
      const s = await getSummary({ ...scope, centerIds: [c.id], centers: [c] }, range);
      return { id: c.id, name: c.name, revenue: s.revenue, expenses: s.expenses, profit: s.profit, margin: s.margin, sales: s.sales, averageBasket: s.averageBasket };
    }),
  ).then((rows) => rows.sort((a, b) => b.revenue - a.revenue));
}

// IA — Prévision du CA du mois en cours (moyenne par jour de la semaine sur 12 semaines + tendance).
export async function getForecast(scope: Scope, now = new Date()): Promise<Forecast> {
  const today = startOfLocalDay(now);
  const monthStart = startOfLocalMonth(now);
  const p = toLocal(now);
  const nextMonth = fromLocal(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 1 : p.month + 1, 1);
  const { total } = await getDailyRevenue(scope, { from: addDays(today, -84), to: today });
  const monthToDate = total.filter((d) => parseDayKey(d.day)! >= monthStart);
  const remaining: { day: string; weekday: number }[] = [];
  for (let d = today; d < nextMonth; d = addDays(d, 1)) remaining.push({ day: dayKey(d), weekday: toLocal(d).weekday });
  return forecastMonth(total, monthToDate, remaining);
}

// IA — Détection d'anomalies : CA journalier, dépenses, remboursements et remises.
export async function getAnomalies(scope: Scope, now = new Date()): Promise<Anomaly[]> {
  await connectDB();
  const today = startOfLocalDay(now);
  const names = new Map(scope.centers.map((c) => [c.id, c.name]));
  const { perCenter } = await getDailyRevenue(scope, { from: addDays(today, -70), to: today }, true);
  const anomalies: Anomaly[] = [];
  for (const [centerId, series] of perCenter!) {
    anomalies.push(...revenueAnomalies(series, { centerId, centerName: names.get(centerId) }));
  }

  // Dépenses : mois courant contre les 3 mois précédents (et 6 mois d'historique pour les dépenses isolées).
  const p = toLocal(now);
  const months = Array.from({ length: 7 }, (_, i) => {
    const m = p.month - i;
    const year = m <= 0 ? p.year - 1 : p.year;
    return `${year}-${String(((m - 1 + 12) % 12) + 1).padStart(2, "0")}`;
  });
  const [y, m] = months[6].split("-").map(Number);
  const expenses = await Expense.find(expenseMatch(scope, { from: fromLocal(y, m, 1), to: addDays(today, 1) }))
    .select("centerId category label amountTnd date")
    .lean();
  anomalies.push(
    ...expenseAnomalies(
      expenses.map((e) => ({ id: String(e._id), centerId: String(e.centerId), category: e.category, label: e.label, amountTnd: e.amountTnd, month: dayKey(e.date).slice(0, 7) })),
      months[0],
      months.slice(1, 4),
      { center: (id) => names.get(id) ?? "Centre", category: (c) => EXPENSE_LABELS[c as ExpenseCategory] ?? c },
    ),
  );

  // Caisse : 30 derniers jours, par centre.
  for (const c of scope.centers) {
    const s = await getSummary({ ...scope, centerIds: [c.id], centers: [c] }, { from: addDays(today, -29), to: addDays(today, 1) });
    anomalies.push(...cashAnomalies({ revenue: s.revenue + s.refunds, refunds: s.refunds, subtotal: s.subtotal, discounts: s.discounts, centerId: c.id, centerName: c.name }));
    if (s.revenue > 0 && s.profit < 0) {
      anomalies.push({
        id: `margin-${c.id}`,
        severity: "high",
        kind: "NEGATIVE_MARGIN",
        title: `Centre déficitaire sur 30 jours · ${c.name}`,
        detail: `Dépenses (${Math.round(s.expenses)} DT) supérieures au chiffre d'affaires encaissé (${Math.round(s.revenue)} DT).`,
        centerId: c.id,
      });
    }
  }
  const order = { high: 0, medium: 1 };
  return anomalies.sort((a, b) => order[a.severity] - order[b.severity] || (b.day ?? "").localeCompare(a.day ?? "")).slice(0, 12);
}

export const EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_LABELS[c] }));
