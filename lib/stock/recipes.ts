import { connectDB } from "@/lib/db";
import type { StockUnit } from "@/lib/enums";
import { Service } from "@/lib/models/catalog";
import { ServiceRecipe, StockProduct } from "@/lib/models/stock";
import { isDuplicateKey } from "./errors";
import { RecipeLineKeySchema, RecipeLineSchema, RecipeServiceSchema } from "./schemas";
import { MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, guard, invalid, type StockActor, type StockResult } from "./service";
import { requireProductDefinitionsAdmin } from "./scope";

// Module 5 — Recettes de consommation par service (F5.3) : « une prestation consomme X unités de base du produit Y ».
// CONFIGURATION SEULE : une recette ne crée ni ne modifie jamais un mouvement de stock, et rien dans ce fichier ne lit ni ne
// change un rendez-vous. La consommation automatique est une étape distincte, qui n'existe pas encore.
//
// Droits : propriétaire seulement, pour l'écriture comme pour la lecture (les recettes sont des données communes à l'organisation,
// comme les définitions de produits ; le gérant ne les gère pas). Chaque requête porte l'organisation de l'acteur. Un service est
// identifié par son _id et appartient à une organisation (Service.organizationId, obligatoire) : il est relu avec l'organisation de
// l'acteur avant toute écriture, jamais cru sur la saisie. L'unité vient du produit ; la recette n'en porte pas.

export const MSG_SERVICE_NOT_FOUND = "Service introuvable.";
export const MSG_RECIPE_DUPLICATE = "Ce produit est déjà dans la recette de ce service.";
export const MSG_RECIPE_LINE_NOT_FOUND = "Ligne de recette introuvable.";

export type RecipeLineView = { serviceId: string; productId: string; productName: string; unit: StockUnit; productActive: boolean; quantityPerService: number };

const serviceExists = async (organizationId: string, serviceId: string) => (await Service.exists({ _id: serviceId, organizationId })) !== null;

// Ajoute un produit à la recette d'un service. Le produit doit exister dans l'organisation et être actif (un produit archivé
// ne peut pas être ajouté à une recette).
export function addRecipeLine(actor: StockActor, input: unknown): Promise<StockResult<{ line: RecipeLineView }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = RecipeLineSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { serviceId, productId, quantityPerService } = parsed.data;
    if (!(await serviceExists(organizationId, serviceId))) return { ok: false, message: MSG_SERVICE_NOT_FOUND };
    const product = await StockProduct.findOne({ _id: productId, organizationId }).lean();
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };
    try {
      await ServiceRecipe.create({ organizationId, serviceId, productId, quantityPerService });
    } catch (error) {
      if (isDuplicateKey(error)) return { ok: false, message: MSG_RECIPE_DUPLICATE };
      throw error;
    }
    return { ok: true, line: { serviceId, productId, productName: product.name, unit: product.unit as StockUnit, productActive: true, quantityPerService } };
  });
}

// Modifie la quantité d'une ligne existante. `changed` est faux si la quantité est déjà celle demandée (aucune écriture).
// Une ligne dont le produit a été archivé depuis reste modifiable (seul l'ajout d'un produit archivé est interdit).
export function updateRecipeLine(actor: StockActor, input: unknown): Promise<StockResult<{ line: RecipeLineView; previousQuantity: number; changed: boolean }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = RecipeLineSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { serviceId, productId, quantityPerService } = parsed.data;
    const recipe = await ServiceRecipe.findOne({ organizationId, serviceId, productId });
    const product = recipe ? await StockProduct.findOne({ _id: productId, organizationId }).lean() : null;
    if (!recipe || !product) return { ok: false, message: MSG_RECIPE_LINE_NOT_FOUND };
    const previousQuantity = recipe.quantityPerService;
    const changed = previousQuantity !== quantityPerService;
    if (changed) {
      recipe.quantityPerService = quantityPerService;
      await recipe.save();
    }
    return { ok: true, previousQuantity, changed, line: { serviceId, productId, productName: product.name, unit: product.unit as StockUnit, productActive: product.active, quantityPerService } };
  });
}

// Supprime une ligne de recette (configuration, pas historique : aucun mouvement n'est touché). Une ligne inexistante est refusée.
// Ne relit pas le service : une ligne orpheline d'un service supprimé du catalogue reste supprimable.
export function removeRecipeLine(actor: StockActor, input: unknown): Promise<StockResult<{ serviceId: string; productId: string; removedQuantity: number }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = RecipeLineKeySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { serviceId, productId } = parsed.data;
    const removed = await ServiceRecipe.findOneAndDelete({ organizationId, serviceId, productId }).lean();
    if (!removed) return { ok: false, message: MSG_RECIPE_LINE_NOT_FOUND };
    return { ok: true, serviceId, productId, removedQuantity: removed.quantityPerService };
  });
}

// Recette d'un service, avec nom et unité des produits (archivés inclus, signalés). Le service doit appartenir à l'organisation.
export function listServiceRecipe(actor: StockActor, input: unknown): Promise<StockResult<{ serviceId: string; serviceName: string; lines: RecipeLineView[] }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = RecipeServiceSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { serviceId } = parsed.data;
    const service = await Service.findOne({ _id: serviceId, organizationId }).select("name").lean();
    if (!service) return { ok: false, message: MSG_SERVICE_NOT_FOUND };
    const recipes = await ServiceRecipe.find({ organizationId, serviceId }).lean();
    const products = await StockProduct.find({ organizationId, _id: { $in: recipes.map((r) => r.productId) } }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const lines = recipes
      .flatMap((r) => {
        const product = byId.get(String(r.productId));
        return product ? [{ serviceId, productId: String(r.productId), productName: product.name, unit: product.unit as StockUnit, productActive: product.active, quantityPerService: r.quantityPerService }] : [];
      })
      .sort((a, b) => a.productName.localeCompare(b.productName, "fr"));
    return { ok: true, serviceId, serviceName: service.name, lines };
  });
}
