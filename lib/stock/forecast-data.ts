import { Types } from "mongoose";
import { dayKey } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { StockUnit } from "@/lib/enums";
import { PurchaseOrder, StockMovement, StockProduct, Supplier } from "@/lib/models/stock";
import { HISTORY_DAYS, addDaysToKey, compareForecasts, daysBetweenKeys, forecastProduct, type Forecast } from "./forecast";
import { stockScope } from "./scope";
import { guard, listStockLevels, type StockActor, type StockResult } from "./service";

// Module 5 (IA) — Lecture des données de la prévision, avec les droits du stock : un propriétaire voit tous ses centres, un gérant les siens
// (stockScope), jamais ceux d'une autre organisation. Toutes les requêtes portent l'organisation de l'acteur. Le calcul lui-même est pur
// (lib/stock/forecast.ts). Lecture seule : aucun mouvement ni commande n'est créé ici.
//
// Sources : mouvements CONSUMPTION (quantité DEMANDÉE par les recettes, manque compris), niveau du JOURNAL (vérité), commandes passées et pas
// reçues, délai du fournisseur habituel du produit.

const DAY_MS = 86_400_000;

export type ForecastRow = Forecast & {
  productId: string;
  productName: string;
  unit: StockUnit;
  centerId: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierActive: boolean;
};

export function getStockForecast(actor: StockActor, requestedCenterId?: unknown, now: Date = new Date()): Promise<StockResult<{ rows: ForecastRow[]; todayKey: string }>> {
  return guard(async () => {
    const scope = stockScope(actor, requestedCenterId);
    const levelsResult = await listStockLevels(actor, requestedCenterId);
    if (!levelsResult.ok) return levelsResult;
    const levels = levelsResult.levels.filter((l) => l.productActive);
    const todayKey = dayKey(now);
    if (levels.length === 0) return { ok: true, rows: [], todayKey };

    await connectDB();
    const organizationId = new Types.ObjectId(scope.organizationId);
    const centerIds = [...new Set(levels.map((l) => l.centerId))].map((id) => new Types.ObjectId(id));
    const productIds = [...new Set(levels.map((l) => l.productId))].map((id) => new Types.ObjectId(id));
    const base = { organizationId, centerId: { $in: centerIds }, productId: { $in: productIds } };

    // Demande par jour (jour civil de Tunis) sur la fenêtre, et début de l'historique de chaque (produit, centre).
    const since = new Date(now.getTime() - (HISTORY_DAYS + 2) * DAY_MS);
    const [daily, starts, orders, products] = await Promise.all([
      StockMovement.aggregate<{ _id: { p: Types.ObjectId; c: Types.ObjectId; d: string }; demand: number }>([
        { $match: { ...base, kind: "CONSUMPTION", createdAt: { $gte: since } } },
        { $group: { _id: { p: "$productId", c: "$centerId", d: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Tunis" } } }, demand: { $sum: "$requested" } } },
      ]),
      StockMovement.aggregate<{ _id: { p: Types.ObjectId; c: Types.ObjectId }; first: Date; firstConsumption: Date | null }>([
        { $match: base },
        { $group: { _id: { p: "$productId", c: "$centerId" }, first: { $min: "$createdAt" }, firstConsumption: { $min: { $cond: [{ $eq: ["$kind", "CONSUMPTION"] }, "$createdAt", null] } } } },
      ]),
      PurchaseOrder.find({ organizationId, centerId: { $in: centerIds }, status: "ORDERED" }).select("centerId lines").lean(),
      StockProduct.find({ organizationId, _id: { $in: productIds } }).select("supplierId").lean(),
    ]);

    const pairKey = (p: unknown, c: unknown) => `${String(p)}:${String(c)}`;
    const demandByDay = new Map(daily.map((d) => [`${pairKey(d._id.p, d._id.c)}:${d._id.d}`, d.demand]));
    const startOf = new Map(starts.map((s) => [pairKey(s._id.p, s._id.c), s.firstConsumption ?? s.first]));
    const onOrder = new Map<string, number>();
    for (const order of orders) for (const line of order.lines) onOrder.set(pairKey(line.productId, order.centerId), (onOrder.get(pairKey(line.productId, order.centerId)) ?? 0) + line.quantity);

    const supplierOf = new Map(products.map((p) => [String(p._id), p.supplierId ? String(p.supplierId) : null]));
    const supplierIds = [...new Set([...supplierOf.values()].filter((id): id is string => id !== null))];
    const suppliers = supplierIds.length === 0 ? [] : await Supplier.find({ organizationId, _id: { $in: supplierIds } }).select("name leadTimeDays active").lean();
    const supplierById = new Map(suppliers.map((s) => [String(s._id), s]));

    const rows = levels.map((level): ForecastRow => {
      const key = pairKey(level.productId, level.centerId);
      const supplier = supplierById.get(supplierOf.get(level.productId) ?? "") ?? null;
      const start = startOf.get(key);
      const dailyDemand = Array.from({ length: HISTORY_DAYS }, (_, i) => demandByDay.get(`${key}:${addDaysToKey(todayKey, -(HISTORY_DAYS - i))}`) ?? 0);
      const forecast = forecastProduct({
        todayKey,
        dailyDemand,
        historyDays: start ? daysBetweenKeys(dayKey(new Date(start)), todayKey) : 0, // jours civils de Tunis écoulés depuis le début de l'historique
        stock: level.quantity,
        alertThreshold: level.alertThreshold,
        onOrder: onOrder.get(key) ?? 0,
        leadDays: supplier ? supplier.leadTimeDays : null,
      });
      return {
        ...forecast,
        productId: level.productId,
        productName: level.productName,
        unit: level.unit,
        centerId: level.centerId,
        supplierId: supplier ? String(supplier._id) : null,
        supplierName: supplier?.name ?? null,
        supplierActive: supplier?.active ?? false,
      };
    });
    rows.sort((a, b) => compareForecasts(a, b) || a.productName.localeCompare(b.productName, "fr"));
    return { ok: true, rows, todayKey };
  });
}
