import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { connectDB } from "@/lib/db";
import type { Governorate } from "@/lib/enums";
import { Pack, Service } from "@/lib/models/catalog";
import { Center, Organization, User } from "@/lib/models/core";

// Annuaire des salons pour les clients : uniquement les salons réservables en ligne
// (au moins une prestation active et un praticien rattaché à l'un de leurs centres).
export type SalonCard = {
  slug: string;
  name: string;
  photo: string | null;
  centers: { name: string; governorate: Governorate; address: string | null }[];
  categories: string[];
  servicesCount: number;
  packsCount: number;
  priceFrom: number | null;
};

// Mis en cache quelques minutes (les salons et catalogues changent peu) ; invalidable par le tag « salons ».
export async function getSalonDirectory(): Promise<SalonCard[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("salons");

  await connectDB();
  const [services, packs] = await Promise.all([
    Service.find({ active: true }).select("organizationId category priceTnd photos").lean(),
    Pack.find({ active: true }).select("organizationId").lean(),
  ]);
  const orgIds = [...new Set(services.map((s) => String(s.organizationId)))];
  if (orgIds.length === 0) return [];
  const [orgs, allCenters, staff] = await Promise.all([
    Organization.find({ _id: { $in: orgIds } }).select("name slug").lean(),
    Center.find({ organizationId: { $in: orgIds } }).sort({ createdAt: 1 }).select("organizationId name governorate address photos").lean(),
    User.find({ organizationId: { $in: orgIds }, role: "STAFF" }).select("centerIds").lean(),
  ]);
  // Un centre sans praticien n'a aucun créneau : il n'apparaît pas.
  const staffed = new Set(staff.flatMap((u) => (u.centerIds ?? []).map(String)));
  const centers = allCenters.filter((c) => staffed.has(String(c._id)));

  return orgs
    .map((o) => {
      const id = String(o._id);
      const own = services.filter((s) => String(s.organizationId) === id);
      const ownCenters = centers.filter((c) => String(c.organizationId) === id);
      const photo = ownCenters.find((c) => c.photos?.length)?.photos?.[0] ?? own.find((s) => s.photos?.length)?.photos?.[0] ?? null;
      return {
        slug: o.slug,
        name: o.name,
        photo: photo ? String(photo) : null,
        centers: ownCenters.map((c) => ({ name: c.name, governorate: c.governorate as Governorate, address: c.address ?? null })),
        categories: [...new Set(own.map((s) => s.category))].sort(),
        servicesCount: own.length,
        packsCount: packs.filter((p) => String(p.organizationId) === id).length,
        priceFrom: own.length ? Math.min(...own.map((s) => s.priceTnd)) : null,
      };
    })
    .filter((s) => s.centers.length > 0)
    .sort((a, b) => b.servicesCount - a.servicesCount || a.name.localeCompare(b.name));
}
