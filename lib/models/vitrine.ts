import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Module 1 : Vitrine et personnalisation (Ghalia).
// Collections : reviews (avis clients), realizations (galerie de réalisations).
// Les deux portent organizationId (isolation multi-tenant, comme toutes les collections métier).

const { ObjectId } = Schema.Types;

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

// F1.5 — Avis clients. Un avis est soumis publiquement puis modéré par le salon.
// Un avis lié à un rendez-vous COMPLETED peut être approuvé automatiquement (« avis vérifié »).
const REVIEW_STATUSES = ["PENDING", "APPROVED", "HIDDEN"] as const;

const ReviewSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", default: null },
    customerId: { type: ObjectId, ref: "Customer", default: null },
    bookingId: { type: ObjectId, ref: "Booking", default: null },
    authorName: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500, default: "" },
    status: { type: String, enum: REVIEW_STATUSES, default: "PENDING" },
  },
  { timestamps: true },
);
ReviewSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ organizationId: 1, centerId: 1, status: 1 });
export const Review = model("Review", ReviewSchema);

// F1.5 — Galerie de réalisations (avant/après, coiffures, soins…).
// Les photos sont stockées en data-URL WebP (même mécanisme que les photos des centres et du catalogue).
const RealizationSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", default: null },
    title: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "" },
    photo: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
RealizationSchema.index({ organizationId: 1, active: 1, createdAt: -1 });
export const Realization = model("Realization", RealizationSchema);
