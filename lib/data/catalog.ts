import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Service, Pack, Promotion } from "@/lib/models/catalog";
import type { PromotionType } from "@/lib/enums";

export type ServiceOptionValueItem = {
  label: string;
  extraPriceTnd: number;
  extraDurationMinutes: number;
};

export type ServiceOptionItem = {
  name: string;
  values: ServiceOptionValueItem[];
};

export type CenterPriceItem = {
  centerId: string;
  priceTnd: number;
};

export type ServiceDetail = {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  priceTnd: number;
  description: string;
  photos: string[];
  centerIds: string[];
  centerPrices: CenterPriceItem[];
  options: ServiceOptionItem[];
  requiredSkills: string[];
  requiredEquipment: string[];
  active: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PackDetail = {
  id: string;
  name: string;
  priceTnd: number;
  description: string;
  photos: string[];
  centerIds: string[];
  centerPrices: CenterPriceItem[];
  serviceIds: string[];
  services: {
    id: string;
    name: string;
    durationMinutes: number;
    priceTnd: number;
    category: string;
  }[];
  totalDurationMinutes: number;
  regularTotalTnd: number;
  savingsTnd: number;
  savingsPercent: number;
  active: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PromotionDetail = {
  id: string;
  name: string;
  code?: string;
  type: PromotionType;
  value: number;
  serviceIds: string[];
  packIds: string[];
  centerIds: string[];
  startsAt: string;
  endsAt: string;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  isExpired: boolean;
};

// Calcule le prix effectif pour un centre spécifique (surcharge ou prix de base)
export function getPriceForCenter(
  item: { priceTnd: number; centerPrices?: { centerId: string | Types.ObjectId; priceTnd: number }[] },
  centerId?: string | null,
): number {
  if (!centerId || !item.centerPrices || item.centerPrices.length === 0) {
    return item.priceTnd;
  }
  const match = item.centerPrices.find(
    (cp) => String(cp.centerId) === String(centerId),
  );
  return match !== undefined ? match.priceTnd : item.priceTnd;
}

export async function getServicesByOrganization(
  organizationId: string,
  centerId?: string | null,
): Promise<ServiceDetail[]> {
  await connectDB();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };
  if (centerId) {
    filter.$or = [
      { centerIds: { $size: 0 } },
      { centerIds: new Types.ObjectId(centerId) },
    ];
  }

  const services = await Service.find(filter)
    .sort({ sortOrder: 1, category: 1, name: 1 })
    .lean();

  return services.map((s) => ({
    id: String(s._id),
    name: s.name,
    category: s.category,
    durationMinutes: s.durationMinutes,
    priceTnd: s.priceTnd,
    description: s.description ?? "",
    photos: (s.photos ?? []).map(String),
    centerIds: (s.centerIds ?? []).map(String),
    centerPrices: (s.centerPrices ?? []).map((cp) => ({
      centerId: String(cp.centerId),
      priceTnd: cp.priceTnd,
    })),
    options: (s.options ?? []).map((opt) => ({
      name: opt.name,
      values: (opt.values ?? []).map((v) => ({
        label: v.label,
        extraPriceTnd: v.extraPriceTnd ?? 0,
        extraDurationMinutes: v.extraDurationMinutes ?? 0,
      })),
    })),
    requiredSkills: (s.requiredSkills ?? []).map(String),
    requiredEquipment: (s.requiredEquipment ?? []).map(String),
    active: s.active !== false,
    sortOrder: s.sortOrder ?? 0,
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
    updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
  }));
}

export async function getPacksByOrganization(
  organizationId: string,
  centerId?: string | null,
): Promise<PackDetail[]> {
  await connectDB();
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(organizationId),
  };
  if (centerId) {
    filter.$or = [
      { centerIds: { $size: 0 } },
      { centerIds: new Types.ObjectId(centerId) },
    ];
  }

  const packs = await Pack.find(filter)
    .populate<{
      serviceIds: {
        _id: Types.ObjectId;
        name: string;
        durationMinutes: number;
        priceTnd: number;
        category: string;
      }[];
    }>("serviceIds", "name durationMinutes priceTnd category")
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  return packs.map((p) => {
    const validServices = (p.serviceIds ?? []).filter((s) => s && s._id);
    const regularTotal = validServices.reduce((acc, s) => acc + (s.priceTnd || 0), 0);
    const savings = Math.max(0, regularTotal - p.priceTnd);
    const savingsPct = regularTotal > 0 ? Math.round((savings / regularTotal) * 100) : 0;
    const totalMinutes = validServices.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

    return {
      id: String(p._id),
      name: p.name,
      priceTnd: p.priceTnd,
      description: p.description ?? "",
      photos: (p.photos ?? []).map(String),
      centerIds: (p.centerIds ?? []).map(String),
      centerPrices: (p.centerPrices ?? []).map((cp) => ({
        centerId: String(cp.centerId),
        priceTnd: cp.priceTnd,
      })),
      serviceIds: validServices.map((s) => String(s._id)),
      services: validServices.map((s) => ({
        id: String(s._id),
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceTnd: s.priceTnd,
        category: s.category,
      })),
      totalDurationMinutes: totalMinutes,
      regularTotalTnd: regularTotal,
      savingsTnd: savings,
      savingsPercent: savingsPct,
      active: p.active !== false,
      sortOrder: p.sortOrder ?? 0,
      createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : undefined,
    };
  });
}

