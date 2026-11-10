import { z } from "zod";

// Types supportés dans le studio
export const STUDIO_FONTS = [
  "playfair",
  "cormorant",
  "outfit",
  "inter",
  "roboto",
  "poppins",
  "montserrat",
  "cairo",
  "tajawal",
  "amiri",
] as const;

export const STUDIO_TEMPLATES = [
  "vip_invitation",
  "modern_promo",
  "grand_opening",
  "beauty_day",
] as const;

export const STUDIO_ASPECT_RATIOS = ["story", "square", "landscape"] as const;

export const STUDIO_TONES = [
  "luxe",
  "moderne",
  "minimaliste",
  "fete",
  "oriental",
  "romantique",
] as const;

export const STUDIO_TYPES = ["poster", "invitation"] as const;

export const STUDIO_BACKGROUND_PRESETS = [
  {
    id: "dark_gold",
    label: "Marbre & Or",
    category: "luxe",
    url: "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "rose_silk",
    label: "Boudoir Rose",
    category: "romantique",
    url: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "zen_spa",
    label: "Spa & Sérénité",
    category: "minimaliste",
    url: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "luxury_salon",
    label: "Salon Tamisé",
    category: "moderne",
    url: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "gala_glitter",
    label: "Soirée & Paillettes",
    category: "fete",
    url: "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "coiffure_chic",
    label: "Coiffure & Miroirs",
    category: "moderne",
    url: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "emerald_luxe",
    label: "Velours Émeraude",
    category: "oriental",
    url: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "minimal_white",
    label: "Marbre Pur",
    category: "minimaliste",
    url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=160&q=60",
  },
] as const;

// ── Schéma de la requête utilisateur envoyée à l'API ──
export const GenerateStudioPromptSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "La description doit contenir au moins 3 caractères.")
    .max(1000, "La description ne doit pas dépasser 1000 caractères."),
  type: z.enum(STUDIO_TYPES).optional().default("poster"),
  tone: z.enum(STUDIO_TONES).optional().default("luxe"),
  salonName: z.string().trim().optional().default(""),
  aspectRatio: z.enum(STUDIO_ASPECT_RATIOS).optional().default("story"),
  preferredPrimaryColor: z.string().optional().default(""),
  preferredSecondaryColor: z.string().optional().default(""),
  bgPhoto: z.string().optional().default(""),
  variationIndex: z.number().optional().default(0),
});

export type GenerateStudioPromptInput = z.input<typeof GenerateStudioPromptSchema>;
export type GenerateStudioPromptParsed = z.output<typeof GenerateStudioPromptSchema>;

// ── Schéma de configuration générée par l'IA ──
export const GeneratedStudioTemplateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .describe("Titre principal de l'affiche ou de l'invitation (court, impactant, élégant)"),
  subtitle: z
    .string()
    .trim()
    .max(160)
    .default("")
    .describe("Sous-titre explicatif ou détails raffinés de l'événement"),
  date: z
    .string()
    .trim()
    .max(80)
    .default("Ce week-end")
    .describe("Date et horaire de l'événement (ex: 'Vendredi & Samedi dès 15h')"),
  location: z
    .string()
    .trim()
    .max(100)
    .default("")
    .describe("Lieu de l'événement ou nom du salon"),
  discount: z
    .string()
    .trim()
    .max(50)
    .default("INVITATION PRIVÉE")
    .describe("Badge d'accroche ou offre promotionnelle (ex: '-20% PRIVILÈGE', 'VIP EXCLUSIF')"),
  template: z
    .enum(STUDIO_TEMPLATES)
    .default("vip_invitation")
    .describe("Preset de base du studio : vip_invitation, modern_promo, grand_opening, ou beauty_day"),
  aspectRatio: z
    .enum(STUDIO_ASPECT_RATIOS)
    .default("story")
    .describe("Format optimal : story (9:16), square (1:1), ou landscape (16:9)"),
  colorPalette: z.object({
    primary: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Code couleur primaire hexadécimal invalide")
      .describe("Couleur primaire (titres dorés, losanges, bordures et cadres or/rose-gold)"),
    secondary: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Code couleur secondaire hexadécimal invalide")
      .describe("Couleur secondaire sombre pour le fond dégradé luxueux"),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Code couleur accent hexadécimal invalide")
      .describe("Couleur accentuée claire pour sous-titres et reflets satinés"),
  }),
  fontFamily: z
    .enum(STUDIO_FONTS)
    .default("playfair")
    .describe("Typographie suggérée parmi les polices disponibles dans Salonia"),
  layoutType: z
    .enum(["centered", "editorial", "minimal", "bold"])
    .default("centered")
    .describe("Type d'agencement visuel recommandé"),
  toneDescription: z
    .string()
    .optional()
    .default("")
    .describe("Courte justification de l'ambiance et de la palette choisie"),
  bgPhoto: z
    .string()
    .optional()
    .default("")
    .describe("Photo d'arrière-plan personnalisée (URL ou Data-URL)"),
  provider: z
    .enum(["groq", "gemini", "openai", "claude", "offline"])
    .optional()
    .default("offline")
    .describe("Moteur d'intelligence artificielle ayant généré ce modèle"),
});

export type GeneratedStudioTemplate = z.infer<typeof GeneratedStudioTemplateSchema>;

