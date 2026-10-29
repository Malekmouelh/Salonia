"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser, requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/definitions";
import {
  CreateRealizationSchema,
  FeaturesConfigSchema,
  ModerateReviewSchema,
  SubmitReviewSchema,
  ThemeConfigSchema,
  type FeaturesConfig,
  type ThemeConfig,
} from "@/lib/vitrine/schemas";
import {
  addRealization,
  deleteRealization,
  deleteReview,
  moderateReview,
  submitReview,
  updateFeatures,
  updateTheme,
} from "@/lib/vitrine/service";

export type VitrineActionResult = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
  data?: any;
};

// F1.1 — Mise à jour du design et thème de la vitrine
export async function updateThemeAction(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { message: "Organisation introuvable." };

  const raw = {
    logo: String(formData.get("logo") || ""),
    banner: String(formData.get("banner") || ""),
    primaryColor: String(formData.get("primaryColor") || "#e8b4a0"),
    secondaryColor: String(formData.get("secondaryColor") || "#2a0f25"),
    accentColor: String(formData.get("accentColor") || "#f3d9cf"),
    fontFamily: String(formData.get("fontFamily") || "playfair"),
    colorMode: String(formData.get("colorMode") || "dark"),
    tagline: String(formData.get("tagline") || ""),
    description: String(formData.get("description") || ""),
    instagram: String(formData.get("instagram") || ""),
    facebook: String(formData.get("facebook") || ""),
    tiktok: String(formData.get("tiktok") || ""),
    whatsapp: String(formData.get("whatsapp") || ""),
  };

  const parsed = ThemeConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      message: "Veuillez vérifier les informations du thème.",
      errors: parsed.error.flatten().fieldErrors,
      values: Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : ""]),
      ),
    };
  }

  try {
    await updateTheme(user.organization.id, parsed.data, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return {
      success: "Personnalisation du design enregistrée avec succès !",
      values: Object.fromEntries(
        Object.entries(parsed.data).map(([k, v]) => [k, typeof v === "string" ? v : ""]),
      ),
    };
  } catch (err: any) {
    return {
      message: err?.message || "Impossible d'enregistrer le thème.",
    };
  }
}

// F1.2 — Activation / désactivation des fonctionnalités
export async function updateFeaturesAction(
  rawFeatures: Record<string, boolean>,
): Promise<VitrineActionResult> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const parsed = FeaturesConfigSchema.safeParse(rawFeatures);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Format de fonctionnalités invalide.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const updated = await updateFeatures(user.organization.id, parsed.data, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return {
      ok: true,
      message: "Fonctionnalités mises à jour avec succès.",
      data: updated,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || "Erreur lors de la mise à jour des modules.",
    };
  }
}

// F1.5 — Soumission d'un avis client (public ou depuis un rendez-vous)
export async function submitPublicReviewAction(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const organizationId = String(formData.get("organizationId") || "");
  const slug = String(formData.get("slug") || "");
  const authorName = String(formData.get("authorName") || "");
  const rating = Number(formData.get("rating") || 5);
  const comment = String(formData.get("comment") || "");
  const centerId = formData.get("centerId") ? String(formData.get("centerId")) : undefined;
  const bookingId = formData.get("bookingId") ? String(formData.get("bookingId")) : undefined;

  const parsed = SubmitReviewSchema.safeParse({
    authorName,
    rating,
    comment,
    centerId,
    bookingId,
  });

  if (!parsed.success) {
    return {
      message: "Veuillez renseigner les champs requis pour laisser un avis.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await submitReview({
      organizationId,
      authorName: parsed.data.authorName,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      centerId: parsed.data.centerId,
      bookingId: parsed.data.bookingId,
    });

    if (slug) {
      updateTag(`salon:${slug}`);
      revalidatePath(`/salon/${slug}`);
    }

    return {
      success: "Merci ! Votre avis a été soumis avec succès.",
    };
  } catch (err: any) {
    return {
      message: err?.message || "Impossible d'enregistrer l'avis.",
    };
  }
}

// F1.5 — Modération des avis par le salon (Approuver / Masquer)
export async function moderateReviewAction(
  reviewId: string,
  status: "PENDING" | "APPROVED" | "HIDDEN",
): Promise<VitrineActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const parsed = ModerateReviewSchema.safeParse({ reviewId, status });
  if (!parsed.success) return { ok: false, message: "Données de modération invalides." };

  try {
    await moderateReview(user.organization.id, reviewId, status, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return { ok: true, message: `Statut de l'avis modifié en : ${status}.` };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Erreur de modération." };
  }
}

// F1.5 — Suppression d'un avis
export async function deleteReviewAction(reviewId: string): Promise<VitrineActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  try {
    await deleteReview(user.organization.id, reviewId, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return { ok: true, message: "Avis supprimé." };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Impossible de supprimer l'avis." };
  }
}

// F1.5 — Ajout d'une photo dans la galerie de réalisations
export async function addRealizationAction(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { message: "Organisation introuvable." };

  const raw = {
    title: String(formData.get("title") || ""),
    category: String(formData.get("category") || "Coiffure & Beauté"),
    photo: String(formData.get("photo") || ""),
    centerId: formData.get("centerId") ? String(formData.get("centerId")) : undefined,
  };

  const parsed = CreateRealizationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      message: "Veuillez renseigner le titre et sélectionner une photo.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const created = await addRealization(user.organization.id, parsed.data, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return {
      success: "Réalisation ajoutée à votre vitrine !",
    };
  } catch (err: any) {
    return {
      message: err?.message || "Impossible d'ajouter la réalisation.",
    };
  }
}

// F1.5 — Création directe d'une réalisation avec retour de données pour mise à jour instantanée du portfolio
export async function createRealizationDirectAction(data: {
  title: string;
  category?: string;
  photo: string;
  centerId?: string;
}): Promise<VitrineActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const parsed = CreateRealizationSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Veuillez renseigner le titre et sélectionner une photo.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const created = await addRealization(user.organization.id, parsed.data, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return {
      ok: true,
      message: "Nouvelle réalisation ajoutée avec succès !",
      data: created,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || "Impossible d'ajouter la réalisation.",
    };
  }
}

// F1.5 — Suppression d'une réalisation
export async function deleteRealizationAction(realizationId: string): Promise<VitrineActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  try {
    await deleteRealization(user.organization.id, realizationId, user.id);
    const slug = user.organization.slug;
    updateTag(`salon:${slug}`);
    revalidatePath(`/salon/${slug}`);
    revalidatePath("/dashboard/vitrine");

    return { ok: true, message: "Réalisation retirée de la galerie." };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Impossible de supprimer la réalisation." };
  }
}
