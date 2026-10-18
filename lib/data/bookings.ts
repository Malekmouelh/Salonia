import "server-only";
import { Types } from "mongoose";
import { getPractitioners } from "@/lib/booking/availability";
import { resolvePrice as resolveCenterPrice } from "@/lib/booking/create";
import { customerStats, getNoShowModel, scoreBooking } from "@/lib/booking/noshow";
import {
  addDays,
  addMinutes,
  dayKey,
  hoursForDay,
  overlaps,
  parseDayKey,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
} from "@/lib/booking/time";
import type {
  CalendarData,
  CalendarView,
  FillSuggestion,
  PackOption,
  PractitionerInfo,
  ServiceOption,
} from "@/lib/booking/types";
import { connectDB } from "@/lib/db";
import { accessibleCenterIds, type CurrentUser } from "@/lib/dal";
import type { BlockKind, BookingSource, BookingStatus } from "@/lib/enums";
import { AvailabilityBlock, Booking, Customer, WaitlistEntry } from "@/lib/models/booking";
import { Pack, Service } from "@/lib/models/catalog";
import { Center } from "@/lib/models/core";

// Couleur stable par praticien dans le calendrier.
const COLORS = ["#f7c6d0", "#c9a0dc", "#f3d9a4", "#9fd8cb", "#e8b4a0", "#a8c5f0", "#f0a8a8", "#d4e09b"];

export function canManageCenters(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}

// Vérifie que le centre appartient à l'organisation et que l'utilisateur y a accès.
export function resolveCenterId(user: CurrentUser, centerId?: string | null) {
  const allowed = accessibleCenterIds(user);
  if (centerId && allowed.includes(centerId)) return centerId;
  return allowed[0] ?? null;
}

function rangeFor(view: CalendarView, ref: Date) {
  if (view === "day") return { start: startOfLocalDay(ref), end: addDays(startOfLocalDay(ref), 1) };
  if (view === "week") {
    const start = startOfLocalWeek(ref);
    return { start, end: addDays(start, 7) };
  }
  // Mois : grille complète du lundi précédant le 1er au dimanche suivant la fin du mois.
  const first = startOfLocalMonth(ref);
  const start = startOfLocalWeek(first);
  const nextMonth = startOfLocalMonth(addDays(first, 32));
  const end = addDays(startOfLocalWeek(addDays(nextMonth, -1)), 7);
  return { start, end };
}

export async function getCalendarData(
  user: CurrentUser,
  params: { view?: string; date?: string; centerId?: string; staffId?: string },
): Promise<CalendarData | null> {
  const centerId = resolveCenterId(user, params.centerId);
  if (!centerId || !user.organization) return null;
  await connectDB();

  const view: CalendarView = params.view === "day" || params.view === "month" ? params.view : "week";
  const ref = (params.date && parseDayKey(params.date)) || startOfLocalDay(new Date());
  const { start, end } = rangeFor(view, ref);
  const organizationId = user.organization.id;

  const [center, practitionersRaw, model] = await Promise.all([
    Center.findOne({ _id: centerId, organizationId }).select("name openingHours").lean(),
    getPractitioners(organizationId, centerId),
    getNoShowModel(organizationId),
  ]);
  if (!center) return null;

  const practitioners: PractitionerInfo[] = practitionersRaw.map((p, i) => ({ ...p, color: COLORS[i % COLORS.length] }));
  // Le staff ne voit que son propre planning (cahier des charges §4).
  const staffFilter =
    user.role === "STAFF" ? user.id : params.staffId && practitioners.some((p) => p.id === params.staffId) ? params.staffId : null;

  const [bookings, blocks] = await Promise.all([
    Booking.find({
      organizationId,
      centerId,
      start: { $lt: end },
      end: { $gt: start },
      ...(staffFilter ? { staffId: staffFilter } : {}),
    })
      .sort({ start: 1 })
      .populate<{ customerId: { _id: Types.ObjectId; firstName: string; lastName: string; phone: string; remindersConsent: boolean } }>(
        "customerId",
        "firstName lastName phone remindersConsent",
      )
      .lean(),
    AvailabilityBlock.find({
      organizationId,
      centerId,
      start: { $lt: end },
      end: { $gt: start },
      ...(staffFilter ? { $or: [{ staffId: null }, { staffId: staffFilter }] } : {}),
    }).lean(),
  ]);

  // Score de risque d'absence pour les rendez-vous à venir encore actifs.
  const now = new Date();
  const upcoming = bookings.filter((b) => b.start > now && (b.status === "CONFIRMED" || b.status === "PENDING"));
  const stats = await customerStats(organizationId, [...new Set(upcoming.map((b) => String(b.customerId._id)))]);

  return {
    view,
    date: dayKey(ref),
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    center: {
      id: centerId,
      name: center.name,
      openingHours: (center.openingHours as Record<string, string | null> | null) ?? null,
    },
    centers: (user.organization.centers ?? [])
      .filter((c) => accessibleCenterIds(user).includes(c.id))
      .map((c) => ({ id: c.id, name: c.name })),
    practitioners,
    staffFilter,
    canManage: canManageCenters(user),
    model: { source: model.source, trainedOn: model.trainedOn, accuracy: model.accuracy, baseRate: model.baseRate },
    blocks: blocks.map((b) => ({
      id: String(b._id),
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      kind: b.kind as BlockKind,
      staffId: b.staffId ? String(b.staffId) : null,
      reason: b.reason ?? null,
    })),
    bookings: bookings.map((b) => {
      const c = b.customerId;
      const isUpcoming = b.start > now && (b.status === "CONFIRMED" || b.status === "PENDING");
      const s = stats.get(String(c._id)) ?? { visits: 0, noShows: 0 };
      return {
        id: String(b._id),
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        status: b.status as BookingStatus,
        source: b.source as BookingSource,
        staffId: String(b.staffId),
        customer: { id: String(c._id), name: `${c.firstName} ${c.lastName}`, phone: c.phone, remindersConsent: c.remindersConsent },
        services: b.items.map((i) => i.name),
        packName: b.packName ?? null,
        totalTnd: b.totalTnd,
        notes: b.notes ?? null,
        reminderSentAt: b.reminderSentAt?.toISOString() ?? null,
        risk: isUpcoming
          ? scoreBooking(model, {
              start: b.start,
              createdAt: b.createdAt as Date,
              source: b.source,
              totalTnd: b.totalTnd,
              customer: { ...s, remindersConsent: c.remindersConsent },
            })
          : null,
      };
    }),
  };
}

