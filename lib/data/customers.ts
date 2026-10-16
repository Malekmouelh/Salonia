import "server-only";
import { Types } from "mongoose";
import { customerStats, getNoShowModel } from "@/lib/booking/noshow";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import type { BookingStatus } from "@/lib/enums";
import { Booking, Customer } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";

// F3.6 — Fiches clients avec historique des prestations.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function searchCustomers(user: CurrentUser, query: string, limit = 40) {
  if (!user.organization) return [];
  await connectDB();
  const q = query.trim();
  const filter: Record<string, unknown> = { organizationId: user.organization.id };
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ firstName: re }, { lastName: re }, { phone: new RegExp(escapeRegex(q.replace(/\s/g, ""))) }, { email: re }];
  }
  const customers = await Customer.find(filter).sort({ lastName: 1, firstName: 1 }).limit(limit).lean();
  const ids = customers.map((c) => String(c._id));
  const [stats, lastVisits] = await Promise.all([
    customerStats(user.organization.id, ids),
    Booking.aggregate<{ _id: Types.ObjectId; last: Date; spent: number }>([
      { $match: { customerId: { $in: ids.map((id) => new Types.ObjectId(id)) }, status: "COMPLETED" } },
      { $group: { _id: "$customerId", last: { $max: "$start" }, spent: { $sum: "$totalTnd" } } },
    ]),
  ]);
  const last = new Map(lastVisits.map((v) => [String(v._id), v]));
  return customers.map((c) => {
    const s = stats.get(String(c._id)) ?? { visits: 0, noShows: 0 };
    const l = last.get(String(c._id));
    return {
      id: String(c._id),
      name: `${c.firstName} ${c.lastName}`,
      phone: c.phone,
      email: c.email ?? null,
      visits: s.visits,
      noShows: s.noShows,
      lastVisit: l?.last.toISOString() ?? null,
      spentTnd: l?.spent ?? 0,
    };
  });
}

export async function getCustomerProfile(user: CurrentUser, customerId: string) {
  if (!user.organization || !Types.ObjectId.isValid(customerId)) return null;
  await connectDB();
  const customer = await Customer.findOne({ _id: customerId, organizationId: user.organization.id }).lean();
  if (!customer) return null;

  const [bookings, stats, model] = await Promise.all([
    Booking.find({ customerId: customer._id }).sort({ start: -1 }).limit(100).lean(),
    customerStats(user.organization.id, [customerId]),
    getNoShowModel(user.organization.id),
  ]);
  const centerIds = [...new Set(bookings.map((b) => String(b.centerId)))];
  const staffIds = [...new Set(bookings.map((b) => String(b.staffId)))];
  const [centers, staff] = await Promise.all([
    Center.find({ _id: { $in: centerIds } }).select("name").lean(),
    User.find({ _id: { $in: staffIds } }).select("firstName lastName").lean(),
  ]);
  const centerName = new Map(centers.map((c) => [String(c._id), c.name]));
  const staffName = new Map(staff.map((s) => [String(s._id), `${s.firstName} ${s.lastName}`]));

  const s = stats.get(customerId) ?? { visits: 0, noShows: 0 };
  const completed = bookings.filter((b) => b.status === "COMPLETED");
  const serviceCount = new Map<string, number>();
  for (const b of completed) for (const i of b.items) serviceCount.set(i.name, (serviceCount.get(i.name) ?? 0) + 1);
  const favoriteServices = [...serviceCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }));
  const favoriteStaffId = [...completed.reduce((m, b) => m.set(String(b.staffId), (m.get(String(b.staffId)) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  // Intervalle moyen entre deux visites (pour savoir quand relancer).
  const visitDates = completed.map((b) => b.start.getTime()).sort((a, b) => a - b);
  const gaps = visitDates.slice(1).map((t, i) => t - visitDates[i]);
  const avgIntervalDays = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 86_400_000) : null;

  return {
    id: customerId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email ?? null,
    notes: customer.notes ?? "",
    remindersConsent: customer.remindersConsent,
    createdAt: (customer.createdAt as Date).toISOString(),
    stats: {
      visits: s.visits,
      noShows: s.noShows,
      cancellations: bookings.filter((b) => b.status === "CANCELLED").length,
      spentTnd: completed.reduce((sum, b) => sum + b.totalTnd, 0),
      avgBasketTnd: completed.length ? Math.round(completed.reduce((sum, b) => sum + b.totalTnd, 0) / completed.length) : 0,
      avgIntervalDays,
      reliability: s.visits + s.noShows ? Math.round((s.visits / (s.visits + s.noShows)) * 100) : null,
      baseRate: model.baseRate,
    },
    favoriteServices,
    favoriteStaff: favoriteStaffId ? staffName.get(favoriteStaffId) ?? null : null,
    history: bookings.map((b) => ({
      id: String(b._id),
      start: b.start.toISOString(),
      status: b.status as BookingStatus,
      services: b.items.map((i) => i.name),
      packName: b.packName ?? null,
      totalTnd: b.totalTnd,
      center: centerName.get(String(b.centerId)) ?? "",
      staff: staffName.get(String(b.staffId)) ?? "",
    })),
  };
}

export type CustomerProfile = NonNullable<Awaited<ReturnType<typeof getCustomerProfile>>>;
