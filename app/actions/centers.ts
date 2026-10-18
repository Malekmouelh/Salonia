"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { requireRole } from "@/lib/dal";
import { GOVERNORATES, type FormState } from "@/lib/definitions";
import { connectDB } from "@/lib/db";
import type { Governorate } from "@/lib/enums";
import { Center, User } from "@/lib/models/core";

const CenterSchema = z.object({
  name: z.string().trim().min(2, "Nom du centre trop court."),
  governorate: z.enum(GOVERNORATES.map((g) => g.value) as [Governorate, ...Governorate[]], {
    error: "Choisissez un gouvernorat.",
  }),
  photos: z.array(z.string()).default([]),
});

// F0.2 : le propriétaire ajoute un centre rattaché à un gouvernorat.
export async function createCenter(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { message: "Aucune organisation associée à ce compte." };

  let photos: string[] = [];
  const rawPhotos = formData.get("photos");
  if (typeof rawPhotos === "string" && rawPhotos.trim().length > 0) {
    try {
      photos = JSON.parse(rawPhotos);
    } catch {
      photos = [];
    }
  }

  const parsed = CenterSchema.safeParse({
    name: formData.get("name"),
    governorate: formData.get("governorate"),
    photos,
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  await connectDB();
  const center = await Center.create({ ...parsed.data, organizationId: user.organization.id });
  await User.updateOne({ _id: user.id }, { $addToSet: { centerIds: center._id } });
  await logEvent("CENTER_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: center.name,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard");
  return { success: "Centre ajouté." };
}

export async function updateCenterPhotos(centerId: string, photos: string[]): Promise<{ ok: boolean; message?: string }> {
  try {
    const user = await requireRole("OWNER");
    if (!user.organization) return { ok: false, message: "Aucune organisation." };

    await connectDB();
    const res = await Center.updateOne(
      { _id: centerId, organizationId: user.organization.id },
      { $set: { photos } }
    );
    if (!res.matchedCount) return { ok: false, message: "Centre introuvable." };

    updateTag(`salon:${user.organization.slug}`);
    revalidatePath("/dashboard");
    return { ok: true, message: "Photos du centre mises à jour avec succès." };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Erreur lors de la mise à jour des photos." };
  }
}
