"use server";

import { revalidatePath, updateTag } from "next/cache";
import { Types } from "mongoose";
import { logEvent } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { Service, Pack, Promotion } from "@/lib/models/catalog";
import {
  CreateServiceSchema,
  UpdateServiceSchema,
  CreatePackSchema,
  UpdatePackSchema,
  CreatePromotionSchema,
  type CreateServiceInput,
  type UpdateServiceInput,
  type CreatePackInput,
  type UpdatePackInput,
} from "@/lib/catalog/schemas";

export type CatalogActionResult = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
  id?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVICES (CRUD + Actions)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveServiceAction(raw: unknown): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const isUpdate = typeof raw === "object" && raw !== null && "id" in raw && Boolean((raw as { id?: string }).id);
  const parsed = isUpdate ? UpdateServiceSchema.safeParse(raw) : CreateServiceSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Veuillez corriger les champs invalides.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  await connectDB();
  const orgId = new Types.ObjectId(user.organization.id);

  if (isUpdate) {
    const data = parsed.data as UpdateServiceInput;
    const existing = await Service.findOne({
      _id: new Types.ObjectId(data.id),
      organizationId: orgId,
    });
    if (!existing) return { ok: false, message: "Service introuvable." };

    existing.name = data.name;
    existing.category = data.category;
    existing.durationMinutes = data.durationMinutes;
    existing.priceTnd = data.priceTnd;
    existing.description = data.description ?? "";
    existing.centerIds = (data.centerIds ?? []).map((id: string) => new Types.ObjectId(id));
    existing.set(
      "centerPrices",
      (data.centerPrices ?? []).map((cp: { centerId: string; priceTnd: number }) => ({
        centerId: new Types.ObjectId(cp.centerId),
        priceTnd: cp.priceTnd,
      })),
    );
    existing.set(
      "options",
      (data.options ?? []).map((opt) => ({
        name: opt.name,
        values: opt.values.map((v) => ({
          label: v.label,
          extraPriceTnd: v.extraPriceTnd,
          extraDurationMinutes: v.extraDurationMinutes,
        })),
      })),
    );
    existing.requiredSkills = data.requiredSkills ?? [];
    existing.requiredEquipment = data.requiredEquipment ?? [];
    existing.photos = data.photos ?? [];
    if (data.active !== undefined) existing.active = data.active;
    if (data.sortOrder !== undefined) existing.sortOrder = data.sortOrder;

    await existing.save();

    await logEvent("SERVICE_UPDATED", {
      userId: user.id,
      organizationId: user.organization.id,
      detail: `Modification : ${existing.name}`,
    });

    updateTag(`salon:${user.organization.slug}`);
    revalidatePath("/dashboard/catalogue");
    return { ok: true, message: "Service mis à jour avec succès.", id: String(existing._id) };
  } else {
    const data = parsed.data as CreateServiceInput;
    const highestSort = await Service.findOne({ organizationId: orgId }).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const nextSort = (highestSort?.sortOrder ?? 0) + 1;

    const created = await Service.create({
      organizationId: orgId,
      name: data.name,
      category: data.category,
      durationMinutes: data.durationMinutes,
      priceTnd: data.priceTnd,
      description: data.description ?? "",
      centerIds: (data.centerIds ?? []).map((id: string) => new Types.ObjectId(id)),
      centerPrices: (data.centerPrices ?? []).map((cp: { centerId: string; priceTnd: number }) => ({
        centerId: new Types.ObjectId(cp.centerId),
        priceTnd: cp.priceTnd,
      })),
      options: (data.options ?? []).map((opt) => ({
        name: opt.name,
        values: opt.values.map((v) => ({
          label: v.label,
          extraPriceTnd: v.extraPriceTnd,
          extraDurationMinutes: v.extraDurationMinutes,
        })),
      })),
      requiredSkills: data.requiredSkills ?? [],
      requiredEquipment: data.requiredEquipment ?? [],
      photos: data.photos ?? [],
      sortOrder: nextSort,
      active: true,
    });

    await logEvent("SERVICE_CREATED", {
      userId: user.id,
      organizationId: user.organization.id,
      detail: `Création : ${created.name}`,
    });

    updateTag(`salon:${user.organization.slug}`);
    revalidatePath("/dashboard/catalogue");
    return { ok: true, message: "Nouveau service ajouté au catalogue.", id: String(created._id) };
  }
}

