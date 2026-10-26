import { z } from "zod";
import type { Governorate } from "@/lib/enums";

export const GOVERNORATES: { value: Governorate; label: string }[] = [
  { value: "TUNIS", label: "Tunis" },
  { value: "ARIANA", label: "Ariana" },
  { value: "BEN_AROUS", label: "Ben Arous" },
  { value: "MANOUBA", label: "Manouba" },
  { value: "NABEUL", label: "Nabeul" },
  { value: "ZAGHOUAN", label: "Zaghouan" },
  { value: "BIZERTE", label: "Bizerte" },
  { value: "BEJA", label: "Béja" },
  { value: "JENDOUBA", label: "Jendouba" },
  { value: "KEF", label: "Le Kef" },
  { value: "SILIANA", label: "Siliana" },
  { value: "SOUSSE", label: "Sousse" },
  { value: "MONASTIR", label: "Monastir" },
  { value: "MAHDIA", label: "Mahdia" },
  { value: "SFAX", label: "Sfax" },
  { value: "KAIROUAN", label: "Kairouan" },
  { value: "KASSERINE", label: "Kasserine" },
  { value: "SIDI_BOUZID", label: "Sidi Bouzid" },
  { value: "GABES", label: "Gabès" },
  { value: "MEDENINE", label: "Médenine (Djerba)" },
  { value: "TATAOUINE", label: "Tataouine" },
  { value: "GAFSA", label: "Gafsa" },
  { value: "TOZEUR", label: "Tozeur" },
  { value: "KEBILI", label: "Kébili" },
];

export function governorateLabel(value: Governorate) {
  return GOVERNORATES.find((g) => g.value === value)?.label ?? value;
}

// Téléphone tunisien : 8 chiffres, avec ou sans +216 / 00216.
const TN_PHONE = /^(?:\+216|00216)?[2-9]\d{7}$/;

export function normalizePhone(value: string) {
  const compact = value.replace(/[\s.-]/g, "");
  return compact.replace(/^(?:\+216|00216)/, "");
}

export function isPhone(value: string) {
  return TN_PHONE.test(value.replace(/[\s.-]/g, ""));
}

const password = z
  .string()
  .min(8, "Au moins 8 caractères.")
  .regex(/[a-zA-Z]/, "Au moins une lettre.")
  .regex(/[0-9]/, "Au moins un chiffre.");

// Même règle de mot de passe, réutilisable hors de ce fichier (création de comptes par le salon).
export const PasswordSchema = password;

export const LoginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Entrez votre e-mail ou votre téléphone.")
    .refine(
      (v) => z.email().safeParse(v).success || isPhone(v),
      "E-mail ou numéro de téléphone invalide.",
    ),
  password: z.string().min(1, "Entrez votre mot de passe."),
});

export const RegisterSchema = z
  .object({
    firstName: z.string().trim().min(2, "Prénom trop court."),
    lastName: z.string().trim().min(2, "Nom trop court."),
    salonName: z.string().trim().min(2, "Nom du salon trop court."),
    governorate: z.enum(GOVERNORATES.map((g) => g.value) as [Governorate, ...Governorate[]], {
      error: "Choisissez un gouvernorat.",
    }),
    email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || isPhone(v), "Numéro tunisien invalide (8 chiffres)."),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  });

// Compte client : le téléphone est obligatoire (fiche client du salon, confirmation et rappels).
export const ClientRegisterSchema = z
  .object({
    firstName: z.string().trim().min(2, "Prénom trop court."),
    lastName: z.string().trim().min(2, "Nom trop court."),
    phone: z.string().trim().refine(isPhone, "Numéro tunisien invalide (8 chiffres)."),
    email: z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide.")),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  });

// Retour après connexion ou inscription : chemins internes uniquement.
export function safeNext(next: unknown) {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null;
}

export const ForgotPasswordSchema = z.object({
  identifier: LoginSchema.shape.identifier,
});

export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  });

export type FormState =
  | {
      errors?: Record<string, string[] | undefined>;
      message?: string;
      success?: string;
      // Lien de réinitialisation affiché en démo (pas d'envoi d'e-mail réel).
      devLink?: string;
      values?: Record<string, string>;
    }
  | undefined;

export const ROLE_LABELS = {
  SUPER_ADMIN: "Super administrateur",
  OWNER: "Propriétaire",
  MANAGER: "Gérant de centre",
  STAFF: "Staff",
  CLIENT: "Client",
} as const;
