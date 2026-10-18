import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { AUTH_EVENT_TYPES, GOVERNORATE_CODES, ROLES } from "@/lib/enums";

// Socle : comptes, rôles et multi-centres.
// Toutes les collections métier portent organizationId (isolation entre salons).

const { ObjectId } = Schema.Types;

// Réutilise le modèle déjà compilé (rechargement à chaud de Next.js).
function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

const OrganizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    // Catalogue proposé par l'assistant IA, à importer par le module Catalogue.
    catalogDraft: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
export const Organization = model("Organization", OrganizationSchema);

const CenterSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true },
    governorate: { type: String, enum: GOVERNORATE_CODES, required: true },
    address: String,
    phone: String,
    photos: [{ type: String }],
    // { lundi: "09:00-19:00", dimanche: null, ... }
    openingHours: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
export const Center = model("Center", CenterSchema);

const UserSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", default: null, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    // sparse : plusieurs comptes peuvent ne pas avoir d'e-mail ou de téléphone.
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: "CLIENT" },
    // Centres d'affectation (gérant, staff). Remplace la table de liaison du modèle SQL.
    centerIds: [{ type: ObjectId, ref: "Center" }],
    lastLoginAt: Date,
  },
  { timestamps: true },
);
export const User = model("User", UserSchema);

const PasswordResetTokenSchema = new Schema({
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  // Index TTL : MongoDB supprime le jeton automatiquement à expiration.
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: Date,
});
export const PasswordResetToken = model("PasswordResetToken", PasswordResetTokenSchema);

// Journal des actions sensibles (cahier des charges §7, Sécurité).
const AuthEventSchema = new Schema(
  {
    type: { type: String, enum: AUTH_EVENT_TYPES, required: true },
    userId: { type: ObjectId, ref: "User", default: null },
    organizationId: { type: ObjectId, ref: "Organization", default: null },
    ip: String,
    userAgent: String,
    detail: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AuthEventSchema.index({ userId: 1, createdAt: -1 });
AuthEventSchema.index({ organizationId: 1, createdAt: -1 });
export const AuthEvent = model("AuthEvent", AuthEventSchema);
