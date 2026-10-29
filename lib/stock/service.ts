import { Error as MongooseError } from "mongoose";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import type { StockUnit } from "@/lib/enums";
import { StockLevel, StockMovement, StockProduct } from "@/lib/models/stock";
import { StockError, isDuplicateKey } from "./errors";
import { commitMovement, openLevel, projectLevel, readTail, repairLevel, type LedgerKey, type RepairStatus } from "./ledger";
import { isLowStock } from "./levels";
import {
  ActivateProductSchema,
  CreateProductSchema,
  MovementInputSchema,
  ProductIdSchema,
  UpdateProductSchema,
  UpdateThresholdSchema,
} from "./schemas";
import {
  StockAccessError,
  requireProductDefinitionsAdmin,
  requireStockAdmin,
  requireStockCenter,
  resolveStockCenter,
  stockFilter,
  stockScope,
} from "./scope";

// Module 5 (étape 3) — Produits, niveaux et mouvements manuels. Les droits sont vérifiés ici (et non dans une action)
// pour rester testables. L'organisation vient TOUJOURS de l'acteur ; un centre fourni par le client est validé par
// lib/stock/scope.ts avant tout accès aux données. Aucune consommation de rendez-vous, recette ni UI à cette étape.

export type StockActor = Pick<CurrentUser, "id" | "role" | "organization" | "centerIds">;
export type StockFailure = { ok: false; message?: string; errors?: Record<string, string[]> };
export type StockResult<T> = ({ ok: true } & T) | StockFailure;

export const MSG_PRODUCT_NOT_FOUND = "Produit introuvable.";
export const MSG_PRODUCT_ARCHIVED = "Ce produit est archivé.";
export const MSG_NAME_TAKEN = "Un produit actif porte déjà ce nom.";
export const MSG_NOT_ACTIVATED = "Ce produit n'est pas activé dans ce centre.";
export const MSG_UNIT_LOCKED = "L'unité ne peut plus changer : des mouvements existent.";
export const MSG_INVALID = "Formulaire invalide.";

type ProductView = { id: string; name: string; unit: StockUnit; active: boolean };
const productView = (p: { _id: unknown; name: string; unit: string; active: boolean }): ProductView => ({
  id: String(p._id),
  name: p.name,
  unit: p.unit as StockUnit,
  active: p.active,
});

export function invalid(error: { flatten(): { fieldErrors: unknown } }): StockFailure {
  const errors = error.flatten().fieldErrors as Record<string, string[]>;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: false, message: MSG_INVALID };
}

// Champ lu tel quel dans une saisie non fiable (jamais utilisé avant validation par le périmètre).
export function rawField(input: unknown, field: string): unknown {
  return input && typeof input === "object" ? (input as Record<string, unknown>)[field] : undefined;
}

// Transforme les refus attendus (droits, règle métier, validation Mongoose) en résultat ; relance tout le reste.
export async function guard<T>(fn: () => Promise<StockResult<T>>): Promise<StockResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StockAccessError || error instanceof StockError) return { ok: false, message: error.message };
    if (error instanceof MongooseError.ValidationError) return { ok: false, message: MSG_INVALID };
    throw error;
  }
}

async function loadProduct(organizationId: string, productId: string) {
  return StockProduct.findOne({ _id: productId, organizationId });
}

// ── Définitions de produits (OWNER) ──

export function createProduct(actor: StockActor, input: unknown): Promise<StockResult<{ product: ProductView }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = CreateProductSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    try {
      const product = await StockProduct.create({ organizationId, name: parsed.data.name, unit: parsed.data.unit });
      return { ok: true, product: productView(product) };
    } catch (error) {
      if (isDuplicateKey(error, "name")) return { ok: false, errors: { name: [MSG_NAME_TAKEN] } };
      throw error;
    }
  });
}

export function updateProduct(actor: StockActor, input: unknown): Promise<StockResult<{ product: ProductView }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = UpdateProductSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const product = await loadProduct(organizationId, parsed.data.productId);
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };

    if (parsed.data.unit && parsed.data.unit !== product.unit) {
      // Un changement d'unité ferait changer de sens tout l'historique. NB : contrôle puis écriture non atomiques ; un
      // mouvement enregistré entre les deux resterait possible (fenêtre étroite, documentée).
      if (await StockMovement.exists({ organizationId, productId: product._id })) return { ok: false, message: MSG_UNIT_LOCKED };
      product.unit = parsed.data.unit;
    }
    if (parsed.data.name) product.name = parsed.data.name;
    try {
      await product.save();
    } catch (error) {
      if (isDuplicateKey(error, "name")) return { ok: false, errors: { name: [MSG_NAME_TAKEN] } };
      throw error;
    }
    return { ok: true, product: productView(product) };
  });
}

