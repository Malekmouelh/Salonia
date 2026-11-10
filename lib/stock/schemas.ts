import { z } from "zod";
import { isPhone, normalizePhone } from "@/lib/definitions";
import { EQUIPMENT_STATUSES, STOCK_UNITS, SUPPLIER_CATEGORIES } from "@/lib/enums";
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

// Fournisseur habituel : identifiant, ou vide / null pour l'effacer.
const UsualSupplier = z.union([ObjectIdString, z.literal(""), z.null()], "Identifiant invalide.").transform((v) => (v === "" ? null : v));

export const CreateProductSchema = z.object({ name: ProductName, unit: Unit, supplierId: UsualSupplier.optional() });

export const UpdateProductSchema = z
  .object({ productId: ObjectIdString, name: ProductName.optional(), unit: Unit.optional(), supplierId: UsualSupplier.optional() })
  .refine((v) => v.name !== undefined || v.unit !== undefined || v.supplierId !== undefined, "Rien à modifier.");

export const ProductIdSchema = z.object({ productId: ObjectIdString });

// Explication d'une prévision : le produit et le centre désignent la ligne ; les chiffres sont recalculés par le serveur.
export const ForecastExplainSchema = z.object({ productId: ObjectIdString, centerId: ObjectIdString, lang: z.enum(["fr", "ar"]).default("fr") });

// Analyse IA de la consommation : la durée est une des durées proposées (resolveWindow la ramène à la valeur par défaut sinon) ; le périmètre
// (organisation, centres) vient toujours du serveur, jamais de ce corps.
export const ConsumptionAnalysisSchema = z.object({ days: z.number("Durée invalide.").int("Durée invalide.").optional(), lang: z.enum(["fr", "ar"]).default("fr") });

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

// Vide ou null = pas de catégorie.
const SupplierCategoryField = z
  .union([z.enum(SUPPLIER_CATEGORIES, "Catégorie invalide."), z.literal(""), z.null()], "Catégorie invalide.")
  .transform((v) => (v === "" ? null : v));

export const CreateSupplierSchema = z.object({
  name: SupplierName,
  phone: SupplierPhone.optional(),
  email: SupplierEmail.optional(),
  category: SupplierCategoryField.optional(),
  leadTimeDays: LeadTime.default(0),
});

export const UpdateSupplierSchema = z
  .object({ supplierId: SupplierId, name: SupplierName.optional(), phone: SupplierPhone.optional(), email: SupplierEmail.optional(), category: SupplierCategoryField.optional(), leadTimeDays: LeadTime.optional() })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.email !== undefined || v.category !== undefined || v.leadTimeDays !== undefined, "Rien à modifier.");

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
  centerId: ObjectIdString,
  serviceId: ObjectIdString,
  productId: ObjectIdString,
  quantityPerService: z
    .number("Quantité entière attendue.")
    .int("Quantité entière attendue.")
    .min(1, "La quantité doit être positive.")
    .max(MAX_STOCK_QUANTITY, "Quantité trop grande."),
});

export const RecipeLineKeySchema = z.object({ centerId: ObjectIdString, serviceId: ObjectIdString, productId: ObjectIdString });

export const RecipeCenterSchema = z.object({ centerId: ObjectIdString });

export const RecipeServiceSchema = z.object({ centerId: ObjectIdString, serviceId: ObjectIdString });

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

// ── Transferts entre centres (F5.6) ──
// Les centres (fromCenterId, toCenterId) sont validés séparément par lib/stock/scope.ts. requestId : identifiant d'envoi généré par le client,
// qui rend le transfert idempotent (même identifiant = même transfert).
export const TRANSFER_HISTORY_DEFAULT_LIMIT = 10;
export const TRANSFER_HISTORY_MAX_LIMIT = 50;

const RequestId = z.string("Identifiant de demande invalide.").regex(/^[A-Za-z0-9_-]{16,64}$/, "Identifiant de demande invalide.");

// Motif libre (envoi, demande, retour, écart) : 200 caractères au plus ; vide = absent. Jamais repris dans le journal d'audit.
export const TRANSFER_NOTE_MAX = 200;
const TransferNote = z
  .string("Motif invalide.")
  .trim()
  .max(TRANSFER_NOTE_MAX, `${TRANSFER_NOTE_MAX} caractères au plus.`)
  .optional()
  .transform((v) => v || undefined);
const TransferQuantity = z.number("Quantité entière attendue.").int("Quantité entière attendue.").min(1, "La quantité doit être positive.").max(MAX_STOCK_QUANTITY, "Quantité trop grande.");

export const TransferProductSchema = z.object({ requestId: RequestId, productId: ObjectIdString, quantity: TransferQuantity, note: TransferNote });

export const TransferEquipmentSchema = z.object({ requestId: RequestId, equipmentId: EquipmentId, note: TransferNote });

export const TransferIdSchema = z.object({ transferId: ObjectIdString });

// Demande de transfert : le centre destinataire demande un produit à un autre centre (les centres sont validés par lib/stock/scope.ts).
export const TransferRequestSchema = z.object({ requestId: RequestId, productId: ObjectIdString, quantity: TransferQuantity, note: TransferNote });

// Réponse du centre source à une demande : accepter (le transfert part), refuser, ou retirer sa propre demande.
export const TransferAnswerSchema = z.object({ transferId: ObjectIdString, decision: z.enum(["ACCEPT", "REFUSE", "WITHDRAW"], "Décision invalide."), note: TransferNote });

// Confirmation de réception. Produit : quantité reçue (par défaut celle qui a été transférée) ; matériel : conforme ou non. Un écart exige un motif.
export const TransferReceiptSchema = z.object({
  transferId: ObjectIdString,
  receivedQuantity: z.number("Quantité entière attendue.").int("Quantité entière attendue.").min(0, "La quantité ne peut pas être négative.").max(MAX_STOCK_QUANTITY, "Quantité trop grande.").optional(),
  conforme: z.boolean("Valeur invalide.").optional(),
  note: TransferNote,
});

// Annulation d'un transfert terminé : un transfert en sens inverse (retour), avec un motif facultatif.
export const TransferReverseSchema = z.object({ transferId: ObjectIdString, note: TransferNote });

// Historique : pagination par curseur sur l'identifiant du transfert (du plus récent au plus ancien).
export const TransferHistorySchema = z.object({
  limit: z
    .number("Limite invalide.")
    .int("Limite invalide.")
    .min(1, "Limite invalide.")
    .max(TRANSFER_HISTORY_MAX_LIMIT, "Limite invalide.")
    .default(TRANSFER_HISTORY_DEFAULT_LIMIT),
  before: ObjectIdString.optional(),
  kind: z.enum(["PRODUCT", "EQUIPMENT"], "Type de transfert invalide.").optional(),
  status: z.enum(["PENDING", "COMPLETED", "CANCELLED", "REQUESTED", "REFUSED"], "Statut invalide.").optional(),
});
