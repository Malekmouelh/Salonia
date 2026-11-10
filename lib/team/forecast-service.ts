import { Types } from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { adviseForecast, type ForecastAdvice } from "@/lib/ai/team-forecast";
import type { AskModel } from "@/lib/ai/team-performance";
import { addDays, dayKey, hoursForDay, startOfLocalDay, toLocal } from "@/lib/booking/time";
import { Booking } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";
import { StaffTimeOff } from "@/lib/models/team";
import { FORECAST_DAYS, REFERENCE_DAYS, buildForecast, type DayInput, type Forecast } from "./forecast";
import { teamCenters } from "./scope";

// F4 — Prévision de charge d'un centre (lecture seule). Droits vérifiés ici : propriétaire ou gérant, centre dans son périmètre.
// Les absences sont lues sans leur motif ; seules les dates comptent. Les horaires individuels ne sont pas pris en compte
// (enregistrement seul) : la capacité repose sur les horaires d'ouverture du centre.

export type ForecastResult = { ok: true; forecast: Forecast; advice: ForecastAdvice } | { ok: false; message: string };
const Input = z.object({ centerId: z.string().regex(/^[0-9a-f]{24}$/i) });
const MSG_DENIED = "Accès refusé à ce centre.";

export async function forecastCenterLoad(actor: CurrentUser, raw: unknown, options: { lang?: unknown; now?: Date; ask?: AskModel } = {}): Promise<ForecastResult> {
  const parsed = Input.safeParse(raw);
  const scope = teamCenters(actor);
  if (!actor.organization || !parsed.success || !scope.some((c) => c.id === parsed.data.centerId)) return { ok: false, message: MSG_DENIED };
  const centerId = parsed.data.centerId;
  const orgId = actor.organization.id;

  await connectDB();
  const center = await Center.findOne({ _id: centerId, organizationId: orgId }).select("openingHours").lean();
  if (!center) return { ok: false, message: MSG_DENIED };

  const now = options.now ?? new Date();
  const today = startOfLocalDay(now);
  const from = addDays(today, -REFERENCE_DAYS);
  const to = addDays(today, FORECAST_DAYS);

  const staff = await User.find({ organizationId: orgId, role: "STAFF", deactivatedAt: null, centerIds: new Types.ObjectId(centerId) }).select("_id").lean();
  const ids = staff.map((s) => s._id);
  const [bookings, timeOff] = await Promise.all([
    Booking.find({ organizationId: orgId, centerId, status: { $ne: "CANCELLED" }, start: { $gte: from, $lt: to } }).select("start end").lean(),
    // « reason » n'est jamais lu : un motif d'absence peut être sensible.
    ids.length ? StaffTimeOff.find({ organizationId: orgId, userId: { $in: ids }, start: { $lt: to }, end: { $gt: from } }).select("userId start end").lean() : [],
  ]);

  const days: DayInput[] = [];
  for (let i = -REFERENCE_DAYS; i < FORECAST_DAYS; i++) {
    const start = addDays(today, i);
    const end = addDays(start, 1);
    const hours = hoursForDay(center.openingHours as Record<string, string | null> | null, start);
    const openMinutes = hours ? hours.close - hours.open : 0;
    const booked = bookings.filter((b) => b.start >= start && b.start < end).reduce((n, b) => n + (b.end.getTime() - b.start.getTime()) / 60_000, 0);
    // Absent = une absence couvre au moins une partie du jour (journée complète ou plage horaire).
    const off = new Set(timeOff.filter((t) => t.start < end && t.end > start).map((t) => String(t.userId)));
    days.push({ date: dayKey(start), weekday: toLocal(start).weekday, openMinutes, staffTotal: ids.length, staffOff: off.size, bookedMinutes: Math.round(booked) });
  }

  const forecast = buildForecast(days, dayKey(today));
  const advice = await adviseForecast(forecast, options.lang === "ar" ? "ar" : "fr", options.ask);
  return { ok: true, forecast, advice };
}
