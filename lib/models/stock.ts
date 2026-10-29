import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { EQUIPMENT_STATUSES, PURCHASE_ORDER_STATUSES, STOCK_MOVEMENT_KINDS, STOCK_TRANSFER_KINDS, STOCK_TRANSFER_STATUSES, STOCK_UNITS } from "@/lib/enums";

// Module 5 : Matériel et stock (Syrine). Schéma de référence : docs/module-5-schema.md.
// Collections : equipment, stockproducts, stocklevels, servicerecipes, stockmovements, maintenancerecords, suppliers, purchaseorders, stocktransfers.
//
// Ce fichier ne contient que les structures et contraintes de données. Il ne garantit PAS à lui seul :
//  - l'isolation par organisation et par centre (droits, services et requêtes filtrées viendront dans les étapes suivantes) ;
//  - l'idempotence ni la cohérence journal/niveau (mécanisme D6 conditionnel, à démontrer par des tests avant toute intégration).
// Règles non portées par le modèle (à appliquer par le futur service de stock) : unité d'un produit non modifiable
// dès qu'un mouvement existe ; StockLevel.quantity et StockLevel.seq ne sont écrits que par la projection du journal.

const { ObjectId } = Schema.Types;

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

// Quantités entières (unités de base PIECE, ML, G) : pas de décimales, donc pas d'erreur d'arrondi.
const integer = { validator: Number.isInteger, message: "{PATH} doit être un entier." };
const MAX_MOVEMENT_NOTE = 120;
const MAX_MAINTENANCE_NOTE = 200;
const MAX_ORDER_LINES = 50;

// F5.1 / F5.4 — Un document par appareil physique (l'identifiant est l'_id MongoDB). Historique de maintenance : étape F5.4.
const EquipmentSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    status: { type: String, enum: EQUIPMENT_STATUSES, default: "IN_SERVICE" },
    acquiredAt: Date,
    nextMaintenanceAt: { type: Date, default: null },
    // Archivage plutôt que suppression : l'historique reste consultable.
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
EquipmentSchema.index({ organizationId: 1, centerId: 1, active: 1 });
EquipmentSchema.index({ organizationId: 1, nextMaintenanceAt: 1 });
export const Equipment = model("Equipment", EquipmentSchema);

// F5.2 — Définition commune d'un produit consommable (niveau organisation, gérée par OWNER).
const StockProductSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, enum: STOCK_UNITS, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// Nom unique par organisation, sans tenir compte de la casse, parmi les produits actifs.
// Les requêtes qui doivent s'appuyer sur cet index utilisent la même collation.
StockProductSchema.index(
  { organizationId: 1, name: 1 },
  { unique: true, partialFilterExpression: { active: true }, collation: { locale: "fr", strength: 2 } },
);
export const StockProduct = model("StockProduct", StockProductSchema);

// F5.2 — Niveau d'un produit dans un centre. quantity et seq sont une PROJECTION du journal StockMovement :
// jamais saisies par l'utilisateur, jamais modifiées hors du futur service de stock.
const StockLevelSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    productId: { type: ObjectId, ref: "StockProduct", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    alertThreshold: { type: Number, default: 0, min: 0, validate: integer },
    quantity: { type: Number, default: 0, min: 0, validate: integer },
    // Rang du dernier mouvement projeté (0 = aucun).
    seq: { type: Number, default: 0, min: 0, validate: integer },
  },
  { timestamps: true },
);
StockLevelSchema.index({ productId: 1, centerId: 1 }, { unique: true });
StockLevelSchema.index({ organizationId: 1, centerId: 1 });
export const StockLevel = model("StockLevel", StockLevelSchema);

// F5.3 — Quantité de produit consommée par prestation (gérée par OWNER). Ignore les options choisies par le client.
const ServiceRecipeSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    serviceId: { type: ObjectId, ref: "Service", required: true },
    productId: { type: ObjectId, ref: "StockProduct", required: true },
    quantityPerService: { type: Number, required: true, min: 1, validate: integer },
  },
  { timestamps: true },
);
ServiceRecipeSchema.index({ serviceId: 1, productId: 1 }, { unique: true });
ServiceRecipeSchema.index({ organizationId: 1, serviceId: 1 });
export const ServiceRecipe = model("ServiceRecipe", ServiceRecipeSchema);

