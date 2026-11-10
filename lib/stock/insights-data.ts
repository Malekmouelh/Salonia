import { Types } from "mongoose";
import { dayKey } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import { StockMovement } from "@/lib/models/stock";
import { getStockForecast } from "./forecast-data";
import { addDaysToKey } from "./forecast";
import { DEFAULT_WINDOW, WINDOWS, buildInsights, type InsightsReport, type PairInput, type RiskInput } from "./insights";
import { stockCenters, stockScope } from "./scope";
import { SIMULATION_NOTE } from "./simulate-history";
import { guard, listStockLevels, type StockActor, type StockResult } from "./service";

// Module 5 (IA) — Lecture des données de l'analyse de consommation, avec les droits du stock : un propriétaire voit tous ses centres, un gérant
// les siens (stockScope), jamais ceux d'une autre organisation. Toutes les requêtes portent l'organisation de l'acteur. Le calcul lui-même est
// pur (lib/stock/insights.ts). Lecture seule : aucun mouvement n'est créé ici.
//
// Sources, toutes tirées du journal des mouvements (StockMovement) :
//  - consommation : mouvements CONSUMPTION (quantité DEMANDÉE par les recettes, manque compris), par produit, centre et jour civil de Tunis ;
//  - sorties manuelles : OUT et corrections négatives (ADJUSTMENT) uniquement. Les transferts, réceptions et entrées ne sont JAMAIS des pertes ;
//  - activité d'un centre : nombre de rendez-vous distincts (bookingId) ayant consommé du stock. Aucune lecture du module Rendez-vous ;
//  - qualité : part de mouvements portant la note de simulation (données de démonstration), pour ne jamais les présenter comme réelles.
// La prévision de rupture est reprise de getStockForecast (jamais recalculée ici).

const DAY_MS = 86_400_000;

export type ConsumptionInsights = { report: InsightsReport };

// Fenêtre demandée : une des durées proposées, sinon la durée par défaut (la valeur vient du client, jamais crue sur parole).
export function resolveWindow(days: unknown): number {
  return (WINDOWS as readonly number[]).includes(days as number) ? (days as number) : DEFAULT_WINDOW;
}