// Archivage (active: false) : l'historique, les niveaux et les mouvements restent intacts. Idempotent.
export function archiveProduct(actor: StockActor, input: unknown): Promise<StockResult<{ product: ProductView }>> {
  return guard(async () => {
    const organizationId = requireProductDefinitionsAdmin(actor);
    const parsed = ProductIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const product = await loadProduct(organizationId, parsed.data.productId);
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (product.active) {
      product.active = false;
      await product.save();
    }
    return { ok: true, product: productView(product) };
  });
}

// Définitions visibles par OWNER et MANAGER (lecture) : un gérant choisit le produit à activer dans son centre.
export function listProducts(actor: StockActor): Promise<StockResult<{ products: ProductView[] }>> {
  return guard(async () => {
    const organizationId = requireStockAdmin(actor);
    await connectDB();
    const products = await StockProduct.find({ organizationId }).sort({ name: 1 }).collation({ locale: "fr", strength: 2 }).lean();
    return { ok: true, products: products.map(productView) };
  });
}

// ── Niveaux par centre (OWNER, MANAGER dans ses centres) ──

type LevelView = { productId: string; centerId: string; alertThreshold: number; quantity: number; seq: number };

export type ActivationResult = {
  level: LevelView;
  levelCreated: boolean;
  // RECORDED = stock initial enregistré · ALREADY_RECORDED = le journal avait déjà un mouvement de rang 1 (rien n'est crédité) · NONE = aucun stock initial demandé
  initialStock: "RECORDED" | "ALREADY_RECORDED" | "NONE";
};

// Active un produit existant et actif dans un centre autorisé : crée son niveau (seuil) et, si demandé, le stock initial
// (mouvement OPENING au rang 1). Rejouer l'activation ne crédite JAMAIS une seconde fois le stock initial ni ne change le seuil.
export function activateProductInCenter(actor: StockActor, input: unknown): Promise<StockResult<ActivationResult>> {
  return guard(async () => {
    const { organizationId, centerId } = requireStockCenter(actor, rawField(input, "centerId"));
    const parsed = ActivateProductSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const product = await loadProduct(organizationId, parsed.data.productId);
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };

    const key: LedgerKey = { organizationId, productId: String(product._id), centerId };
    let levelCreated = false;
    let level = await StockLevel.findOne(key);
    if (!level) {
      try {
        level = await StockLevel.create({ ...key, alertThreshold: parsed.data.alertThreshold });
        levelCreated = true;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        level = await StockLevel.findOne(key); // activation simultanée : l'autre a créé le niveau
      }
    }

    let initialStock: ActivationResult["initialStock"] = "NONE";
    if (parsed.data.initialQuantity > 0) {
      const { created } = await openLevel({ ...key, quantity: parsed.data.initialQuantity, createdBy: actor.id });
      initialStock = created ? "RECORDED" : "ALREADY_RECORDED";
    }
    const fresh = (await StockLevel.findOne(key).lean()) ?? level!;
    return {
      ok: true,
      levelCreated,
      initialStock,
      level: { productId: key.productId, centerId, alertThreshold: fresh.alertThreshold, quantity: fresh.quantity, seq: fresh.seq },
    };
  });
}

export function updateAlertThreshold(actor: StockActor, input: unknown): Promise<StockResult<{ level: LevelView }>> {
  return guard(async () => {
    const { organizationId, centerId } = requireStockCenter(actor, rawField(input, "centerId"));
    const parsed = UpdateThresholdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const level = await StockLevel.findOneAndUpdate(
      { organizationId, centerId, productId: parsed.data.productId },
      { $set: { alertThreshold: parsed.data.alertThreshold } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!level) return { ok: false, message: MSG_NOT_ACTIVATED };
    return { ok: true, level: { productId: parsed.data.productId, centerId, alertThreshold: level.alertThreshold, quantity: level.quantity, seq: level.seq } };
  });
}

// ── Mouvements manuels (entrée, sortie, correction) ──

export type MovementResult = {
  productId: string;
  centerId: string;
  movement: { seq: number; kind: string; delta: number; balanceAfter: number };
  // true si le mouvement est enregistré mais que la projection du niveau a échoué : elle sera réparée (lecture ou écriture suivante).
  projectionPending: boolean;
};

// IN/OUT : quantité positive, le signe vient du type. ADJUSTMENT : variation signée non nulle, note obligatoire.
// Aucune idempotence côté client à cette étape (le schéma approuvé n'a pas de clé de requête) : deux envois = deux mouvements.
export function recordStockMovement(actor: StockActor, input: unknown): Promise<StockResult<MovementResult>> {
  return guard(async () => {
    const { organizationId, centerId } = requireStockCenter(actor, rawField(input, "centerId"));
    const parsed = MovementInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { productId, kind, quantity, note } = parsed.data;
    await connectDB();
    const product = await loadProduct(organizationId, productId);
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };
    const key: LedgerKey = { organizationId, productId, centerId };
    if (!(await StockLevel.exists(key))) return { ok: false, message: MSG_NOT_ACTIVATED };

    const delta = kind === "OUT" ? -quantity : quantity;
    const movement = await commitMovement({ ...key, kind, delta, note, createdBy: actor.id });
    let projectionPending = false;
    try {
      await projectLevel({ ...key, seq: movement.seq, balanceAfter: movement.balanceAfter });
    } catch (error) {
      // Le mouvement est validé : on ne l'annule pas. Le niveau sera réaligné par repairStockLevels ou la prochaine écriture.
      console.error("Projection du niveau de stock en échec (mouvement enregistré) :", error);
      projectionPending = true;
    }
    return {
      ok: true,
      productId,
      centerId,
      projectionPending,
      movement: { seq: movement.seq, kind: movement.kind, delta: movement.delta, balanceAfter: movement.balanceAfter },
    };
  });
}