// F5.3 — Journal des mouvements : ajouté-seulement, source de vérité du stock.
// Chaque champ est « immutable » : un mouvement enregistré ne se modifie pas (une erreur se corrige par un ADJUSTMENT).
// Le rang (seq) et le solde (balanceAfter) sont calculés par le futur service ; le modèle ne fait que les contraindre.
const StockMovementSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, immutable: true },
    centerId: { type: ObjectId, ref: "Center", required: true, immutable: true },
    productId: { type: ObjectId, ref: "StockProduct", required: true, immutable: true },
    kind: { type: String, enum: STOCK_MOVEMENT_KINDS, required: true, immutable: true },
    // Rang du mouvement dans le journal de (produit, centre) : 1, 2, 3…
    seq: { type: Number, required: true, min: 1, validate: integer, immutable: true },
    // Variation réellement appliquée (négative pour une sortie).
    delta: { type: Number, required: true, validate: integer, immutable: true },
    balanceAfter: { type: Number, required: true, min: 0, validate: integer, immutable: true },
    // CONSUMPTION seulement : quantité demandée par la recette et quantité manquante (requested = -delta + shortfall).
    requested: { type: Number, min: 1, validate: integer, immutable: true },
    shortfall: { type: Number, min: 0, validate: integer, immutable: true },
    bookingId: { type: ObjectId, ref: "Booking", immutable: true },
    // RECEIPT seulement : commande d'achat reçue (une réception par commande et par produit).
    purchaseOrderId: { type: ObjectId, ref: "PurchaseOrder", immutable: true },
    // TRANSFER_OUT / TRANSFER_IN seulement : transfert entre centres (un seul mouvement de chaque sens par transfert et par produit).
    transferId: { type: ObjectId, ref: "StockTransfer", immutable: true },
    note: { type: String, trim: true, maxlength: MAX_MOVEMENT_NOTE, immutable: true },
    createdBy: { type: ObjectId, ref: "User", immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Cohérence interne d'un mouvement (ne remplace pas les contrôles du service, qui connaîtra le journal).
StockMovementSchema.pre("validate", function () {
  const { kind, delta, seq, requested, shortfall, bookingId, note, purchaseOrderId, transferId } = this;
  const consumption = kind === "CONSUMPTION";

  if (!consumption && (requested != null || shortfall != null)) {
    this.invalidate("requested", "Quantité demandée et manquante : consommation seulement.");
  }
  if (typeof delta !== "number") return;

  if ((kind === "OPENING" || kind === "IN") && delta <= 0) this.invalidate("delta", "Une entrée doit être positive.");
  if (kind === "OUT" && delta >= 0) this.invalidate("delta", "Une sortie doit être négative.");
  if (kind === "ADJUSTMENT") {
    if (delta === 0) this.invalidate("delta", "Une correction ne peut pas être nulle.");
    if (!note) this.invalidate("note", "Une correction exige une note.");
  }
  if (kind === "OPENING" && seq !== 1) this.invalidate("seq", "Le stock initial est le mouvement de rang 1.");
  if (kind === "RECEIPT") {
    if (delta <= 0) this.invalidate("delta", "Une réception doit être positive.");
    if (!purchaseOrderId) this.invalidate("purchaseOrderId", "Une réception est liée à une commande d'achat.");
  } else if (purchaseOrderId) {
    this.invalidate("purchaseOrderId", "Seule une réception est liée à une commande d'achat.");
  }

  const transfer = kind === "TRANSFER_OUT" || kind === "TRANSFER_IN";
  if (kind === "TRANSFER_OUT" && delta >= 0) this.invalidate("delta", "Un transfert sortant doit être négatif.");
  if (kind === "TRANSFER_IN" && delta <= 0) this.invalidate("delta", "Un transfert entrant doit être positif.");
  if (transfer && !transferId) this.invalidate("transferId", "Un mouvement de transfert est lié à un transfert.");
  else if (!transfer && transferId) this.invalidate("transferId", "Seul un mouvement de transfert est lié à un transfert.");

  if (consumption) {
    if (delta > 0) this.invalidate("delta", "Une consommation ne peut pas être positive.");
    if (!bookingId) this.invalidate("bookingId", "Une consommation est liée à un rendez-vous.");
    if (requested == null || shortfall == null) {
      this.invalidate("requested", "Une consommation indique la quantité demandée et la quantité manquante.");
    } else if (requested !== -delta + shortfall) {
      this.invalidate("shortfall", "La quantité demandée doit égaler la quantité consommée plus la quantité manquante.");
    }
  }
});

StockMovementSchema.index({ productId: 1, centerId: 1, seq: 1 }, { unique: true });
// Une seule consommation par (rendez-vous, produit) : socle de l'idempotence (à démontrer par des tests).
StockMovementSchema.index({ bookingId: 1, productId: 1 }, { unique: true, partialFilterExpression: { kind: "CONSUMPTION" } });
// Une seule réception par (commande d'achat, produit) : socle de l'idempotence de la réception (à démontrer par des tests).
StockMovementSchema.index({ purchaseOrderId: 1, productId: 1 }, { unique: true, partialFilterExpression: { kind: "RECEIPT" } });
// Un seul TRANSFER_OUT et un seul TRANSFER_IN par (transfert, produit) : socle de l'idempotence des transferts. Index partiel : les
// mouvements existants (sans transferId) n'y entrent pas, aucune migration.
StockMovementSchema.index({ transferId: 1, productId: 1, kind: 1 }, { unique: true, partialFilterExpression: { transferId: { $exists: true } } });
StockMovementSchema.index({ organizationId: 1, centerId: 1, productId: 1, createdAt: -1 });
StockMovementSchema.index({ productId: 1, centerId: 1, kind: 1, createdAt: 1 });
StockMovementSchema.index({ organizationId: 1, centerId: 1, createdAt: -1 });
export const StockMovement = model("StockMovement", StockMovementSchema);

// F5.4 — Historique de maintenance : ajouté-seulement. Chaque champ est « immutable » ; aucune modification ni suppression
// n'est exposée par les services. Les dates sont des jours (minuit, heure de Tunis).
const MaintenanceRecordSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, immutable: true },
    centerId: { type: ObjectId, ref: "Center", required: true, immutable: true },
    equipmentId: { type: ObjectId, ref: "Equipment", required: true, immutable: true },
    performedAt: { type: Date, required: true, immutable: true },
    note: { type: String, trim: true, maxlength: MAX_MAINTENANCE_NOTE, immutable: true },
    // Prochaine échéance décidée lors de cette intervention (reportée sur Equipment.nextMaintenanceAt par le service).
    nextDueAt: { type: Date, immutable: true },
    createdBy: { type: ObjectId, ref: "User", immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
MaintenanceRecordSchema.pre("validate", function () {
  if (this.nextDueAt && this.performedAt && this.nextDueAt < this.performedAt) {
    this.invalidate("nextDueAt", "L'échéance suivante ne peut pas précéder l'intervention.");
  }
});
MaintenanceRecordSchema.index({ equipmentId: 1, performedAt: -1 });
MaintenanceRecordSchema.index({ organizationId: 1, centerId: 1, performedAt: -1 });
export const MaintenanceRecord = model("MaintenanceRecord", MaintenanceRecordSchema);

// F5.5 — Fournisseur (niveau organisation). Archivé (active: false) plutôt que supprimé : les commandes gardent leur référence.
const SupplierSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    // Délai de livraison en jours (entrée de la future prévision).
    leadTimeDays: { type: Number, default: 0, min: 0, max: 365, validate: integer },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
SupplierSchema.index(
  { organizationId: 1, name: 1 },
  { unique: true, partialFilterExpression: { active: true }, collation: { locale: "fr", strength: 2 } },
);
export const Supplier = model("Supplier", SupplierSchema);

// F5.5 — Commande d'achat. Les lignes recopient le nom et l'unité du produit, et la commande le nom du fournisseur,
// pour que l'historique reste lisible même si ces fiches changent ou sont archivées.
// Créer ou passer une commande ne modifie JAMAIS le stock (la réception n'existe pas encore).
const PurchaseOrderLineSchema = new Schema(
  {
    productId: { type: ObjectId, ref: "StockProduct", required: true },
    productName: { type: String, required: true, trim: true },
    unit: { type: String, enum: STOCK_UNITS, required: true },
    quantity: { type: Number, required: true, min: 1, validate: integer },
  },
  { _id: false },
);
const PurchaseOrderSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    supplierId: { type: ObjectId, ref: "Supplier", required: true },
    supplierName: { type: String, required: true, trim: true },
    status: { type: String, enum: PURCHASE_ORDER_STATUSES, default: "DRAFT" },
    lines: {
      type: [PurchaseOrderLineSchema],
      validate: [
        { validator: (lines: unknown[]) => lines.length >= 1 && lines.length <= MAX_ORDER_LINES, message: `Une commande compte de 1 à ${MAX_ORDER_LINES} lignes.` },
        {
          validator: (lines: { productId: unknown }[]) => new Set(lines.map((l) => String(l.productId))).size === lines.length,
          message: "Un produit ne peut figurer qu'une fois dans une commande.",
        },
      ],
    },
    orderedAt: Date,
    cancelledAt: Date,
    // Début de la réception (posé atomiquement, une seule fois) : dès lors la commande ne peut plus être annulée et la
    // réception se reprend jusqu'au bout. receivedAt n'est posé qu'une fois toutes les lignes enregistrées ET projetées.
    receiptStartedAt: { type: Date, default: null },
    receivedAt: Date,
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);
PurchaseOrderSchema.index({ organizationId: 1, centerId: 1, status: 1, createdAt: -1 });
PurchaseOrderSchema.index({ supplierId: 1, createdAt: -1 });
export const PurchaseOrder = model("PurchaseOrder", PurchaseOrderSchema);

