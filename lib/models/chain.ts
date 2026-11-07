import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { connectDB } from "@/lib/db";

// SalonEscrow + MetaMask : base MongoDB SÉPARÉE réservée à la blockchain (même serveur, autre base).
// Nom : CHAIN_MONGODB_DB, sinon « <MONGODB_DB>_chain » (ex. salonia_chain). Le lien avec Salonia se fait par userId.
// Aucune clé privée n'y est jamais stockée : MetaMask garde la clé, la base ne connaît que l'adresse publique.

const WalletAccountSchema = new Schema(
  {
    // Adresse publique MetaMask, en minuscules (comparaison sans casse).
    address: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Identifiant du compte Salonia (collection users de la base principale). Un wallet par compte.
    userId: { type: String, required: true, unique: true },
    linkedAt: { type: Date, required: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Nonce « Sign-In With Ethereum » : à usage unique, expire seul (index TTL).
const WalletNonceSchema = new Schema({
  nonce: { type: String, required: true, unique: true },
  purpose: { type: String, enum: ["login", "link"], required: true },
  // Pour une liaison : le compte connecté qui a demandé le nonce.
  userId: { type: String, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
});

export const chainDbName = () => process.env.CHAIN_MONGODB_DB || `${process.env.MONGODB_DB ?? "salonia"}_chain`;

type ChainModels = {
  WalletAccount: Model<InferSchemaType<typeof WalletAccountSchema>>;
  WalletNonce: Model<InferSchemaType<typeof WalletNonceSchema>>;
};

// Même pool de connexions que Salonia (useDb), base différente.
export async function chainModels(): Promise<ChainModels> {
  await connectDB();
  const db = mongoose.connection.useDb(chainDbName(), { useCache: true });
  return {
    WalletAccount: (db.models.WalletAccount as ChainModels["WalletAccount"]) ?? db.model("WalletAccount", WalletAccountSchema),
    WalletNonce: (db.models.WalletNonce as ChainModels["WalletNonce"]) ?? db.model("WalletNonce", WalletNonceSchema),
  };
}
