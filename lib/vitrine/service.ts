import "server-only";
import { Types } from "mongoose";
import { logEvent } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { Center, Organization } from "@/lib/models/core";
import { Realization, Review } from "@/lib/models/vitrine";
import {
  DEFAULT_FEATURES_CONFIG,
  DEFAULT_THEME_CONFIG,
  type FeaturesConfig,
  type ThemeConfig,
} from "./schemas";

// Service métier pour le Module 1 : Vitrine & Personnalisation (Ghalia)
// Garantit l'isolation multi-tenant stricte par organizationId.

export async function updateTheme(
  organizationId: string,
  themeData: Partial<ThemeConfig>,
  userId?: string | null,
) {
  await connectDB();
  const org = await Organization.findById(organizationId);
  if (!org) throw new Error("Organisation introuvable.");

  const currentTheme = (org.get("theme") as Partial<ThemeConfig>) || {};
  const mergedTheme: ThemeConfig = {
    ...DEFAULT_THEME_CONFIG,
    ...currentTheme,
    ...themeData,
  };

  org.set("theme", mergedTheme);
  await org.save();

  await logEvent("THEME_UPDATED" as any, {
    organizationId,
    userId: userId ?? null,
    detail: `Thème mis à jour : police ${mergedTheme.fontFamily}, mode ${mergedTheme.colorMode}`,
  });

  return mergedTheme;
}

export async function updateFeatures(
  organizationId: string,
  featuresData: Partial<FeaturesConfig>,
  userId?: string | null,
) {
  await connectDB();
  const org = await Organization.findById(organizationId);
  if (!org) throw new Error("Organisation introuvable.");

  const currentFeatures = (org.get("features") as Partial<FeaturesConfig>) || {};
  const mergedFeatures: FeaturesConfig = {
    ...DEFAULT_FEATURES_CONFIG,
    ...currentFeatures,
    ...featuresData,
  };

  org.set("features", mergedFeatures);
  await org.save();

  await logEvent("FEATURES_UPDATED" as any, {
    organizationId,
    userId: userId ?? null,
    detail: `Fonctionnalités modifiées : paiement=${mergedFeatures.onlinePayment}, avis=${mergedFeatures.reviews}, galerie=${mergedFeatures.gallery}`,
  });

  return mergedFeatures;
}

export async function submitReview(data: {
  organizationId: string;
  authorName: string;
  rating: number;
  comment?: string;
  centerId?: string | null;
  bookingId?: string | null;
  customerId?: string | null;
}) {
  await connectDB();
  const org = await Organization.findById(data.organizationId);
  if (!org) throw new Error("Salon introuvable.");

  // Si l'avis provient d'un rendez-vous valide ou client identifié, on peut l'approuver d'office
  const isVerified = Boolean(data.bookingId);
  const status = isVerified ? "APPROVED" : "PENDING";

  const review = await Review.create({
    organizationId: new Types.ObjectId(data.organizationId),
    centerId: data.centerId && Types.ObjectId.isValid(data.centerId) ? new Types.ObjectId(data.centerId) : null,
    customerId: data.customerId && Types.ObjectId.isValid(data.customerId) ? new Types.ObjectId(data.customerId) : null,
    bookingId: data.bookingId && Types.ObjectId.isValid(data.bookingId) ? new Types.ObjectId(data.bookingId) : null,
    authorName: data.authorName.trim(),
    rating: Math.max(1, Math.min(5, Math.round(data.rating))),
    comment: (data.comment || "").trim(),
    status,
  });

  return {
    id: String(review._id),
    status,
    authorName: review.authorName,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt.toISOString(),
  };
}

export async function moderateReview(
  organizationId: string,
  reviewId: string,
  status: "PENDING" | "APPROVED" | "HIDDEN",
  userId?: string | null,
) {
  await connectDB();
  const review = await Review.findOne({
    _id: reviewId,
    organizationId,
  });
  if (!review) throw new Error("Avis introuvable.");

  review.status = status;
  await review.save();

  await logEvent("REVIEW_MODERATED" as any, {
    organizationId,
    userId: userId ?? null,
    detail: `Avis ${reviewId} passé au statut ${status}`,
  });

  return { id: String(review._id), status: review.status };
}

export async function deleteReview(organizationId: string, reviewId: string, userId?: string | null) {
  await connectDB();
  const res = await Review.findOneAndDelete({ _id: reviewId, organizationId });
  if (!res) throw new Error("Avis introuvable.");

  await logEvent("REVIEW_MODERATED" as any, {
    organizationId,
    userId: userId ?? null,
    detail: `Avis ${reviewId} supprimé`,
  });

  return { success: true };
}

export async function addRealization(
  organizationId: string,
  data: { title: string; category?: string; photo: string; centerId?: string | null },
  userId?: string | null,
) {
  await connectDB();
  const realization = await Realization.create({
    organizationId: new Types.ObjectId(organizationId),
    centerId: data.centerId && Types.ObjectId.isValid(data.centerId) ? new Types.ObjectId(data.centerId) : null,
    title: data.title.trim(),
    category: (data.category || "Coiffure & Beauté").trim(),
    photo: data.photo,
    active: true,
  });

  await logEvent("REALIZATION_CREATED" as any, {
    organizationId,
    userId: userId ?? null,
    detail: `Réalisation ajoutée : ${realization.title}`,
  });

  return {
    id: String(realization._id),
    title: realization.title,
    category: realization.category,
    photo: realization.photo,
    createdAt: realization.createdAt.toISOString(),
  };
}

export async function deleteRealization(
  organizationId: string,
  realizationId: string,
  userId?: string | null,
) {
  await connectDB();
  const res = await Realization.findOneAndDelete({ _id: realizationId, organizationId });
  if (!res) throw new Error("Réalisation introuvable.");

  await logEvent("REALIZATION_DELETED" as any, {
    organizationId,
    userId: userId ?? null,
    detail: `Réalisation supprimée : ${realizationId}`,
  });

  return { success: true };
}

export async function getAdminVitrineData(organizationId: string) {
  await connectDB();
  const [org, centers, reviews, realizations] = await Promise.all([
    Organization.findById(organizationId).lean(),
    Center.find({ organizationId }).select("name governorate address photos").lean(),
    Review.find({ organizationId }).sort({ createdAt: -1 }).limit(50).lean(),
    Realization.find({ organizationId }).sort({ createdAt: -1 }).lean(),
  ]);

  if (!org) throw new Error("Salon introuvable.");

  const theme: ThemeConfig = {
    ...DEFAULT_THEME_CONFIG,
    ...((org as any).theme || {}),
  };

  const features: FeaturesConfig = {
    ...DEFAULT_FEATURES_CONFIG,
    ...((org as any).features || {}),
  };

  return {
    organization: {
      id: String(org._id),
      name: org.name,
      slug: org.slug,
    },
    theme,
    features,
    centers: centers.map((c) => ({
      id: String(c._id),
      name: c.name,
      governorate: c.governorate,
      address: c.address ?? "",
      photo: c.photos?.[0] ?? null,
    })),
    reviews: reviews.map((r) => ({
      id: String(r._id),
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment ?? "",
      status: r.status as "PENDING" | "APPROVED" | "HIDDEN",
      centerId: r.centerId ? String(r.centerId) : null,
      createdAt: r.createdAt.toISOString(),
    })),
    realizations: realizations.map((rz) => ({
      id: String(rz._id),
      title: rz.title,
      category: rz.category ?? "",
      photo: rz.photo,
      centerId: rz.centerId ? String(rz.centerId) : null,
      createdAt: rz.createdAt.toISOString(),
    })),
  };
}
