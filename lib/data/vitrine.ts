import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { Types } from "mongoose";
import { getPractitioners } from "@/lib/booking/availability";
import { DEFAULT_HOURS } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { Governorate } from "@/lib/enums";
import { Center, Organization } from "@/lib/models/core";
import { Realization, Review } from "@/lib/models/vitrine";
import {
  DEFAULT_FEATURES_CONFIG,
  DEFAULT_THEME_CONFIG,
  type FeaturesConfig,
  type ThemeConfig,
} from "@/lib/vitrine/schemas";
import { getCatalog } from "./bookings";

export type PublicShowcaseCenter = {
  id: string;
  name: string;
  governorate: Governorate;
  address: string | null;
  phone: string | null;
  photos: string[];
  openingHours: Record<string, string | null>;
  practitioners: { id: string; name: string }[];
};

export type PublicReviewItem = {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
  centerId: string | null;
};

export type PublicRealizationItem = {
  id: string;
  title: string;
  category: string;
  photo: string;
  centerId: string | null;
  createdAt: string;
};

export type PublicSalonShowcase = {
  id: string;
  slug: string;
  name: string;
  theme: ThemeConfig;
  features: FeaturesConfig;
  centers: PublicShowcaseCenter[];
  services: any[];
  packs: any[];
  reviews: PublicReviewItem[];
  reviewStats: { average: number; count: number };
  realizations: PublicRealizationItem[];
};

export async function getPublicSalonShowcase(slug: string): Promise<PublicSalonShowcase | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`salon:${slug}`);

  await connectDB();
  const org = await Organization.findOne({ slug }).lean();
  if (!org) return null;

  const organizationId = String(org._id);

  const [centers, catalog, reviews, realizations] = await Promise.all([
    Center.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    getCatalog(organizationId),
    Review.find({ organizationId, status: "APPROVED" }).sort({ createdAt: -1 }).limit(30).lean(),
    Realization.find({ organizationId, active: true }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);

  const practitioners = await Promise.all(
    centers.map((c) => getPractitioners(organizationId, String(c._id))),
  );

  const theme: ThemeConfig = {
    ...DEFAULT_THEME_CONFIG,
    ...((org as any).theme || {}),
  };

  const features: FeaturesConfig = {
    ...DEFAULT_FEATURES_CONFIG,
    ...((org as any).features || {}),
  };

  const reviewList: PublicReviewItem[] = reviews.map((r) => ({
    id: String(r._id),
    authorName: r.authorName,
    rating: r.rating,
    comment: r.comment ?? "",
    createdAt: r.createdAt.toISOString(),
    centerId: r.centerId ? String(r.centerId) : null,
  }));

  const avgRating =
    reviewList.length > 0
      ? Number((reviewList.reduce((acc, r) => acc + r.rating, 0) / reviewList.length).toFixed(1))
      : 5.0;

  const realizationList: PublicRealizationItem[] = realizations.map((rz) => ({
    id: String(rz._id),
    title: rz.title,
    category: rz.category ?? "",
    photo: rz.photo,
    centerId: rz.centerId ? String(rz.centerId) : null,
    createdAt: rz.createdAt.toISOString(),
  }));

  return {
    id: organizationId,
    slug: org.slug,
    name: org.name,
    theme,
    features,
    centers: centers.map((c, i) => ({
      id: String(c._id),
      name: c.name,
      governorate: c.governorate as Governorate,
      address: c.address ?? null,
      phone: c.phone ?? null,
      photos: (c.photos ?? []).map(String),
      openingHours: (c.openingHours as Record<string, string | null> | null) ?? DEFAULT_HOURS,
      practitioners: practitioners[i].map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName[0]}.`,
      })),
    })),
    services: catalog.services,
    packs: catalog.packs,
    reviews: reviewList,
    reviewStats: {
      average: avgRating,
      count: reviewList.length,
    },
    realizations: realizationList,
  };
}

export async function getPublicCenterShowcase(slug: string, centerId: string) {
  const salon = await getPublicSalonShowcase(slug);
  if (!salon) return null;

  const center = salon.centers.find((c) => c.id === centerId);
  if (!center) return null;

  const centerReviews = salon.reviews.filter((r) => !r.centerId || r.centerId === centerId);
  const centerRealizations = salon.realizations.filter((rz) => !rz.centerId || rz.centerId === centerId);
  const centerAvg =
    centerReviews.length > 0
      ? Number((centerReviews.reduce((acc, r) => acc + r.rating, 0) / centerReviews.length).toFixed(1))
      : salon.reviewStats.average;

  return {
    salon,
    center,
    reviews: centerReviews,
    realizations: centerRealizations,
    reviewStats: {
      average: centerAvg,
      count: centerReviews.length,
    },
  };
}
