import "server-only";
import { after } from "next/server";
import type { CurrentUser } from "@/lib/dal";
import { getServicesByOrganization } from "@/lib/data/catalog";
import { getStockForecast } from "@/lib/stock/forecast-data";
import { WINDOWS } from "@/lib/stock/insights";
import { getConsumptionInsights, resolveWindow } from "@/lib/stock/insights-data";
import { listEquipment, listMaintenanceSchedule } from "@/lib/stock/equipment";
import { listRecentStockMovements } from "@/lib/stock/movements";
import { summarizeStock } from "@/lib/stock/overview";
import { listPurchaseOrders } from "@/lib/stock/purchase-orders";
import { countRecipeLinesByService, listServiceRecipe } from "@/lib/stock/recipes";
import { addToCover, type StockCover } from "@/lib/stock/recipe-warning";
import { canAdministerStock, canManageProductDefinitions, stockCenters, transferDestinations } from "@/lib/stock/scope";
import { listProducts, listStockLevels, repairStockLevels, type StockResult } from "@/lib/stock/service";
import { listSuppliers } from "@/lib/stock/suppliers";
import { getTransferInbox, listTransfers } from "@/lib/stock/transfers";

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

// Transferts entre centres (F5.6) : première page de l'historique des centres autorisés, et destinations possibles (tous les centres de
// l'organisation). Les pages suivantes sont chargées par listStockTransfersAction (pagination par curseur).
async function getTransfersData(user: CurrentUser, center: string | undefined) {
  const [history, inbox] = await Promise.all([listTransfers(user, { centerId: center, limit: 10 }).then(unwrap), getTransferInbox(user).then(unwrap)]);
  // La boîte « À traiter » concerne tous les centres de l'utilisateur (jamais filtrée par le centre affiché).
  return {
    transfers: history.transfers,
    transfersNextBefore: history.nextBefore,
    destinations: transferDestinations(user),
    inbox: { toReceive: inbox.toReceive, requests: inbox.requests },
    isOwner: user.role === "OWNER",
  };
}