export function getConsumptionInsights(actor: StockActor, days?: unknown, now: Date = new Date()): Promise<StockResult<ConsumptionInsights>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const windowDays = resolveWindow(days);
    const todayKey = dayKey(now);
    const centers = stockCenters(actor);
    const empty = (): StockResult<ConsumptionInsights> => ({
      ok: true,
      report: buildInsights({ todayKey, windowDays, centers, products: [], pairs: [], appointments: {}, risks: [], quality: { simulatedMovements: 0, totalMovements: 0, historyDays: 0 } }),
    });

    const levelsResult = await listStockLevels(actor);
    if (!levelsResult.ok) return levelsResult;
    const levels = levelsResult.levels.filter((l) => l.productActive);
    if (levels.length === 0) return empty();
    const forecast = await getStockForecast(actor, undefined, now);
    if (!forecast.ok) return forecast;

    await connectDB();
    const organizationId = new Types.ObjectId(scope.organizationId);
    const centerIds = scope.centerIds.map((id) => new Types.ObjectId(id));
    const productIds = [...new Set(levels.map((l) => l.productId))].map((id) => new Types.ObjectId(id));
    const base = { organizationId, centerId: { $in: centerIds }, productId: { $in: productIds } };

    // Jours civils de Tunis de deux fenêtres consécutives, la veille en dernier : aujourd'hui (journée non finie) est exclu.
    const dayKeys = Array.from({ length: windowDays * 2 }, (_, i) => addDaysToKey(todayKey, -(windowDays * 2 - i)));
    const currentStart = dayKeys[windowDays];
    const since = new Date(now.getTime() - (windowDays * 2 + 2) * DAY_MS);
    const day = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Tunis" } };

    const [demand, manual, bookings, quality] = await Promise.all([
      StockMovement.aggregate<{ _id: { p: Types.ObjectId; c: Types.ObjectId; d: string }; demand: number }>([
        { $match: { ...base, kind: "CONSUMPTION", createdAt: { $gte: since } } },
        { $group: { _id: { p: "$productId", c: "$centerId", d: day }, demand: { $sum: "$requested" } } },
      ]),
      StockMovement.aggregate<{ _id: { p: Types.ObjectId; c: Types.ObjectId; d: string }; out: number }>([
        { $match: { ...base, kind: { $in: ["OUT", "ADJUSTMENT"] }, delta: { $lt: 0 }, createdAt: { $gte: since } } },
        { $group: { _id: { p: "$productId", c: "$centerId", d: day }, out: { $sum: { $multiply: ["$delta", -1] } } } },
      ]),
      StockMovement.aggregate<{ _id: { c: Types.ObjectId; b: Types.ObjectId; d: string } }>([
        { $match: { organizationId, centerId: { $in: centerIds }, kind: "CONSUMPTION", createdAt: { $gte: since } } },
        { $group: { _id: { c: "$centerId", b: "$bookingId", d: day } } },
      ]),
      StockMovement.aggregate<{ first: Date; total: number; simulated: number }>([
        { $match: { organizationId, centerId: { $in: centerIds }, kind: "CONSUMPTION" } },
        {
          $group: {
            _id: null,
            first: { $min: "$createdAt" },
            total: { $sum: { $cond: [{ $gte: ["$createdAt", since] }, 1, 0] } },
            simulated: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", since] }, { $eq: ["$note", SIMULATION_NOTE] }] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const pairKey = (p: unknown, c: unknown) => `${String(p)}:${String(c)}`;
    const demandByDay = new Map(demand.map((d) => [`${pairKey(d._id.p, d._id.c)}:${d._id.d}`, d.demand]));
    const manualOut = new Map<string, number>();
    for (const m of manual) if (m._id.d >= currentStart && m._id.d < todayKey) manualOut.set(pairKey(m._id.p, m._id.c), (manualOut.get(pairKey(m._id.p, m._id.c)) ?? 0) + m.out);

    // Rendez-vous distincts par centre et par fenêtre.
    const seen = { current: new Set<string>(), previous: new Set<string>() };
    const appointments: Record<string, { current: number; previous: number }> = {};
    for (const b of bookings) {
      const window = b._id.d >= currentStart && b._id.d < todayKey ? "current" : b._id.d >= dayKeys[0] && b._id.d < currentStart ? "previous" : null;
      if (!window) continue;
      const key = `${String(b._id.c)}:${String(b._id.b)}`;
      if (seen[window].has(key)) continue;
      seen[window].add(key);
      const entry = (appointments[String(b._id.c)] ??= { current: 0, previous: 0 });
      entry[window]++;
    }

    const pairs: PairInput[] = levels.map((l) => ({
      productId: l.productId,
      centerId: l.centerId,
      stock: l.quantity,
      alertThreshold: l.alertThreshold,
      daily: dayKeys.map((d) => demandByDay.get(`${pairKey(l.productId, l.centerId)}:${d}`) ?? 0),
      manualOut: manualOut.get(pairKey(l.productId, l.centerId)) ?? 0,
    }));
    const risks: RiskInput[] = forecast.rows.map((r) => ({
      productId: r.productId,
      centerId: r.centerId,
      urgency: r.urgency,
      status: r.status,
      stock: r.stock,
      daysLeft: r.daysLeft,
      leadDays: r.leadDays,
      breakBeforeDelivery: r.breakBeforeDelivery,
      suggestedQuantity: r.suggestedQuantity,
    }));
    const products = [...new Map(levels.map((l) => [l.productId, { id: l.productId, name: l.productName, unit: l.unit }])).values()];
    const q = quality[0];
    const historyDays = q?.first ? Math.max(0, Math.round((now.getTime() - new Date(q.first).getTime()) / DAY_MS)) : 0;

    return {
      ok: true,
      report: buildInsights({ todayKey, windowDays, centers, products, pairs, appointments, risks, quality: { simulatedMovements: q?.simulated ?? 0, totalMovements: q?.total ?? 0, historyDays } }),
    };
  });
}
