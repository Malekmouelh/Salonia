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
});

// F0.2 : le propriétaire ajoute un centre rattaché à un gouvernorat.
export async function createCenter(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("OWNER");
  if (!user.organization) return { message: "Aucune organisation associée à ce compte." };

  const parsed = CenterSchema.safeParse({
    name: formData.get("name"),
    governorate: formData.get("governorate"),
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
