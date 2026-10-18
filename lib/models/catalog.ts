import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT avec le Module 2 (Catalogue — Maya).
// Version minimale dont le Module 3 a besoin pour réserver : nom, durée, prix, centres.
// Le Module 2 est propriétaire de ces collections et peut les enrichir
// (options, variantes, photos, promotions) sans casser les champs ci-dessous.
// ─────────────────────────────────────────────────────────────────────────────

const { ObjectId } = Schema.Types;

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

const ServiceSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, required: true, min: 5 },
    priceTnd: { type: Number, required: true, min: 0 },
    // Centres où le service est proposé (vide = tous les centres).
    centerIds: [{ type: ObjectId, ref: "Center" }],
    active: { type: Boolean, default: true },
    // F2.5 — Description et photos
    description: { type: String, trim: true, default: "" },
    photos: [{ type: String }],
    // F2.4 — Tarifs par centre (surcharge du prix global)
    centerPrices: [
      {
        centerId: { type: ObjectId, ref: "Center", required: true },
        priceTnd: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],
    // F2.2 — Options et variantes
    options: [
      {
        name: { type: String, required: true, trim: true },
        values: [
          {
            label: { type: String, required: true, trim: true },
            extraPriceTnd: { type: Number, default: 0 },
            extraDurationMinutes: { type: Number, default: 0 },
            _id: false,
          },
        ],
        _id: false,
      },
    ],
    // F2.6 — Compétences requises et matériel
    requiredSkills: [{ type: String, trim: true }],
    requiredEquipment: [{ type: String, trim: true }],
    // Ordre d'affichage
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const Service = model("Service", ServiceSchema);

const PackSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    serviceIds: [{ type: ObjectId, ref: "Service", required: true }],
    priceTnd: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    // F2.3 — Enrichissement packs
    description: { type: String, trim: true, default: "" },
    photos: [{ type: String }],
    // F2.4 — Tarifs par centre
    centerPrices: [
      {
        centerId: { type: ObjectId, ref: "Center", required: true },
        priceTnd: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],
    centerIds: [{ type: ObjectId, ref: "Center" }], // Disponibilité par centre (vide = tous)
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const Pack = model("Pack", PackSchema);

const PromotionSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true },
    type: { type: String, enum: ["PERCENTAGE", "FIXED_AMOUNT"] as const, required: true },
    value: { type: Number, required: true, min: 0 },
    serviceIds: [{ type: ObjectId, ref: "Service" }],
    packIds: [{ type: ObjectId, ref: "Pack" }],
    centerIds: [{ type: ObjectId, ref: "Center" }],
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// Code unique par salon ; plusieurs promotions sans code restent possibles.
PromotionSchema.index({ organizationId: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } });
export const Promotion = model("Promotion", PromotionSchema);
