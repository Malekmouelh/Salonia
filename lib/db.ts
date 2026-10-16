import mongoose from "mongoose";

const globalForMongoose = globalThis as unknown as {
  mongoose?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
};
const cached = (globalForMongoose.mongoose ??= { conn: null, promise: null });

// Connexion unique à MongoDB Atlas, réutilisée entre les requêtes et les rechargements à chaud.
export async function connectDB() {
  if (cached.conn) return cached.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant dans .env");

  cached.promise ??= mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB ?? "salonia",
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
  return cached.conn;
}
