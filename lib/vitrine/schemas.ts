import { z } from "zod";

// F1.1 — Personnalisation du design
export const FONT_OPTIONS = [
  { value: "playfair", label: "Playfair Display", description: "Élégant, Haute Couture & Raffiné", cssFont: "'Playfair Display', var(--font-playfair), Georgia, serif" },
  { value: "cormorant", label: "Cormorant Garamond", description: "Luxe Classique & Majestueux", cssFont: "'Cormorant Garamond', var(--font-cormorant), Georgia, serif" },
  { value: "outfit", label: "Outfit", description: "Moderne, Tendance & Géométrique", cssFont: "'Outfit', var(--font-outfit), system-ui, sans-serif" },
  { value: "inter", label: "Inter", description: "Minimaliste, Épuré & Haute Lisibilité", cssFont: "'Inter', var(--font-inter), system-ui, sans-serif" },
  { value: "tajawal", label: "Tajawal", description: "Harmonie Bilingue Parfaite (FR / AR)", cssFont: "'Tajawal', var(--font-tajawal), system-ui, sans-serif" },
] as const;

export type VitrineFont = (typeof FONT_OPTIONS)[number]["value"];

export const COLOR_PRESETS = [
  { name: "Rose Gold & Prune (Signature)", primary: "#e8b4a0", secondary: "#2a0f25", accent: "#f3d9cf" },
  { name: "Or Impérial & Noir Velours", primary: "#d4af37", secondary: "#121212", accent: "#f9e79f" },
  { name: "Émeraude Royale & Champagne", primary: "#10b981", secondary: "#062b1e", accent: "#d1fae5" },
  { name: "Lavande Douce & Nuit", primary: "#c084fc", secondary: "#1e102d", accent: "#f3e8ff" },
  { name: "Terracotta & Ambre Chaud", primary: "#ea580c", secondary: "#2b1406", accent: "#ffedd5" },
] as const;

export const ThemeConfigSchema = z.object({
  logo: z.string().default(""),
  banner: z.string().default(""),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Code couleur invalide").default("#e8b4a0"),
  secondaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Code couleur invalide").default("#2a0f25"),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Code couleur invalide").default("#f3d9cf"),
  fontFamily: z.enum(["playfair", "cormorant", "outfit", "inter", "tajawal"]).default("playfair"),
  colorMode: z.enum(["dark", "light", "auto"]).default("dark"),
  tagline: z.string().max(140, "Le slogan ne doit pas dépasser 140 caractères").default(""),
  description: z.string().max(1000, "La description ne doit pas dépasser 1000 caractères").default(""),
  instagram: z.string().max(100).default(""),
  facebook: z.string().max(100).default(""),
  tiktok: z.string().max(100).default(""),
  whatsapp: z.string().max(30).default(""),
});

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  logo: "",
  banner: "",
  primaryColor: "#e8b4a0",
  secondaryColor: "#2a0f25",
  accentColor: "#f3d9cf",
  fontFamily: "playfair",
  colorMode: "dark",
  tagline: "L'art de sublimer votre beauté au quotidien",
  description: "Découvrez nos prestations d'exception, nos équipes passionnées et prenez rendez-vous en quelques clics.",
  instagram: "",
  facebook: "",
  tiktok: "",
  whatsapp: "",
};

// F1.2 — Activation ou désactivation des fonctionnalités du salon
export const FeaturesConfigSchema = z.object({
  onlinePayment: z.boolean().default(true),
  packs: z.boolean().default(true),
  loyalty: z.boolean().default(true),
  reviews: z.boolean().default(true),
  gallery: z.boolean().default(true),
  promotions: z.boolean().default(true),
  invitations: z.boolean().default(true),
  multiCenter: z.boolean().default(true),
});

export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;

export const DEFAULT_FEATURES_CONFIG: FeaturesConfig = {
  onlinePayment: true,
  packs: true,
  loyalty: true,
  reviews: true,
  gallery: true,
  promotions: true,
  invitations: true,
  multiCenter: true,
};

// F1.5 — Avis clients
export const SubmitReviewSchema = z.object({
  authorName: z.string().trim().min(2, "Le nom doit comporter au moins 2 caractères").max(60),
  rating: z.coerce.number().int().min(1, "Note minimum : 1 étoile").max(5, "Note maximum : 5 étoiles"),
  comment: z.string().trim().max(500, "Le commentaire ne doit pas dépasser 500 caractères").default(""),
  centerId: z.string().optional(),
  bookingId: z.string().optional(),
});

export const ModerateReviewSchema = z.object({
  reviewId: z.string().min(1, "ID d'avis manquant"),
  status: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
});

// F1.5 — Galerie de réalisations
export const CreateRealizationSchema = z.object({
  title: z.string().trim().min(2, "Titre requis (au moins 2 caractères)").max(80),
  category: z.string().trim().max(50).default("Coiffure & Beauté"),
  photo: z.string().min(1, "Une photo est obligatoire"),
  centerId: z.string().optional(),
});

// F1.4 — Modèles d'affiches & invitations
export const POSTER_TEMPLATES = [
  { id: "vip_invitation", label: "Invitation Privée VIP", category: "invitation" },
  { id: "modern_promo", label: "Offre Spéciale & Réduction", category: "promo" },
  { id: "grand_opening", label: "Nouvelle Ouverture / Événement", category: "event" },
  { id: "beauty_day", label: "Journée Portes Ouvertes / Soins", category: "event" },
] as const;

export type PosterTemplate = (typeof POSTER_TEMPLATES)[number]["id"];