export async function getStockHubData(user: CurrentUser, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const center = selectedCenterId ?? undefined;
  const [products, levels, equipment, schedule, orders, recent, transferData, suppliers, forecast] = await Promise.all([
    listProducts(user).then(unwrap),
    listStockLevels(user, center).then(unwrap),
    listEquipment(user, center).then(unwrap),
    listMaintenanceSchedule(user, center).then(unwrap),
    listPurchaseOrders(user, center).then(unwrap),
    listRecentStockMovements(user, center, { limit: 10 }).then(unwrap),
    getTransfersData(user, center),
    listSuppliers(user).then(unwrap),
    getStockForecast(user, center).then(unwrap),
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
    suppliers: suppliers.suppliers.map((x) => ({ id: x.id, name: x.name })),
    forecast: forecast.rows,
    forecastToday: forecast.todayKey,
    ...transferData,
  };
}

// Analyse de la consommation entre centres : tous les centres du périmètre de l'utilisateur (la comparaison n'a de sens qu'entre centres).
// Les chiffres sont calculés par le serveur à partir du journal ; l'interprétation par l'IA n'est demandée que sur clic (analyzeStockConsumptionAction).
export async function getInsightsPageData(user: CurrentUser, requestedDays?: string) {
  const days = resolveWindow(Number(requestedDays));
  const { report } = unwrap(await getConsumptionInsights(user, days));
  return { report, days, windows: [...WINDOWS] };
}

export async function getEquipmentPageData(user: CurrentUser, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const center = selectedCenterId ?? undefined;
  const [equipment, schedule, transferData] = await Promise.all([listEquipment(user, center, true).then(unwrap), listMaintenanceSchedule(user, center).then(unwrap), getTransfersData(user, center)]);
  return { centers, selectedCenterId, equipment: equipment.equipment, schedule: schedule.schedule, ...transferData };
}

export async function getSuppliersPageData(user: CurrentUser) {
  const [suppliers, orders] = await Promise.all([listSuppliers(user, true).then(unwrap), listPurchaseOrders(user).then(unwrap)]);
  const orderCount: Record<string, number> = {};
  for (const o of orders.orders) orderCount[o.supplierId] = (orderCount[o.supplierId] ?? 0) + 1;
  return { suppliers: suppliers.suppliers, orderCount, canManage: canAdministerStock(user) };
}

export async function getOrdersPageData(user: CurrentUser, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const [orders, suppliers, products, levels] = await Promise.all([
    listPurchaseOrders(user, selectedCenterId ?? undefined).then(unwrap),
    listSuppliers(user, true).then(unwrap),
    listProducts(user).then(unwrap),
    listStockLevels(user).then(unwrap),
  ]);
  // Produits proposables par centre : actifs ET déjà activés dans le centre de livraison (règle du service des commandes).
  const activated: Record<string, string[]> = {};
  for (const l of levels.levels) if (l.productActive) (activated[l.centerId] ??= []).push(l.productId);
  // Livraison prévue d'une commande passée et pas encore reçue : date de commande + délai de son fournisseur (si la fiche existe encore).
  const leadTime = new Map(suppliers.suppliers.map((x) => [x.id, x.leadTimeDays]));
  const now = Date.now();
  const delivery: Record<string, { expectedAt: string; late: boolean }> = {};
  for (const o of orders.orders) {
    const days = leadTime.get(o.supplierId);
    if (o.status !== "ORDERED" || !o.orderedAt || days === undefined) continue;
    const expected = new Date(new Date(o.orderedAt).getTime() + days * 86_400_000);
    delivery[o.id] = { expectedAt: expected.toISOString(), late: expected.getTime() < now };
  }
  return {
    centers,
    selectedCenterId,
    orders: orders.orders,
    delivery,
    // Le formulaire de commande ne propose que les fournisseurs actifs ; la liste complète sert au filtre.
    allSuppliers: suppliers.suppliers.map((x) => ({ id: x.id, name: x.name })),
    suppliers: suppliers.suppliers.filter((x) => x.active),
    products: products.products.filter((p) => p.active),
    activated,
  };
}

// Recettes : propres à UN centre. Le centre demandé dans l'URL est retenu s'il est dans le périmètre, sinon le premier centre.
export async function getRecipesPageData(user: CurrentUser, requestedService?: string, requestedCenter?: string) {
  const { centers, selectedCenterId } = resolveCenter(user, requestedCenter);
  const centerId = selectedCenterId ?? centers[0]?.id ?? null;
  const [services, products, levels] = await Promise.all([getServicesByOrganization(user.organization!.id), listProducts(user).then(unwrap), listStockLevels(user, centerId ?? undefined).then(unwrap)]);
  const list = services.map((s) => ({ id: s.id, name: s.name, category: s.category, requiredEquipment: s.requiredEquipment }));
  // Stock actuel de chaque produit DANS CE CENTRE : sert à estimer le nombre de prestations possibles.
  const stockByProduct: Record<string, StockCover> = {};
  for (const l of levels.levels) stockByProduct[l.productId] = addToCover(stockByProduct[l.productId], l.quantity);
  const selected = list.find((s) => s.id === requestedService) ?? list[0] ?? null;
  const recipe = selected && centerId ? unwrap(await listServiceRecipe(user, { centerId, serviceId: selected.id })) : null;
  const recipeCounts = centerId ? unwrap(await countRecipeLinesByService(user, { centerId })).counts : {};
  // Seuil d'alerte de chaque produit DANS CE CENTRE (sert à annoncer quand l'alerte se déclenchera).
  const thresholdByProduct: Record<string, number> = {};
  for (const l of levels.levels) thresholdByProduct[l.productId] = l.alertThreshold;
  return { centers, selectedCenterId: centerId, recipeCounts, thresholdByProduct, services: list, selectedServiceId: selected?.id ?? null, lines: recipe?.lines ?? [], products: products.products.filter((p) => p.active), stockByProduct };
}
