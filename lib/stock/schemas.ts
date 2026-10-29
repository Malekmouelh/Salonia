import { z } from "zod";
import { isPhone, normalizePhone } from "@/lib/definitions";
import { EQUIPMENT_STATUSES, STOCK_UNITS } from "@/lib/enums";
import { parseDate } from "./dates";
import { MAX_STOCK_QUANTITY } from "./levels";

// Module 5 — Validation des entrées. Les clés inconnues sont ignorées : l'organisation, le rôle et l'acteur
// viennent toujours du serveur. Le centre (centerId) est validé séparément par lib/stock/scope.ts.

export const MAX_PRODUCT_NAME = 80;
export const MAX_MOVEMENT_NOTE = 120;

const ObjectIdString = z.string("Identifiant invalide.").regex(/^[0-9a-f]{24}$/i, "Identifiant invalide.");
const Quantity = z.number("Quantité entière attendue.").int("Quantité entière attendue.").min(0, "La quantité ne peut pas être négative.").max(MAX_STOCK_QUANTITY, "Quantité trop grande.");
const ProductName = z.string("Nom requis.").trim().min(1, "Nom requis.").max(MAX_PRODUCT_NAME, `${MAX_PRODUCT_NAME} caractères au plus.`);
const Unit = z.enum(STOCK_UNITS, "Unité invalide.");

export const CreateProductSchema = z.object({ name: ProductName, unit: Unit });

export const UpdateProductSchema = z
  .object({ productId: ObjectIdString, name: ProductName.optional(), unit: Unit.optional() })
  .refine((v) => v.name !== undefined || v.unit !== undefined, "Rien à modifier.");

export const ProductIdSchema = z.object({ productId: ObjectIdString });

export const ActivateProductSchema = z.object({
  productId: ObjectIdString,
  alertThreshold: Quantity.default(0),
  initialQuantity: Quantity.default(0),
});

export const UpdateThresholdSchema = z.object({ productId: ObjectIdString, alertThreshold: Quantity });

// IN et OUT : quantité positive (le signe vient du type). ADJUSTMENT : variation signée non nulle, note obligatoire.
export const MovementInputSchema = z
  .object({
    productId: ObjectIdString,
    kind: z.enum(["IN", "OUT", "ADJUSTMENT"], "Type de mouvement invalide."),
    quantity: z.number("Quantité entière attendue.").int("Quantité entière attendue.").min(-MAX_STOCK_QUANTITY, "Quantité trop grande.").max(MAX_STOCK_QUANTITY, "Quantité trop grande."),
    note: z.string("Note invalide.").trim().max(MAX_MOVEMENT_NOTE, `${MAX_MOVEMENT_NOTE} caractères au plus.`).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "ADJUSTMENT") {
      if (v.quantity === 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Une correction ne peut pas être nulle." });
      if (!v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Une correction exige une note." });
    } else if (v.quantity < 1) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "La quantité doit être positive." });
    }
  });

// ── Matériel, maintenance (F5.1, F5.4) ──

export const MAX_CATEGORY_LENGTH = 60;
export const MAX_MAINTENANCE_NOTE = 200;
export const MAX_ORDER_LINES = 50;
export const MAX_SUPPLIER_NAME = 80;

// Jour AAAA-MM-JJ (heure de Tunis) → Date à minuit local. null = effacer la date.
const DateInput = z
  .string("Date invalide.")
  .refine((v) => parseDate(v) !== null, "Date invalide.")
  .transform((v) => parseDate(v)!);
const OptionalDate = DateInput.nullable().optional();
const EquipmentName = z.string("Nom requis.").trim().min(1, "Nom requis.").max(MAX_PRODUCT_NAME, `${MAX_PRODUCT_NAME} caractères au plus.`);
const Category = z.string("Catégorie requise.").trim().min(1, "Catégorie requise.").max(MAX_CATEGORY_LENGTH, `${MAX_CATEGORY_LENGTH} caractères au plus.`);
const EquipmentStatusInput = z.enum(EQUIPMENT_STATUSES, "État invalide.");
const EquipmentId = z.string("Identifiant invalide.").regex(/^[0-9a-f]{24}$/i, "Identifiant invalide.");

export const CreateEquipmentSchema = z.object({
  name: EquipmentName,
  category: Category,
  status: EquipmentStatusInput.default("IN_SERVICE"),
  acquiredAt: OptionalDate,
  nextMaintenanceAt: OptionalDate,
});

export const UpdateEquipmentSchema = z
  .object({
    equipmentId: EquipmentId,
    name: EquipmentName.optional(),
    category: Category.optional(),
    status: EquipmentStatusInput.optional(),
    acquiredAt: OptionalDate,
    nextMaintenanceAt: OptionalDate,
  })
  .refine((v) => v.name !== undefined || v.category !== undefined || v.status !== undefined || v.acquiredAt !== undefined || v.nextMaintenanceAt !== undefined, "Rien à modifier.");

export const EquipmentIdSchema = z.object({ equipmentId: EquipmentId });

export const MaintenanceInputSchema = z
  .object({
    equipmentId: EquipmentId,
    performedAt: DateInput,
    note: z.string("Note invalide.").trim().max(MAX_MAINTENANCE_NOTE, `${MAX_MAINTENANCE_NOTE} caractères au plus.`).optional(),
    nextDueAt: OptionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.nextDueAt && v.nextDueAt < v.performedAt) {
      ctx.addIssue({ code: "custom", path: ["nextDueAt"], message: "L'échéance suivante ne peut pas précéder l'intervention." });
    }
  });

export const MaintenanceHistorySchema = z.object({
  equipmentId: EquipmentId,
  limit: z.number("Limite invalide.").int("Limite invalide.").min(1, "Limite invalide.").max(200, "Limite invalide.").default(100),
});