export async function toggleServiceAction(serviceId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const service = await Service.findOne({
    _id: new Types.ObjectId(serviceId),
    organizationId: new Types.ObjectId(user.organization.id),
  });
  if (!service) return { ok: false, message: "Service introuvable." };

  service.active = !service.active;
  await service.save();

  await logEvent("SERVICE_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `${service.active ? "Activation" : "Désactivation"} : ${service.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: service.active ? "Service activé." : "Service désactivé." };
}

export async function duplicateServiceAction(serviceId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const existing = await Service.findOne({
    _id: new Types.ObjectId(serviceId),
    organizationId: new Types.ObjectId(user.organization.id),
  }).lean();
  if (!existing) return { ok: false, message: "Service source introuvable." };

  const copy = await Service.create({
    organizationId: existing.organizationId,
    name: `${existing.name} (Copie)`,
    category: existing.category,
    durationMinutes: existing.durationMinutes,
    priceTnd: existing.priceTnd,
    description: existing.description,
    centerIds: existing.centerIds,
    centerPrices: existing.centerPrices,
    options: existing.options,
    requiredSkills: existing.requiredSkills,
    requiredEquipment: existing.requiredEquipment,
    photos: existing.photos,
    sortOrder: (existing.sortOrder ?? 0) + 1,
    active: false, // Désactivé par défaut le temps de finaliser la copie
  });

  await logEvent("SERVICE_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Duplication : ${copy.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Service dupliqué avec succès.", id: String(copy._id) };
}

export async function deleteServiceAction(serviceId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const sOid = new Types.ObjectId(serviceId);
  const orgOid = new Types.ObjectId(user.organization.id);

  // Vérification de sécurité : le service est-il inclus dans un pack actif ?
  const linkedPack = await Pack.findOne({
    organizationId: orgOid,
    serviceIds: sOid,
    active: true,
  }).select("name").lean();

  if (linkedPack) {
    return {
      ok: false,
      message: `Impossible de supprimer ce service : il est actuellement inclus dans le pack actif "${linkedPack.name}". Désactivez ou modifiez d'abord ce pack.`,
    };
  }

  const deleted = await Service.findOneAndDelete({
    _id: sOid,
    organizationId: orgOid,
  });
  if (!deleted) return { ok: false, message: "Service introuvable." };

  await logEvent("SERVICE_DELETED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Suppression : ${deleted.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Service supprimé." };
}

// ─────────────────────────────────────────────────────────────────────────────
// PACKS (CRUD + Actions)
// ─────────────────────────────────────────────────────────────────────────────

export async function savePackAction(raw: unknown): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const isUpdate = typeof raw === "object" && raw !== null && "id" in raw && Boolean((raw as { id?: string }).id);
  const parsed = isUpdate ? UpdatePackSchema.safeParse(raw) : CreatePackSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Veuillez corriger les champs invalides du pack.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  await connectDB();
  const orgId = new Types.ObjectId(user.organization.id);
  const data = parsed.data;

  // Vérifier que tous les services sélectionnés existent dans l'organisation
  const serviceOids = data.serviceIds.map((id) => new Types.ObjectId(id));
  const validCount = await Service.countDocuments({
    _id: { $in: serviceOids },
    organizationId: orgId,
  });
  if (validCount !== serviceOids.length) {
    return { ok: false, message: "Certains services sélectionnés sont introuvables." };
  }

  if (isUpdate) {
    const updateData = data as UpdatePackInput;
    const existing = await Pack.findOne({
      _id: new Types.ObjectId(updateData.id),
      organizationId: orgId,
    });
    if (!existing) return { ok: false, message: "Pack introuvable." };

    existing.name = updateData.name;
    existing.serviceIds = serviceOids;
    existing.priceTnd = updateData.priceTnd;
    existing.description = updateData.description ?? "";
    existing.centerIds = (updateData.centerIds ?? []).map((id: string) => new Types.ObjectId(id));
    existing.set(
      "centerPrices",
      (updateData.centerPrices ?? []).map((cp: { centerId: string; priceTnd: number }) => ({
        centerId: new Types.ObjectId(cp.centerId),
        priceTnd: cp.priceTnd,
      })),
    );
    existing.photos = updateData.photos ?? [];
    if (updateData.active !== undefined) existing.active = updateData.active;
    if (updateData.sortOrder !== undefined) existing.sortOrder = updateData.sortOrder;

    await existing.save();

    await logEvent("PACK_UPDATED", {
      userId: user.id,
      organizationId: user.organization.id,
      detail: `Modification : ${existing.name}`,
    });

    updateTag(`salon:${user.organization.slug}`);
    revalidatePath("/dashboard/catalogue");
    return { ok: true, message: "Pack mis à jour avec succès.", id: String(existing._id) };
  } else {
    const highestSort = await Pack.findOne({ organizationId: orgId }).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const nextSort = (highestSort?.sortOrder ?? 0) + 1;

    const created = await Pack.create({
      organizationId: orgId,
      name: data.name,
      serviceIds: serviceOids,
      priceTnd: data.priceTnd,
      description: data.description ?? "",
      centerIds: (data.centerIds ?? []).map((id) => new Types.ObjectId(id)),
      centerPrices: (data.centerPrices ?? []).map((cp) => ({
        centerId: new Types.ObjectId(cp.centerId),
        priceTnd: cp.priceTnd,
      })),
      photos: data.photos ?? [],
      sortOrder: nextSort,
      active: true,
    });

    await logEvent("PACK_CREATED", {
      userId: user.id,
      organizationId: user.organization.id,
      detail: `Création : ${created.name}`,
    });

    updateTag(`salon:${user.organization.slug}`);
    revalidatePath("/dashboard/catalogue");
    return { ok: true, message: "Nouveau pack créé avec succès.", id: String(created._id) };
  }
}