// ── Lecture et réparation ──

export type StockLevelRow = {
  productId: string;
  productName: string;
  unit: StockUnit;
  productActive: boolean;
  centerId: string;
  alertThreshold: number;
  // Quantité lue dans le JOURNAL (vérité) ; projectedQuantity est la projection stockée, parfois en retard.
  quantity: number;
  projectedQuantity: number;
  lowStock: boolean;
  needsRepair: boolean;
};

// Niveaux visibles par l'acteur (tous ses centres, ou un seul si demandé et autorisé). Détecte les projections en retard
// ou divergentes sans rien écrire : l'appelant peut ensuite demander repairStockLevels (sans bloquer l'affichage).
export function listStockLevels(actor: StockActor, requestedCenterId?: unknown): Promise<StockResult<{ levels: StockLevelRow[] }>> {
  return guard(async () => {
    const scope = stockScope(actor, requestedCenterId);
    await connectDB();
    const levels = await StockLevel.find(stockFilter(scope)).lean();
    const products = await StockProduct.find({ organizationId: scope.organizationId, _id: { $in: levels.map((l) => l.productId) } }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const rows = await Promise.all(
      levels.map(async (level): Promise<StockLevelRow | null> => {
        const product = byId.get(String(level.productId));
        if (!product) return null; // niveau sans définition de l'organisation : jamais affiché
        const tail = await readTail({ organizationId: scope.organizationId, productId: String(level.productId), centerId: String(level.centerId) });
        return {
          productId: String(level.productId),
          productName: product.name,
          unit: product.unit as StockUnit,
          productActive: product.active,
          centerId: String(level.centerId),
          alertThreshold: level.alertThreshold,
          quantity: tail.balanceAfter,
          projectedQuantity: level.quantity,
          lowStock: isLowStock(tail.balanceAfter, level.alertThreshold),
          needsRepair: level.seq !== tail.seq || level.quantity !== tail.balanceAfter,
        };
      }),
    );
    const visible = rows.filter((r): r is StockLevelRow => r !== null);
    visible.sort((a, b) => a.productName.localeCompare(b.productName, "fr") || a.centerId.localeCompare(b.centerId));
    return { ok: true, levels: visible };
  });
}

export type RepairItem = { productId: string; centerId: string };
const MAX_REPAIR_ITEMS = 200;

// Réalignement contrôlé de la projection (jamais de nouveau mouvement). Chaque élément est revalidé : un centre hors périmètre
// ou un produit d'une autre organisation est ignoré (« skipped »), jamais réparé.
export function repairStockLevels(
  actor: StockActor,
  items: unknown,
): Promise<StockResult<{ repaired: { productId: string; centerId: string; status: RepairStatus }[]; skipped: number }>> {
  return guard(async () => {
    const organizationId = requireStockAdmin(actor);
    const list = Array.isArray(items) ? items.slice(0, MAX_REPAIR_ITEMS) : [];
    await connectDB();
    const seen = new Set<string>();
    const repaired: { productId: string; centerId: string; status: RepairStatus }[] = [];
    let skipped = 0;
    for (const item of list) {
      const centerId = resolveStockCenter(actor, rawField(item, "centerId"));
      const productId = rawField(item, "productId");
      if (!centerId || typeof productId !== "string" || !/^[0-9a-f]{24}$/i.test(productId) || seen.has(`${productId}:${centerId}`)) {
        skipped++;
        continue;
      }
      seen.add(`${productId}:${centerId}`);
      const { status } = await repairLevel({ organizationId, productId, centerId });
      repaired.push({ productId, centerId, status });
    }
    return { ok: true, repaired, skipped };
  });
}
