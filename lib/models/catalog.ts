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
  },
  { timestamps: true },
);
export const Pack = model("Pack", PackSchema);
