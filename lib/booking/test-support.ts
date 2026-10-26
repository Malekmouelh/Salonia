// Outils des tests de caractérisation du Module 3 (disponibilités et réservations).
// Ce fichier n'est pas un test : il n'est lancé que par les fichiers *.test.ts qui l'importent.
//
// Sécurité : la base utilisée est TOUJOURS un MongoDB éphémère en mémoire, sur 127.0.0.1.
// L'URI n'est jamais lue dans .env ; elle est imposée à lib/db.ts avant toute connexion, puis vérifiée.
// Aucun binaire n'est téléchargé : s'il manque, le test échoue avec un message explicite (pas de saut silencieux).
import { randomBytes } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDB } from "@/lib/db";
import { fromLocal } from "@/lib/booking/time";
import { AvailabilityBlock, Booking, Customer } from "@/lib/models/booking";
import { Service } from "@/lib/models/catalog";
import { Center, Organization, User } from "@/lib/models/core";

export type TestDb = { uri: string; dbName: string; stop: () => Promise<void> };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export async function startTestDb(): Promise<TestDb> {
  // Interdit tout téléchargement du binaire MongoDB pendant les tests.
  process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";

  let server: MongoMemoryServer;
  try {
    server = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "Impossible de démarrer MongoDB en mémoire pour les tests de réservation.",
        "Le binaire mongod est introuvable (il est mis en cache par `npm run db:local` dans node_modules/.cache/mongodb-memory-server)",
        "ou le serveur n'a pas pu démarrer. Les tests n'installent ni ne téléchargent rien.",
        `Cause : ${reason}`,
      ].join("\n"),
    );
  }

  const uri = server.getUri();
  const dbName = `salonia_test_${randomBytes(4).toString("hex")}`;
  const stop = async () => {
    try {
      await mongoose.disconnect();
    } finally {
      await server.stop();
    }
  };

  try {
    // 1. L'URI doit pointer vers la machine locale (instance en mémoire créée ci-dessus).
    const host = new URL(uri).hostname;
    if (!LOCAL_HOSTS.has(host)) throw new Error(`URI de test refusée (hôte non local : ${host}).`);

    // 2. Imposée à lib/db.ts (qui lit process.env à la première connexion), jamais lue depuis .env.
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DB = dbName;
    await connectDB();

    // 3. Vérification de la connexion réellement établie, avant toute opération sur la base.
    const conn = mongoose.connection;
    const port = new URL(uri).port;
    if (!LOCAL_HOSTS.has(conn.host) || String(conn.port) !== port || conn.name !== dbName) {
      throw new Error(`Connexion inattendue (${conn.host}:${conn.port}/${conn.name}) : tests interrompus.`);
    }
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
  return { uri, dbName, stop };
}

// Vide la base de test (vérifie encore qu'il s'agit bien de la base éphémère).
export async function resetTestDb(db: TestDb) {
  if (mongoose.connection.name !== db.dbName || !LOCAL_HOSTS.has(mongoose.connection.host)) {
    throw new Error("resetTestDb refusé : la connexion n'est pas la base de test en mémoire.");
  }
  await mongoose.connection.dropDatabase();
}

// ── Dates : jours de la semaine connus (heure de Tunis) ──
// 2030-01-06 = dimanche, 2030-01-07 = lundi, 2030-01-08 = mardi.
export const SUNDAY = fromLocal(2030, 1, 6);
export const MONDAY = fromLocal(2030, 1, 7);
export const TUESDAY = fromLocal(2030, 1, 8);
// Horaire local du lundi 7 janvier 2030 (« 09:30 » → Date).
export const at = (hour: number, minute = 0, day: Date = MONDAY) => new Date(day.getTime() + (hour * 60 + minute) * 60_000);

// 09:00-19:00 du lundi au samedi, fermé le dimanche.
export const WEEK_HOURS: Record<string, string | null> = {
  lundi: "09:00-19:00",
  mardi: "09:00-19:00",
  mercredi: "09:00-19:00",
  jeudi: "09:00-19:00",
  vendredi: "09:00-19:00",
  samedi: "09:00-19:00",
  dimanche: null,
};

let counter = 0;
const next = () => ++counter;

// ── Fixtures (données minimales et isolées) ──
export async function createOrg(name = "Salon Test") {
  return Organization.create({ name, slug: `salon-test-${next()}-${randomBytes(3).toString("hex")}` });
}

export async function createCenter(organizationId: Types.ObjectId | string, name = "Centre Test", openingHours: Record<string, string | null> | null = WEEK_HOURS) {
  return Center.create({ organizationId, name, governorate: "TUNIS", openingHours });
}

export async function createUser(
  organizationId: Types.ObjectId | string,
  centerIds: (Types.ObjectId | string)[],
  firstName: string,
  role: "STAFF" | "MANAGER" | "OWNER" = "STAFF",
) {
  const n = next();
  return User.create({ organizationId, firstName, lastName: "Test", email: `user${n}@test.local`, passwordHash: "not-a-real-hash", role, centerIds });
}

export async function createService(organizationId: Types.ObjectId | string, durationMinutes = 60, priceTnd = 50, name = "Prestation Test") {
  return Service.create({ organizationId, name, category: "Test", durationMinutes, priceTnd });
}

export async function createCustomer(organizationId: Types.ObjectId | string, remindersConsent = true) {
  const n = next();
  return Customer.create({ organizationId, firstName: "Client", lastName: `N${n}`, phone: `2000${String(n).padStart(4, "0")}`, remindersConsent });
}

// Insère directement un rendez-vous (sans passer par createBooking, donc sans contrôle de disponibilité).
export async function insertBooking(p: {
  organizationId: Types.ObjectId | string;
  centerId: Types.ObjectId | string;
  staffId: Types.ObjectId | string;
  customerId: Types.ObjectId | string;
  start: Date;
  minutes: number;
  status?: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
}) {
  return Booking.create({
    organizationId: p.organizationId,
    centerId: p.centerId,
    staffId: p.staffId,
    customerId: p.customerId,
    items: [{ serviceId: new Types.ObjectId(), name: "Prestation Test", durationMinutes: p.minutes, priceTnd: 50 }],
    totalTnd: 50,
    start: p.start,
    end: new Date(p.start.getTime() + p.minutes * 60_000),
    status: p.status ?? "CONFIRMED",
    source: "STAFF",
  });
}

export async function insertBlock(p: {
  organizationId: Types.ObjectId | string;
  centerId: Types.ObjectId | string;
  staffId: Types.ObjectId | string | null;
  start: Date;
  end: Date;
  kind?: "BREAK" | "CLOSURE" | "BLOCK";
}) {
  return AvailabilityBlock.create({ ...p, kind: p.kind ?? (p.staffId ? "BLOCK" : "CLOSURE") });
}