// ── Fournisseurs (F5.5) ──

const SupplierName = z.string("Nom requis.").trim().min(1, "Nom requis.").max(MAX_SUPPLIER_NAME, `${MAX_SUPPLIER_NAME} caractères au plus.`);
// Vide ou null = pas de coordonnée. Téléphone tunisien normalisé (8 chiffres), e-mail en minuscules.
const SupplierPhone = z
  .string("Numéro tunisien invalide (8 chiffres).")
  .nullable()
  .transform((v) => (v ?? "").trim())
  .refine((v) => v === "" || isPhone(v), "Numéro tunisien invalide (8 chiffres).")
  .transform((v) => (v === "" ? null : normalizePhone(v)));
const SupplierEmail = z
  .string("Adresse e-mail invalide.")
  .nullable()
  .transform((v) => (v ?? "").trim().toLowerCase())
  .refine((v) => v === "" || z.email().safeParse(v).success, "Adresse e-mail invalide.")
  .transform((v) => (v === "" ? null : v));
const LeadTime = z.number("Délai invalide (0 à 365 jours).").int("Délai invalide (0 à 365 jours).").min(0, "Délai invalide (0 à 365 jours).").max(365, "Délai invalide (0 à 365 jours).");
const SupplierId = z.string("Identifiant invalide.").regex(/^[0-9a-f]{24}$/i, "Identifiant invalide.");

export const CreateSupplierSchema = z.object({
  name: SupplierName,
  phone: SupplierPhone.optional(),
  email: SupplierEmail.optional(),
  leadTimeDays: LeadTime.default(0),
});

export const UpdateSupplierSchema = z
  .object({ supplierId: SupplierId, name: SupplierName.optional(), phone: SupplierPhone.optional(), email: SupplierEmail.optional(), leadTimeDays: LeadTime.optional() })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.email !== undefined || v.leadTimeDays !== undefined, "Rien à modifier.");

export const SupplierIdSchema = z.object({ supplierId: SupplierId });

// ── Commandes d'achat (F5.5) ──
// Seuls l'identifiant du produit et la quantité viennent du client : le nom et l'unité sont recopiés depuis la base.

const OrderLines = z
  .array(z.object({ productId: ObjectIdString, quantity: z.number("Quantité entière attendue.").int("Quantité entière attendue.").min(1, "La quantité doit être positive.").max(MAX_STOCK_QUANTITY, "Quantité trop grande.") }), "Lignes invalides.")
  .min(1, `Une commande compte de 1 à ${MAX_ORDER_LINES} lignes.`)
  .max(MAX_ORDER_LINES, `Une commande compte de 1 à ${MAX_ORDER_LINES} lignes.`)
  .refine((lines) => new Set(lines.map((l) => l.productId.toLowerCase())).size === lines.length, "Un produit ne peut figurer qu'une fois dans une commande.");

export const CreatePurchaseOrderSchema = z.object({ supplierId: SupplierId, lines: OrderLines });

export const UpdatePurchaseOrderSchema = z
  .object({ orderId: ObjectIdString, supplierId: SupplierId.optional(), lines: OrderLines.optional() })
  .refine((v) => v.supplierId !== undefined || v.lines !== undefined, "Rien à modifier.");

export const OrderIdSchema = z.object({ orderId: ObjectIdString });

export const OrderListSchema = z.object({ status: z.enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"], "Statut invalide.").optional() });

// ── Recettes de consommation par service (F5.3) ──
// L'unité n'est jamais saisie : elle vient du produit. Seuls le service, le produit et la quantité viennent du client.

export const RecipeLineSchema = z.object({
  serviceId: ObjectIdString,
  productId: ObjectIdString,
  quantityPerService: z
    .number("Quantité entière attendue.")
    .int("Quantité entière attendue.")
    .min(1, "La quantité doit être positive.")
    .max(MAX_STOCK_QUANTITY, "Quantité trop grande."),
});

export const RecipeLineKeySchema = z.object({ serviceId: ObjectIdString, productId: ObjectIdString });

export const RecipeServiceSchema = z.object({ serviceId: ObjectIdString });

// ── Historique des mouvements d'un produit dans un centre (lecture) ──
// Pagination par curseur sur le rang du journal (`seq`, unique et strictement croissant par produit et centre) : ordre déterministe,
// du plus récent au plus ancien. `before` = rang du dernier mouvement déjà reçu.
export const MOVEMENT_HISTORY_DEFAULT_LIMIT = 20;
export const MOVEMENT_HISTORY_MAX_LIMIT = 100;

export const MovementHistorySchema = z.object({
  productId: ObjectIdString,
  limit: z
    .number("Limite invalide.")
    .int("Limite invalide.")
    .min(1, "Limite invalide.")
    .max(MOVEMENT_HISTORY_MAX_LIMIT, "Limite invalide.")
    .default(MOVEMENT_HISTORY_DEFAULT_LIMIT),
  before: z.number("Rang invalide.").int("Rang invalide.").min(1, "Rang invalide.").optional(),
});

// ── Mouvements récents, tous produits confondus, dans les centres autorisés (lecture) ──
export const RECENT_MOVEMENTS_DEFAULT_LIMIT = 10;
export const RECENT_MOVEMENTS_MAX_LIMIT = 50;

export const RecentMovementsSchema = z.object({
  limit: z
    .number("Limite invalide.")
    .int("Limite invalide.")
    .min(1, "Limite invalide.")
    .max(RECENT_MOVEMENTS_MAX_LIMIT, "Limite invalide.")
    .default(RECENT_MOVEMENTS_DEFAULT_LIMIT),
});
