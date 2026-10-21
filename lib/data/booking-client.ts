import "server-only";
import { isValidObjectId } from "mongoose";
import { connection } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/core";
import { auth } from "@/auth";

// Qui réserve sur la page publique : un client connecté, un compte salon, ou personne.
// Contrairement à getCurrentUser(), ne redirige jamais : la page reste visible sans compte.
export type BookingClient =
  | { kind: "client"; id: string; firstName: string; lastName: string; phone: string | null; email: string | null }
  | { kind: "staff"; firstName: string }
  | null;

export async function getBookingClient(): Promise<BookingClient> {
  // La session NextAuth dépend de la requête (cookie, heure d'expiration) : rendu à la requête.
  await connection();
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !isValidObjectId(userId)) return null;
  await connectDB();
  const user = await User.findById(userId).select("firstName lastName phone email role").lean();
  if (!user) return null;
  if (user.role !== "CLIENT") return { kind: "staff", firstName: user.firstName };
  return {
    kind: "client",
    id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? null,
    email: user.email ?? null,
  };
}
