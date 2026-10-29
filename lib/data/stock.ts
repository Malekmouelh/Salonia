import "server-only";
import { after } from "next/server";
import type { CurrentUser } from "@/lib/dal";
import { getServicesByOrganization } from "@/lib/data/catalog";
import { listEquipment, listMaintenanceSchedule } from "@/lib/stock/equipment";
import { listRecentStockMovements } from "@/lib/stock/movements";
import { summarizeStock } from "@/lib/stock/overview";
import { listPurchaseOrders } from "@/lib/stock/purchase-orders";
import { listServiceRecipe } from "@/lib/stock/recipes";
import { canManageProductDefinitions, stockCenters } from "@/lib/stock/scope";
import { listProducts, listStockLevels, repairStockLevels, type StockResult } from "@/lib/stock/service";
import { listSuppliers } from "@/lib/stock/suppliers";

// Module 5 — Lectures des pages du stock. Chaque page appelle les services du Module 5 (qui appliquent rôle, organisation et centres
// autorisés) ; aucune collection n'est lue directement ici. Un échec de service lève une erreur : la page affiche l'état d'erreur.

function unwrap<T>(result: StockResult<T>): Extract<StockResult<T>, { ok: true }> {
  if (!result.ok) throw new Error(result.message ?? "Lecture du stock impossible.");
  return result;
}

// Centre demandé dans l'URL : retenu seulement s'il est dans le périmètre de l'utilisateur (sinon « tous mes centres »).
function resolveCenter(user: CurrentUser, requested: string | undefined) {
  const centers = stockCenters(user);
  const selectedCenterId = requested && centers.some((c) => c.id === requested) ? requested : null;
  return { centers, selectedCenterId };
}

export async function getStockHubData(user: CurrentUser, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const center = selectedCenterId ?? undefined;
  const [products, levels, equipment, schedule, orders, recent] = await Promise.all([
    listProducts(user).then(unwrap),
    listStockLevels(user, center).then(unwrap),
    listEquipment(user, center).then(unwrap),
    listMaintenanceSchedule(user, center).then(unwrap),
    listPurchaseOrders(user, center).then(unwrap),
    listRecentStockMovements(user, center, { limit: 10 }).then(unwrap),
  ]);

  // Projections en retard ou divergentes : réparées APRÈS l'envoi de la réponse (aucun mouvement créé, affichage non bloqué).
  // La quantité affichée vient déjà du journal ; les réparations simultanées convergent (voir lib/stock/ledger.ts).
  const stale = levels.levels.filter((l) => l.needsRepair).map((l) => ({ productId: l.productId, centerId: l.centerId }));
  if (stale.length > 0) {
    after(async () => {
      try {
        await repairStockLevels(user, stale);
      } catch (error) {
        console.error("Réparation des projections de stock en échec :", error);
      }
    });
  }

  const summary = summarizeStock({
    activeProductCount: products.products.filter((p) => p.active).length,
    levels: levels.levels,
    equipment: equipment.equipment,
    schedule: schedule.schedule,
    orders: orders.orders,
  });
  return {
    centers,
    selectedCenterId,
    products: products.products,
    levels: levels.levels,
    recent: recent.movements,
    summary,
    canManageProducts: canManageProductDefinitions(user),
  };
}

export async function getEquipmentPageData(user: CurrentUser, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const center = selectedCenterId ?? undefined;
  const [equipment, schedule] = await Promise.all([listEquipment(user, center, true).then(unwrap), listMaintenanceSchedule(user, center).then(unwrap)]);
  return { centers, selectedCenterId, equipment: equipment.equipment, schedule: schedule.schedule };
}

export async function getSuppliersPageData(user: CurrentUser) {
  const [suppliers, orders] = await Promise.all([listSuppliers(user, true).then(unwrap), listPurchaseOrders(user).then(unwrap)]);
  const orderCount: Record<string, number> = {};
  for (const o of orders.orders) orderCount[o.supplierId] = (orderCount[o.supplierId] ?? 0) + 1;
  return { suppliers: suppliers.suppliers, orderCount, canManage: canManageProductDefinitions(user) };
}

export async function getOrdersPageData(user: CurrentUser, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const [orders, suppliers, products, levels] = await Promise.all([
    listPurchaseOrders(user, selectedCenterId ?? undefined).then(unwrap),
    listSuppliers(user).then(unwrap),
    listProducts(user).then(unwrap),
    listStockLevels(user).then(unwrap),
  ]);
  // Produits proposables par centre : actifs ET déjà activés dans le centre de livraison (règle du service des commandes).
  const activated: Record<string, string[]> = {};
  for (const l of levels.levels) if (l.productActive) (activated[l.centerId] ??= []).push(l.productId);
  return {
    centers,
    selectedCenterId,
    orders: orders.orders,
    suppliers: suppliers.suppliers,
    products: products.products.filter((p) => p.active),
    activated,
  };
}

export async function getRecipesPageData(user: CurrentUser, requestedService?: string) {
  const [services, products] = await Promise.all([getServicesByOrganization(user.organization!.id), listProducts(user).then(unwrap)]);
  const list = services.map((s) => ({ id: s.id, name: s.name, category: s.category }));
  const selected = list.find((s) => s.id === requestedService) ?? list[0] ?? null;
  const recipe = selected ? unwrap(await listServiceRecipe(user, { serviceId: selected.id })) : null;
  return { services: list, selectedServiceId: selected?.id ?? null, lines: recipe?.lines ?? [], products: products.products.filter((p) => p.active) };
}