// Catalogue réservable dans un centre (services actifs et packs).
export async function getCatalog(organizationId: string, centerId?: string | null) {
  await connectDB();
  const centerFilter = centerId
    ? { $or: [{ centerIds: { $size: 0 } }, { centerIds: new Types.ObjectId(centerId) }] }
    : {};
  const [services, packs] = await Promise.all([
    Service.find({ organizationId, active: true, ...centerFilter }).sort({ sortOrder: 1, category: 1, name: 1 }).lean(),
    Pack.find({ organizationId, active: true, ...centerFilter })
      .populate<{ serviceIds: { _id: Types.ObjectId; name: string; durationMinutes: number; priceTnd: number }[] }>("serviceIds", "name durationMinutes priceTnd")
      .sort({ sortOrder: 1, name: 1 })
      .lean(),
  ]);

  const resolvePrice = (item: Parameters<typeof resolveCenterPrice>[0]) => resolveCenterPrice(item, centerId);

  const serviceOptions: ServiceOption[] = services.map((s) => ({
    id: String(s._id),
    name: s.name,
    category: s.category,
    durationMinutes: s.durationMinutes,
    priceTnd: resolvePrice(s),
    description: s.description ?? "",
    photos: (s.photos ?? []).map(String),
    options: (s.options ?? []).map((o) => ({
      name: o.name,
      values: (o.values ?? []).map((v) => ({
        label: v.label,
        extraPriceTnd: v.extraPriceTnd ?? 0,
        extraDurationMinutes: v.extraDurationMinutes ?? 0,
      })),
    })),
    centerPrices: (s.centerPrices ?? []).map((cp) => ({ centerId: String(cp.centerId), priceTnd: cp.priceTnd })),
  }));

  const packOptions: PackOption[] = packs.map((p) => {
    const validServices = (p.serviceIds ?? []).filter((s) => s && s._id);
    const packPrice = resolvePrice(p);
    const regularTotal = validServices.reduce((sum, s) => sum + (s.priceTnd || 0), 0);
    const savingsTnd = Math.max(0, regularTotal - packPrice);
    const savingsPercent = regularTotal > 0 ? Math.round((savingsTnd / regularTotal) * 100) : 0;
    return {
      id: String(p._id),
      name: p.name,
      priceTnd: packPrice,
      durationMinutes: validServices.reduce((sum, s) => sum + s.durationMinutes, 0),
      serviceIds: validServices.map((s) => String(s._id)),
      serviceNames: validServices.map((s) => s.name),
      description: p.description ?? "",
      photos: (p.photos ?? []).map(String),
      savingsTnd: savingsTnd > 0 ? savingsTnd : undefined,
      savingsPercent: savingsPercent > 0 ? savingsPercent : undefined,
      centerPrices: (p.centerPrices ?? []).map((cp) => ({ centerId: String(cp.centerId), priceTnd: cp.priceTnd })),
    };
  });

  return { services: serviceOptions, packs: packOptions };
}


