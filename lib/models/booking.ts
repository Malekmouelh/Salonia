import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { BLOCK_KINDS, BOOKING_SOURCES, BOOKING_STATUSES, WAITLIST_STATUSES } from "@/lib/enums";

// Module 3 : Calendrier et réservations (Malek).
// Collections : customers, bookings, availabilityblocks, waitlistentries, notifications.

const { ObjectId } = Schema.Types;

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

// F3.6 — Fiche client (personne qui réserve, avec ou sans compte).
const CustomerSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    userId: { type: ObjectId, ref: "User", default: null },
    notes: String,
    // Consentement pour les rappels (cahier des charges §7, données personnelles).
    remindersConsent: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// Un même téléphone = un même client dans un salon.
CustomerSchema.index({ organizationId: 1, phone: 1 }, { unique: true });
CustomerSchema.index({ organizationId: 1, lastName: 1, firstName: 1 });
export const Customer = model("Customer", CustomerSchema);

// Prestation réservée, copiée au moment de la réservation (le prix ne change pas après coup).
const BookingItemSchema = new Schema(
  {
    serviceId: { type: ObjectId, ref: "Service", required: true },
    name: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    priceTnd: { type: Number, required: true },
  },
  { _id: false },
);

// F3.3 — Réservation : lie client, centre, service ou pack, praticien et créneau.
const BookingSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    customerId: { type: ObjectId, ref: "Customer", required: true },
    staffId: { type: ObjectId, ref: "User", required: true },
    items: { type: [BookingItemSchema], required: true },
    packId: { type: ObjectId, ref: "Pack", default: null },
    packName: String,
    totalTnd: { type: Number, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: { type: String, enum: BOOKING_STATUSES, default: "CONFIRMED" },
    source: { type: String, enum: BOOKING_SOURCES, default: "ONLINE" },
    notes: String,
    // Jeton (haché) du lien « gérer ma réservation » envoyé au client.
    manageTokenHash: { type: String, index: true, sparse: true },
    reminderSentAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    rescheduledFromStart: Date,
  },
  { timestamps: true },
);
BookingSchema.index({ centerId: 1, start: 1 });
BookingSchema.index({ staffId: 1, start: 1 });
BookingSchema.index({ customerId: 1, start: -1 });
BookingSchema.index({ organizationId: 1, start: 1 });
export const Booking = model("Booking", BookingSchema);

// F3.2 — Pauses, fermetures exceptionnelles et créneaux bloqués.
const AvailabilityBlockSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    // null = tout le centre (fermeture), sinon un seul praticien.
    staffId: { type: ObjectId, ref: "User", default: null },
    kind: { type: String, enum: BLOCK_KINDS, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    reason: String,
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);
AvailabilityBlockSchema.index({ centerId: 1, start: 1, end: 1 });
export const AvailabilityBlock = model("AvailabilityBlock", AvailabilityBlockSchema);

// F3.5 — Liste d'attente.
const WaitlistEntrySchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    customerId: { type: ObjectId, ref: "Customer", required: true },
    serviceId: { type: ObjectId, ref: "Service", required: true },
    staffId: { type: ObjectId, ref: "User", default: null },
    // Journée souhaitée (minuit, heure de Tunis).
    desiredDate: { type: Date, required: true },
    status: { type: String, enum: WAITLIST_STATUSES, default: "WAITING" },
    offeredStart: Date,
  },
  { timestamps: true },
);
WaitlistEntrySchema.index({ centerId: 1, desiredDate: 1, status: 1 });
export const WaitlistEntry = model("WaitlistEntry", WaitlistEntrySchema);

// Boîte d'envoi des messages (rappels, confirmations). Contrat pour le service de
// notifications du socle (F0.6) : un fournisseur SMS/WhatsApp lira les messages « QUEUED ».
const NotificationSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    bookingId: { type: ObjectId, ref: "Booking" },
    customerId: { type: ObjectId, ref: "Customer" },
    channel: { type: String, enum: ["SMS", "WHATSAPP", "EMAIL"], default: "WHATSAPP" },
    kind: { type: String, enum: ["CONFIRMATION", "REMINDER", "CANCELLATION", "WAITLIST_OFFER"], required: true },
    to: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ["QUEUED", "SENT", "FAILED"], default: "QUEUED" },
  },
  { timestamps: true },
);
NotificationSchema.index({ organizationId: 1, createdAt: -1 });
export const Notification = model("Notification", NotificationSchema);
