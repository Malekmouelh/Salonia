import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { Types } from "mongoose";
import { getPractitioners } from "@/lib/booking/availability";
import { hashManageToken } from "@/lib/booking/create";
import { DEFAULT_HOURS } from "@/lib/booking/time";
import type { PackOption, ServiceOption } from "@/lib/booking/types";
import { connectDB } from "@/lib/db";
import type { BookingStatus, Governorate } from "@/lib/enums";
import { Booking, Customer } from "@/lib/models/booking";
import { Center, Organization } from "@/lib/models/core";
import { getCatalog } from "./bookings";

// Données publiques d'un salon pour la page de réservation (aucune donnée personnelle).
export type PublicSalon = {
  id: string;
  slug: string;
  name: string;
  centers: {
    id: string;
    name: string;
    governorate: Governorate;
    address: string | null;
    openingHours: Record<string, string | null>;
    practitioners: { id: string; name: string }[];
  }[];
  services: ServiceOption[];
  packs: PackOption[];
};

// Mis en cache quelques minutes : la vitrine publique se charge vite (objectif < 3 s en 4G).
// Le Module 2 pourra invalider avec revalidateTag(`salon:${slug}`) après une modification du catalogue.
export async function getPublicSalon(slug: string): Promise<PublicSalon | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`salon:${slug}`);
  await connectDB();
  const org = await Organization.findOne({ slug }).lean();
  if (!org) return null;
  const organizationId = String(org._id);
  const [centers, catalog] = await Promise.all([
    Center.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    getCatalog(organizationId),
  ]);
  const practitioners = await Promise.all(centers.map((c) => getPractitioners(organizationId, String(c._id))));
  return {
    id: organizationId,
    slug: org.slug,
    name: org.name,
    centers: centers.map((c, i) => ({
      id: String(c._id),
      name: c.name,
      governorate: c.governorate as Governorate,
      address: c.address ?? null,
      openingHours: (c.openingHours as Record<string, string | null> | null) ?? DEFAULT_HOURS,
      // Prénom + initiale seulement côté public.
      practitioners: practitioners[i].map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName[0]}.` })),
    })),
    services: catalog.services,
    packs: catalog.packs,
  };
}

// Réservation retrouvée via le lien « gérer ma réservation » (jeton haché en base).
export async function getBookingByToken(token: string) {
  // Toujours à jour : le statut peut changer à tout moment.
  await connection();
  if (!token || token.length < 20) return null;
  await connectDB();
  const booking = await Booking.findOne({ manageTokenHash: hashManageToken(token) }).lean();
  if (!booking) return null;
  const [org, center, customer] = await Promise.all([
    Organization.findById(booking.organizationId).select("name slug").lean(),
    Center.findById(booking.centerId).select("name address").lean(),
    Customer.findById(booking.customerId).select("firstName").lean(),
  ]);
  if (!org || !center || !customer) return null;
  return {
    id: String(booking._id),
    salon: { name: org.name, slug: org.slug },
    center: { id: String(booking.centerId), name: center.name, address: center.address ?? null },
    customerFirstName: customer.firstName,
    start: booking.start.toISOString(),
    end: booking.end.toISOString(),
    status: booking.status as BookingStatus,
    services: booking.items.map((i) => i.name),
    serviceIds: booking.items.map((i) => String(i.serviceId)),
    packId: booking.packId ? String(booking.packId) : null,
    packName: booking.packName ?? null,
    totalTnd: booking.totalTnd,
    staffId: String(booking.staffId),
    durationMinutes: (booking.end.getTime() - booking.start.getTime()) / 60000,
  };
}

export type ManagedBooking = NonNullable<Awaited<ReturnType<typeof getBookingByToken>>>;

export const isObjectId = (id: unknown): id is string => typeof id === "string" && Types.ObjectId.isValid(id);
