import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// SalonEscrow (Module 3, Membre 1) : compteurs pour attribuer les numéros de la chaîne.
// Collection : escrowcounters. Un document par compteur : "center", "practitioner", "wallet".

function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

const EscrowCounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});
export const EscrowCounter = model("EscrowCounter", EscrowCounterSchema);