// F5.6 — Transfert entre centres. Un document par transfert, créé AVANT tout effet (statut PENDING) puis terminé (COMPLETED) ou abandonné
// sans effet (CANCELLED). Produit : les mouvements TRANSFER_OUT (source) et TRANSFER_IN (destination) du journal portent son identifiant ;
// la quantité transférée peut être inférieure à la quantité demandée (plafond au stock disponible). Matériel : le document est la trace
// du changement de centre (l'équipement garde son _id et son historique de maintenance). requestId (fourni par le client, unique par
// organisation) rend l'envoi idempotent : un nouvel envoi retrouve le même transfert.
const StockTransferSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, immutable: true },
    requestId: { type: String, required: true, trim: true, immutable: true },
    kind: { type: String, enum: STOCK_TRANSFER_KINDS, required: true, immutable: true },
    fromCenterId: { type: ObjectId, ref: "Center", required: true, immutable: true },
    toCenterId: { type: ObjectId, ref: "Center", required: true, immutable: true },
    productId: { type: ObjectId, ref: "StockProduct", immutable: true },
    equipmentId: { type: ObjectId, ref: "Equipment", immutable: true },
    // Produit seulement : quantité demandée (immuable) et quantité réellement transférée (posée à la fin ; 0 si rien n'a pu l'être).
    requestedQuantity: { type: Number, min: 1, validate: integer, immutable: true },
    // null tant que le transfert n'est pas terminé (le validateur d'entier de Mongoose refuserait null).
    transferredQuantity: { type: Number, min: 0, validate: { validator: (v: unknown) => v == null || Number.isInteger(v), message: "{PATH} doit être un entier." }, default: null },
    status: { type: String, enum: STOCK_TRANSFER_STATUSES, default: "PENDING" },
    createdBy: { type: ObjectId, ref: "User", immutable: true },
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true },
);
StockTransferSchema.pre("validate", function () {
  const { kind, fromCenterId, toCenterId, productId, equipmentId, requestedQuantity, transferredQuantity } = this;
  if (fromCenterId && toCenterId && String(fromCenterId) === String(toCenterId)) this.invalidate("toCenterId", "Les centres source et destination doivent être différents.");
  if (kind === "PRODUCT") {
    if (!productId) this.invalidate("productId", "Un transfert de produit désigne un produit.");
    if (requestedQuantity == null) this.invalidate("requestedQuantity", "Un transfert de produit indique la quantité demandée.");
    if (equipmentId) this.invalidate("equipmentId", "Un transfert de produit ne désigne pas d'équipement.");
    if (transferredQuantity != null && requestedQuantity != null && transferredQuantity > requestedQuantity) this.invalidate("transferredQuantity", "La quantité transférée ne peut pas dépasser la quantité demandée.");
  } else if (kind === "EQUIPMENT") {
    if (!equipmentId) this.invalidate("equipmentId", "Un transfert de matériel désigne un équipement.");
    if (productId || requestedQuantity != null || transferredQuantity != null) this.invalidate("productId", "Un transfert de matériel n'a ni produit ni quantité.");
  }
});
StockTransferSchema.index({ organizationId: 1, requestId: 1 }, { unique: true });
// Un équipement ne peut avoir qu'un seul transfert en cours (« déjà en transfert »).
StockTransferSchema.index({ equipmentId: 1 }, { unique: true, partialFilterExpression: { kind: "EQUIPMENT", status: "PENDING" } });
StockTransferSchema.index({ organizationId: 1, fromCenterId: 1, createdAt: -1 });
StockTransferSchema.index({ organizationId: 1, toCenterId: 1, createdAt: -1 });
export const StockTransfer = model("StockTransfer", StockTransferSchema);