export async function getCategories(organizationId: string): Promise<string[]> {
  await connectDB();
  const categories = await Service.distinct("category", {
    organizationId: new Types.ObjectId(organizationId),
  });
  return (categories as string[]).filter(Boolean).sort();
}

export async function getServiceDetail(
  serviceId: string,
  organizationId: string,
): Promise<ServiceDetail | null> {
  await connectDB();
  const s = await Service.findOne({
    _id: new Types.ObjectId(serviceId),
    organizationId: new Types.ObjectId(organizationId),
  }).lean();
  if (!s) return null;

  return {
    id: String(s._id),
    name: s.name,
    category: s.category,
    durationMinutes: s.durationMinutes,
    priceTnd: s.priceTnd,
    description: s.description ?? "",
    photos: (s.photos ?? []).map(String),
    centerIds: (s.centerIds ?? []).map(String),
    centerPrices: (s.centerPrices ?? []).map((cp) => ({
      centerId: String(cp.centerId),
      priceTnd: cp.priceTnd,
    })),
    options: (s.options ?? []).map((opt) => ({
      name: opt.name,
      values: (opt.values ?? []).map((v) => ({
        label: v.label,
        extraPriceTnd: v.extraPriceTnd ?? 0,
        extraDurationMinutes: v.extraDurationMinutes ?? 0,
      })),
    })),
    requiredSkills: (s.requiredSkills ?? []).map(String),
    requiredEquipment: (s.requiredEquipment ?? []).map(String),
    active: s.active !== false,
    sortOrder: s.sortOrder ?? 0,
  };
}

export async function getPackDetail(
  packId: string,
  organizationId: string,
): Promise<PackDetail | null> {
  await connectDB();
  const p = await Pack.findOne({
    _id: new Types.ObjectId(packId),
    organizationId: new Types.ObjectId(organizationId),
  })
    .populate<{
      serviceIds: {
        _id: Types.ObjectId;
        name: string;
        durationMinutes: number;
        priceTnd: number;
        category: string;
      }[];
    }>("serviceIds", "name durationMinutes priceTnd category")
    .lean();
  if (!p) return null;

  const validServices = (p.serviceIds ?? []).filter((s) => s && s._id);
  const regularTotal = validServices.reduce((acc, s) => acc + (s.priceTnd || 0), 0);
  const savings = Math.max(0, regularTotal - p.priceTnd);
  const savingsPct = regularTotal > 0 ? Math.round((savings / regularTotal) * 100) : 0;
  const totalMinutes = validServices.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

  return {
    id: String(p._id),
    name: p.name,
    priceTnd: p.priceTnd,
    description: p.description ?? "",
    photos: (p.photos ?? []).map(String),
    centerIds: (p.centerIds ?? []).map(String),
    centerPrices: (p.centerPrices ?? []).map((cp) => ({
      centerId: String(cp.centerId),
      priceTnd: cp.priceTnd,
    })),
    serviceIds: validServices.map((s) => String(s._id)),
    services: validServices.map((s) => ({
      id: String(s._id),
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceTnd: s.priceTnd,
      category: s.category,
    })),
    totalDurationMinutes: totalMinutes,
    regularTotalTnd: regularTotal,
    savingsTnd: savings,
    savingsPercent: savingsPct,
    active: p.active !== false,
    sortOrder: p.sortOrder ?? 0,
  };
}

export async function getPromotionsByOrganization(
  organizationId: string,
): Promise<PromotionDetail[]> {
  await connectDB();
  const promotions = await Promotion.find({
    organizationId: new Types.ObjectId(organizationId),
  })
    .sort({ active: -1, endsAt: -1 })
    .lean();

  const now = new Date();
  return promotions.map((pr) => ({
    id: String(pr._id),
    name: pr.name,
    code: pr.code ? String(pr.code) : undefined,
    type: pr.type as PromotionType,
    value: pr.value,
    serviceIds: (pr.serviceIds ?? []).map(String),
    packIds: (pr.packIds ?? []).map(String),
    centerIds: (pr.centerIds ?? []).map(String),
    startsAt: new Date(pr.startsAt).toISOString(),
    endsAt: new Date(pr.endsAt).toISOString(),
    maxUses: pr.maxUses ?? null,
    usedCount: pr.usedCount ?? 0,
    active: pr.active !== false,
    isExpired: new Date(pr.endsAt) < now,
  }));
}