export async function togglePackAction(packId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const pack = await Pack.findOne({
    _id: new Types.ObjectId(packId),
    organizationId: new Types.ObjectId(user.organization.id),
  });
  if (!pack) return { ok: false, message: "Pack introuvable." };

  pack.active = !pack.active;
  await pack.save();

  await logEvent("PACK_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `${pack.active ? "Activation" : "Désactivation"} : ${pack.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: pack.active ? "Pack activé." : "Pack désactivé." };
}

export async function duplicatePackAction(packId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const existing = await Pack.findOne({
    _id: new Types.ObjectId(packId),
    organizationId: new Types.ObjectId(user.organization.id),
  }).lean();
  if (!existing) return { ok: false, message: "Pack introuvable." };

  const copy = await Pack.create({
    organizationId: existing.organizationId,
    name: `${existing.name} (Copie)`,
    serviceIds: existing.serviceIds,
    priceTnd: existing.priceTnd,
    description: existing.description,
    centerIds: existing.centerIds,
    centerPrices: existing.centerPrices,
    photos: existing.photos,
    sortOrder: (existing.sortOrder ?? 0) + 1,
    active: false,
  });

  await logEvent("PACK_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Duplication : ${copy.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Pack dupliqué avec succès.", id: String(copy._id) };
}

export async function deletePackAction(packId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const deleted = await Pack.findOneAndDelete({
    _id: new Types.ObjectId(packId),
    organizationId: new Types.ObjectId(user.organization.id),
  });
  if (!deleted) return { ok: false, message: "Pack introuvable." };

  await logEvent("PACK_DELETED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Suppression : ${deleted.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Pack supprimé." };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMOTIONS & CODES (F2.7)
// ─────────────────────────────────────────────────────────────────────────────

export async function savePromotionAction(raw: unknown): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  const parsed = CreatePromotionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Veuillez vérifier les informations de la promotion.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  await connectDB();
  const orgId = new Types.ObjectId(user.organization.id);
  const data = parsed.data;

  // Si un code est spécifié, vérifier son unicité pour cette organisation
  if (data.code) {
    const existingCode = await Promotion.findOne({
      organizationId: orgId,
      code: data.code,
    }).lean();
    if (existingCode) {
      return {
        ok: false,
        message: `Le code promo "${data.code}" existe déjà pour votre salon.`,
        errors: { code: ["Ce code existe déjà."] },
      };
    }
  }

  const created = await Promotion.create({
    organizationId: orgId,
    name: data.name,
    code: data.code,
    type: data.type,
    value: data.value,
    serviceIds: data.serviceIds.map((id) => new Types.ObjectId(id)),
    packIds: data.packIds.map((id) => new Types.ObjectId(id)),
    centerIds: data.centerIds.map((id) => new Types.ObjectId(id)),
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    maxUses: data.maxUses ?? null,
    active: data.active,
  });

  await logEvent("PROMOTION_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Promotion créée : ${created.name} (${created.code ?? "sans code"})`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Promotion créée avec succès.", id: String(created._id) };
}

export async function togglePromotionAction(promotionId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const promo = await Promotion.findOne({
    _id: new Types.ObjectId(promotionId),
    organizationId: new Types.ObjectId(user.organization.id),
  });
  if (!promo) return { ok: false, message: "Promotion introuvable." };

  promo.active = !promo.active;
  await promo.save();

  await logEvent("PROMOTION_UPDATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `${promo.active ? "Activation" : "Désactivation"} : ${promo.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: promo.active ? "Promotion activée." : "Promotion désactivée." };
}

export async function deletePromotionAction(promotionId: string): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const deleted = await Promotion.findOneAndDelete({
    _id: new Types.ObjectId(promotionId),
    organizationId: new Types.ObjectId(user.organization.id),
  });
  if (!deleted) return { ok: false, message: "Promotion introuvable." };

  await logEvent("PROMOTION_DELETED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Suppression promo : ${deleted.name}`,
  });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Promotion supprimée." };
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉORGANISATION / TRI
// ─────────────────────────────────────────────────────────────────────────────

export async function reorderCatalogAction(
  type: "services" | "packs",
  orderedIds: string[],
): Promise<CatalogActionResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const orgId = new Types.ObjectId(user.organization.id);

  const bulkOps = orderedIds.map((id, index) => ({
    updateOne: {
      filter: { _id: new Types.ObjectId(id), organizationId: orgId },
      update: { $set: { sortOrder: index } },
    },
  }));

  if (bulkOps.length > 0) {
    if (type === "services") {
      await (Service as any).bulkWrite(bulkOps);
    } else {
      await (Pack as any).bulkWrite(bulkOps);
    }
  }

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");
  return { ok: true, message: "Ordre mis à jour." };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT BROUILLON IA (F3.5 – catalogDraft → vrais services/packs)
// ─────────────────────────────────────────────────────────────────────────────

export type ImportDraftResult = CatalogActionResult & {
  imported?: { services: number; packs: number };
};

export async function importCatalogDraftAction(): Promise<ImportDraftResult> {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) return { ok: false, message: "Organisation introuvable." };

  await connectDB();
  const orgId = new Types.ObjectId(user.organization.id);

  // Récupérer le brouillon IA depuis l'organisation
  const { Organization } = await import("@/lib/models/core");
  const org = await Organization.findById(orgId).lean();
  if (!org) return { ok: false, message: "Organisation introuvable." };

  const draft = org.catalogDraft as {
    services?: { name: string; category: string; durationMinutes: number; priceTnd: number }[];
    team?: unknown[];
    createdAt?: string;
  } | null;

  if (!draft || !Array.isArray(draft.services) || draft.services.length === 0) {
    return { ok: false, message: "Aucun brouillon de catalogue disponible. Utilisez l'assistant IA pour en générer un." };
  }

  // Récupérer les services déjà existants pour éviter les doublons (par nom, insensible à la casse)
  const existing = await Service.find({ organizationId: orgId }).select("name").lean();
  const existingNames = new Set(existing.map((s) => s.name.toLowerCase().trim()));

  const toCreate = draft.services.filter(
    (s) => s.name && s.category && s.durationMinutes > 0 && s.priceTnd >= 0
      && !existingNames.has(s.name.toLowerCase().trim()),
  );

  if (toCreate.length === 0) {
    return { ok: false, message: "Tous les services du brouillon existent déjà dans votre catalogue." };
  }

  // Calculer le prochain sortOrder
  const highestSort = await Service.findOne({ organizationId: orgId }).sort({ sortOrder: -1 }).select("sortOrder").lean();
  let nextSort = (highestSort?.sortOrder ?? 0) + 1;

  const created = await Service.insertMany(
    toCreate.map((s) => ({
      organizationId: orgId,
      name: s.name,
      category: s.category,
      durationMinutes: s.durationMinutes,
      priceTnd: s.priceTnd,
      sortOrder: nextSort++,
      active: true,
    })),
  );

  await logEvent("SERVICE_CREATED", {
    userId: user.id,
    organizationId: user.organization.id,
    detail: `Import brouillon IA : ${created.length} service(s) importé(s)`,
  });

  // Effacer le brouillon maintenant qu'il est importé
  await Organization.updateOne({ _id: orgId }, { $set: { catalogDraft: null } });

  updateTag(`salon:${user.organization.slug}`);
  revalidatePath("/dashboard/catalogue");

  return {
    ok: true,
    message: `${created.length} service(s) importé(s) depuis le brouillon IA avec succès.`,
    imported: { services: created.length, packs: 0 },
  };
}
