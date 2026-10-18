import { z } from "zod";
import { PROMOTION_TYPES, type PromotionType } from "@/lib/enums";

export const ServiceOptionValueSchema = z.object({
  label: z.string().trim().min(1, "Libellé requis."),
  extraPriceTnd: z.number().min(0, "Le prix supplémentaire doit être positif.").default(0),
  extraDurationMinutes: z.number().int().min(0, "La durée supplémentaire doit être positive.").default(0),
});
export type ServiceOptionValueInput = z.infer<typeof ServiceOptionValueSchema>;

export const ServiceOptionSchema = z.object({
  name: z.string().trim().min(1, "Nom de l'option requis (ex: Longueur)."),
  values: z.array(ServiceOptionValueSchema).min(1, "Au moins une valeur d'option requise."),
});
export type ServiceOptionInput = z.infer<typeof ServiceOptionSchema>;

export const CenterPriceSchema = z.object({
  centerId: z.string().min(1, "Identifiant du centre requis."),
  priceTnd: z.number().min(0, "Le tarif doit être supérieur ou égal à 0."),
});
export type CenterPriceInput = z.infer<typeof CenterPriceSchema>;

export const CreateServiceSchema = z.object({
  name: z.string().trim().min(2, "Nom du service trop court (min 2 caractères)."),
  category: z.string().trim().min(1, "Catégorie requise."),
  durationMinutes: z.number().int().min(5, "Durée minimale : 5 minutes."),
  priceTnd: z.number().min(0, "Le prix de base doit être positif."),
  description: z.string().trim().default(""),
  centerIds: z.array(z.string()).default([]),
  centerPrices: z.array(CenterPriceSchema).default([]),
  options: z.array(ServiceOptionSchema).default([]),
  requiredSkills: z.array(z.string().trim()).default([]),
  requiredEquipment: z.array(z.string().trim()).default([]),
  photos: z.array(z.string()).default([]),
});
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

export const UpdateServiceSchema = CreateServiceSchema.extend({
  id: z.string().min(1, "ID du service requis."),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

export const CreatePackSchema = z.object({
  name: z.string().trim().min(2, "Nom du pack trop court (min 2 caractères)."),
  serviceIds: z.array(z.string()).min(1, "Sélectionnez au moins un service pour composer le pack."),
  priceTnd: z.number().min(0, "Le tarif du pack doit être positif."),
  description: z.string().trim().default(""),
  centerIds: z.array(z.string()).default([]),
  centerPrices: z.array(CenterPriceSchema).default([]),
  photos: z.array(z.string()).default([]),
});
export type CreatePackInput = z.infer<typeof CreatePackSchema>;

export const UpdatePackSchema = CreatePackSchema.extend({
  id: z.string().min(1, "ID du pack requis."),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdatePackInput = z.infer<typeof UpdatePackSchema>;

export const CreatePromotionSchema = z
  .object({
    name: z.string().trim().min(2, "Nom de la promotion trop court."),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    type: z.enum(PROMOTION_TYPES, {
      error: "Type de réduction invalide.",
    }),
    value: z.number().min(0.01, "La valeur de réduction doit être strictement positive."),
    serviceIds: z.array(z.string()).default([]),
    packIds: z.array(z.string()).default([]),
    centerIds: z.array(z.string()).default([]),
    startsAt: z.coerce.date({ error: "Date de début invalide." }),
    endsAt: z.coerce.date({ error: "Date de fin invalide." }),
    maxUses: z.number().int().min(1).nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine((d) => d.endsAt > d.startsAt, {
    path: ["endsAt"],
    message: "La date de fin doit être postérieure à la date de début.",
  });
export type CreatePromotionInput = z.infer<typeof CreatePromotionSchema>;
