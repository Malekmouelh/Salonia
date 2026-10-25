import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { TIMEOFF_KINDS } from "@/lib/enums";
import { MAX_TIMEOFF_REASON } from "@/lib/team/timeoff";

// Module 4 : Équipe. Collection : stafftimeoffs (congés et absences du personnel).
// ENREGISTREMENT SEUL : le moteur de réservation (lib/booking/) ne lit pas encore cette collection,
// les créneaux ne tiennent donc pas compte de ces absences. Distinct d'AvailabilityBlock, qui reste
// le mécanisme « Bloquer du temps » du calendrier.
//
// RISQUE DE CONCURRENCE (documenté) : deux absences du même employé ne doivent pas se chevaucher, mais ce contrôle
// est fait par le service (lecture puis écriture), pas par la base : MongoDB n'offre pas de contrainte de
// chevauchement de plages, et les transactions ne sont pas disponibles partout (base locale en mémoire). Deux
// créations simultanées peuvent donc passer toutes les deux et laisser deux absences qui se recouvrent. Ce contrôle
// est une aide à la saisie, pas une garantie : tout code qui lira ces absences doit traiter leur union.

const { ObjectId } = Schema.Types;

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

const StaffTimeOffSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    // Employé (User de rôle STAFF) : l'absence vaut pour tous ses centres.
    userId: { type: ObjectId, ref: "User", required: true },
    kind: { type: String, enum: TIMEOFF_KINDS, required: true },
    // Dates UTC (heure de Tunis, comme AvailabilityBlock). Fin exclusive : une journée complète va de minuit
    // local à minuit local du lendemain ; une plage horaire reste dans une seule journée.
    start: { type: Date, required: true },
    end: {
      type: Date,
      required: true,
      validate: { validator(this: { start?: Date }, value: Date) { return !this.start || value > this.start; }, message: "La fin doit être après le début." },
    },
    // true = journée(s) complète(s) ; false = plage horaire.
    allDay: { type: Boolean, required: true },
    // Peut contenir des informations sensibles (santé) : jamais dans la liste de l'équipe ni dans l'audit.
    reason: { type: String, trim: true, maxlength: MAX_TIMEOFF_REASON },
    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true },
);
StaffTimeOffSchema.index({ organizationId: 1, userId: 1, start: 1 });
StaffTimeOffSchema.index({ userId: 1, end: 1 });
export const StaffTimeOff = model("StaffTimeOff", StaffTimeOffSchema);