// IA — Créneaux à remplir : trous d'au moins 45 min sur les 7 prochains jours,
// associés aux clients de la liste d'attente et aux habitués qui n'ont pas reréservé.
export async function getFillSuggestions(user: CurrentUser, centerId: string): Promise<FillSuggestion[]> {
  if (!user.organization) return [];
  await connectDB();
  const organizationId = user.organization.id;
  const now = new Date();
  const from = startOfLocalDay(now);
  const to = addDays(from, 7);

  const [center, practitioners, bookings, blocks, waitlist] = await Promise.all([
    Center.findOne({ _id: centerId, organizationId }).select("openingHours").lean(),
    getPractitioners(organizationId, centerId),
    Booking.find({ centerId, status: { $ne: "CANCELLED" }, start: { $lt: to }, end: { $gt: from } }).select("staffId start end").lean(),
    AvailabilityBlock.find({ centerId, start: { $lt: to }, end: { $gt: from } }).select("staffId start end").lean(),
    WaitlistEntry.find({ centerId, status: "WAITING", desiredDate: { $gte: from, $lt: to } })
      .populate<{ customerId: { _id: Types.ObjectId; firstName: string; lastName: string; phone: string } }>("customerId", "firstName lastName phone")
      .populate<{ serviceId: { name: string; durationMinutes: number } }>("serviceId", "name durationMinutes")
      .lean(),
  ]);
  if (!center) return [];

  // Habitués : au moins 3 visites, dernière visite il y a plus de 5 semaines, aucun RDV à venir.
  const regulars = await Booking.aggregate<{ _id: Types.ObjectId; last: Date; visits: number }>([
    { $match: { organizationId: new Types.ObjectId(organizationId), centerId: new Types.ObjectId(centerId), status: "COMPLETED" } },
    { $group: { _id: "$customerId", last: { $max: "$start" }, visits: { $sum: 1 } } },
    { $match: { visits: { $gte: 3 }, last: { $lt: addDays(now, -35) } } },
    { $sort: { visits: -1 } },
    { $limit: 12 },
  ]);
  const withFuture = new Set(
    (await Booking.distinct("customerId", { customerId: { $in: regulars.map((r) => r._id) }, start: { $gt: now }, status: { $ne: "CANCELLED" } })).map(String),
  );
  const regularCustomers = await Customer.find({ _id: { $in: regulars.filter((r) => !withFuture.has(String(r._id))).map((r) => r._id) } })
    .select("firstName lastName phone")
    .lean();

  const suggestions: FillSuggestion[] = [];
  for (let d = 0; d < 7 && suggestions.length < 6; d++) {
    const day = addDays(from, d);
    const hours = hoursForDay(center.openingHours as Record<string, string | null> | null, day);
    if (!hours) continue;
    for (const p of practitioners) {
      const busy = [...bookings, ...blocks]
        .filter((b) => !b.staffId || String(b.staffId) === p.id)
        .map((b) => ({ start: b.start, end: b.end }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      // Parcours de la journée par pas de 15 min pour trouver le premier trou d'au moins 45 min.
      let gapStart: Date | null = null;
      for (let m = hours.open; m <= hours.close; m += 15) {
        const t = addMinutes(day, m);
        const free = m < hours.close && t > addMinutes(now, 60) && !busy.some((b) => overlaps(t, addMinutes(t, 15), b.start, b.end));
        if (free && !gapStart) gapStart = t;
        if ((!free || m === hours.close) && gapStart) {
          const minutes = (t.getTime() - gapStart.getTime()) / 60000;
          if (minutes >= 45) {
            const key = dayKey(day);
            const candidates = [
              ...waitlist
                .filter((w) => dayKey(w.desiredDate) === key && (!w.staffId || String(w.staffId) === p.id) && w.serviceId.durationMinutes <= minutes)
                .map((w) => ({
                  customerId: String(w.customerId._id),
                  name: `${w.customerId.firstName} ${w.customerId.lastName}`,
                  phone: w.customerId.phone,
                  reason: `Liste d'attente · ${w.serviceId.name}`,
                  waitlistId: String(w._id),
                })),
              ...regularCustomers.slice(0, 2).map((c) => ({
                customerId: String(c._id),
                name: `${c.firstName} ${c.lastName}`,
                phone: c.phone,
                reason: "Habitué(e) sans rendez-vous depuis 5 semaines",
              })),
            ];
            suggestions.push({
              day: key,
              start: gapStart.toISOString(),
              end: t.toISOString(),
              staffId: p.id,
              staffName: `${p.firstName} ${p.lastName}`,
              minutes,
              candidates,
            });
            break; // un trou par praticien et par jour suffit pour la liste
          }
          gapStart = null;
        }
      }
      if (suggestions.length >= 6) break;
    }
  }
  return suggestions;
}

export async function getWaitlist(user: CurrentUser, centerId: string) {
  if (!user.organization) return [];
  await connectDB();
  const entries = await WaitlistEntry.find({ organizationId: user.organization.id, centerId, status: { $in: ["WAITING", "OFFERED"] } })
    .sort({ desiredDate: 1 })
    .populate<{ customerId: { _id: Types.ObjectId; firstName: string; lastName: string; phone: string } }>("customerId", "firstName lastName phone")
    .populate<{ serviceId: { _id: Types.ObjectId; name: string } }>("serviceId", "name")
    .lean();
  return entries.map((e) => ({
    id: String(e._id),
    day: dayKey(e.desiredDate),
    status: e.status as "WAITING" | "OFFERED",
    customer: { id: String(e.customerId._id), name: `${e.customerId.firstName} ${e.customerId.lastName}`, phone: e.customerId.phone },
    service: e.serviceId.name,
  }));
}

// Tableau de bord : rendez-vous du jour (le staff ne voit que les siens) et chiffres clés.
export async function getTodayOverview(user: CurrentUser) {
  const centerIds = accessibleCenterIds(user);
  if (!user.organization || centerIds.length === 0) return null;
  await connectDB();
  const now = new Date();
  const start = startOfLocalDay(now);
  const end = addDays(start, 1);
  const scope = {
    organizationId: user.organization.id,
    centerId: { $in: centerIds.map((id) => new Types.ObjectId(id)) },
    ...(user.role === "STAFF" ? { staffId: new Types.ObjectId(user.id) } : {}),
  };
  const [today, weekCount, online] = await Promise.all([
    Booking.find({ ...scope, start: { $gte: start, $lt: end }, status: { $ne: "CANCELLED" } })
      .sort({ start: 1 })
      .populate<{ customerId: { firstName: string; lastName: string } }>("customerId", "firstName lastName")
      .populate<{ staffId: { firstName: string } }>("staffId", "firstName")
      .populate<{ centerId: { name: string } }>("centerId", "name")
      .lean(),
    Booking.countDocuments({ ...scope, start: { $gte: start, $lt: addDays(start, 7) }, status: { $ne: "CANCELLED" } }),
    Booking.countDocuments({ ...scope, createdAt: { $gte: addDays(start, -7) }, source: { $in: ["ONLINE", "CHATBOT"] } }),
  ]);
  return {
    count: today.length,
    revenue: today.reduce((n, b) => n + b.totalTnd, 0),
    weekCount,
    onlineLast7: online,
    next: today
      .filter((b) => b.end > now)
      .slice(0, 5)
      .map((b) => ({
        id: String(b._id),
        start: b.start.toISOString(),
        customer: `${b.customerId.firstName} ${b.customerId.lastName}`,
        services: b.packName ?? b.items.map((i) => i.name).join(" + "),
        staff: b.staffId.firstName,
        center: b.centerId.name,
        status: b.status as BookingStatus,
      })),
  };
}

// Compte client : ses rendez-vous, retrouvés par sa fiche client (même e-mail ou téléphone).
export async function getMyBookings(user: CurrentUser) {
  if (!user.organization) return [];
  await connectDB();
  const customers = await Customer.find({
    organizationId: user.organization.id,
    $or: [{ userId: user.id }, ...(user.email ? [{ email: user.email }] : []), ...(user.phone ? [{ phone: user.phone }] : [])],
  })
    .select("_id")
    .lean();
  if (customers.length === 0) return [];
  const bookings = await Booking.find({ customerId: { $in: customers.map((c) => c._id) } })
    .sort({ start: -1 })
    .limit(20)
    .populate<{ centerId: { name: string } }>("centerId", "name")
    .lean();
  return bookings.map((b) => ({
    id: String(b._id),
    start: b.start.toISOString(),
    status: b.status as BookingStatus,
    services: b.packName ?? b.items.map((i) => i.name).join(" + "),
    center: b.centerId.name,
    totalTnd: b.totalTnd,
  }));
}
