import { z } from "zod";
import { minutesToHhmm, parseRange } from "@/lib/booking/time";
import { PasswordSchema, isPhone, normalizePhone } from "@/lib/definitions";
import { TIMEOFF_KINDS } from "@/lib/enums";
import { RANGE_FORMAT, WORKING_DAYS, type WorkingDay } from "./hours";
import { MAX_SKILL_LENGTH, MAX_SKILLS, normalizeSkills } from "./skills";
import { MAX_TIMEOFF_REASON, checkTimeOffBounds, computeTimeOffRange, type TimeOffRange } from "./timeoff";

// F4 — Validation des champs de la fiche employé (poste, compétences, horaires individuels).

export const MAX_JOB_TITLE_LENGTH = 60;

// Les jours et le format de plage sont définis dans ./hours (partagés avec l'interface).
export { WORKING_DAYS };
export type { WorkingDay };

// « 9:00 - 17:30 » → « 09:00-17:30 ». La fin doit être strictement après le début.
const HoursRangeSchema = z
  .string()
  .trim()
  .refine((v) => RANGE_FORMAT.test(v), "Format attendu : 09:00-17:00.")
  .refine((v) => !RANGE_FORMAT.test(v) || parseRange(v) !== null, "L'heure de fin doit être après l'heure de début.")
  .transform((v) => {
    const { open, close } = parseRange(v)!;
    return `${minutesToHhmm(open)}-${minutesToHhmm(close)}`;
  });

// Horaires individuels. Sens des valeurs, par jour :
//   « 09:00-17:00 » = travaille sur cette plage · null = ne travaille pas · jour absent = suit le centre.
// Les clés inconnues sont refusées. L'objet entier à null (hors de ce schéma) = suit les horaires du centre.
export const WorkingHoursSchema = z.strictObject(
  Object.fromEntries(WORKING_DAYS.map((day) => [day, HoursRangeSchema.nullable().optional()])) as Record<
    WorkingDay,
    z.ZodOptional<z.ZodNullable<typeof HoursRangeSchema>>
  >,
);

export const JobTitleSchema = z
  .string()
  .trim()
  .max(MAX_JOB_TITLE_LENGTH, `Poste trop long (${MAX_JOB_TITLE_LENGTH} caractères maximum).`)
  .transform((v) => v || undefined);

// Compétences : vides et doublons (sans casse ni accents) retirés.
export const SkillsSchema = z
  .array(z.string().trim().max(MAX_SKILL_LENGTH, `Compétence trop longue (${MAX_SKILL_LENGTH} caractères maximum).`))
  .transform(normalizeSkills)
  .pipe(z.array(z.string()).max(MAX_SKILLS, `${MAX_SKILLS} compétences maximum.`));

// Enregistrement des horaires d'un employé : null ou objet vide = tous les jours suivent le centre (null en base).
export const StaffHoursInputSchema = WorkingHoursSchema.nullable().transform((v) => {
  const days = Object.fromEntries(Object.entries(v ?? {}).filter(([, value]) => value !== undefined));
  return Object.keys(days).length > 0 ? (days as Partial<Record<WorkingDay, string | null>>) : null;
});

// Tous les champs sont facultatifs : une mise à jour ne touche que ce qui est fourni.
export const StaffProfileFieldsSchema = z.object({
  jobTitle: JobTitleSchema.optional(),
  skills: SkillsSchema.optional(),
  workingHours: WorkingHoursSchema.nullable().optional(),
});

export type StaffProfileFields = z.output<typeof StaffProfileFieldsSchema>;

// ── Création d'un compte STAFF par le salon (F4, étape 3) ──
// Le rôle, l'organisation, le hash et les identifiants internes ne figurent pas ici : toute clé inconnue
// envoyée par le formulaire est ignorée, et le serveur impose STAFF et l'organisation de l'acteur.

export const MAX_PASSWORD_BYTES = 72; // bcrypt ne lit que les 72 premiers octets (UTF-8)
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const NameSchema = (message: string) => z.string().trim().min(2, message).max(60, "60 caractères maximum.");

// Mot de passe temporaire : règles existantes (8 caractères, une lettre, un chiffre) + limite bcrypt en octets.
// Jamais « trimé » : les espaces font partie du mot de passe.
const TemporaryPasswordSchema = PasswordSchema.refine(
  (v) => new TextEncoder().encode(v).length <= MAX_PASSWORD_BYTES,
  `Au plus ${MAX_PASSWORD_BYTES} octets (raccourcissez le mot de passe).`,
);

export const CreateStaffSchema = z
  .object({
    firstName: NameSchema("Prénom trop court."),
    lastName: NameSchema("Nom trop court."),
    // Facultatifs individuellement, mais au moins l'un des deux (voir plus bas) : c'est l'identifiant de connexion.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || z.email().safeParse(v).success, "Adresse e-mail invalide.")
      .transform((v) => v || undefined)
      .optional(),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || isPhone(v), "Numéro tunisien invalide (8 chiffres).")
      .transform((v) => (v ? normalizePhone(v) : undefined))
      .optional(),
    password: TemporaryPasswordSchema,
    jobTitle: JobTitleSchema.optional(),
    skills: SkillsSchema.optional(),
    centerIds: z
      .array(z.string().refine((v) => OBJECT_ID.test(v), "Centre invalide."))
      .min(1, "Choisissez au moins un centre.")
      .max(50)
      .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
  })
  .refine((d) => Boolean(d.email || d.phone), { path: ["email"], message: "Renseignez un e-mail ou un numéro de téléphone." });

export type CreateStaffInput = z.output<typeof CreateStaffSchema>;

// ── Congés et absences (F4, étape 5) ──
// Entrée du formulaire : le type, le mode (journées complètes ou plage horaire), les dates en heure de Tunis et un motif.
// Sortie : { kind, start, end, allDay, reason? }, prête à enregistrer. Seules ces clés sont lues : tout identifiant
// (employé, organisation, auteur) envoyé par le client est ignoré, le serveur les impose.
// « now » est injectable pour des tests déterministes (bornes de dates par rapport à aujourd'hui).
// { checkBounds: false } ne vérifie PAS les bornes par rapport à aujourd'hui (passé, futur, durée), mais garde toutes les
// autres règles (types, cohérence des dates et des heures, motif). Réservé à la modification d'une absence dont les
// dates ne changent pas ; la création et tout changement de dates utilisent la valeur par défaut (bornes vérifiées).
export function createStaffTimeOffSchema(now: Date = new Date(), options: { checkBounds?: boolean } = {}) {
  const optionalText = z.string().optional();
  return z
    .object({
      kind: z.enum(TIMEOFF_KINDS, { error: "Choisissez le type d'absence." }),
      mode: z.enum(["days", "range"], { error: "Choisissez des journées complètes ou une plage horaire." }),
      startDay: z.string({ error: "Date invalide." }),
      endDay: optionalText,
      from: optionalText,
      to: optionalText,
      reason: z
        .string()
        .trim()
        .max(MAX_TIMEOFF_REASON, `Motif trop long (${MAX_TIMEOFF_REASON} caractères maximum).`)
        .optional()
        .transform((v) => v || undefined),
    })
    .superRefine((v, ctx) => {
      const range = computeTimeOffRange(v);
      if (!range.ok) {
        ctx.addIssue({ code: "custom", path: [range.field], message: range.message });
        return;
      }
      const outOfBounds = options.checkBounds === false ? null : checkTimeOffBounds(range, now, v.mode);
      if (outOfBounds) ctx.addIssue({ code: "custom", path: [outOfBounds.field], message: outOfBounds.message });
    })
    .transform((v) => {
      // Les dates ont été validées juste avant : le calcul ne peut pas échouer ici.
      const range = computeTimeOffRange(v) as Extract<ReturnType<typeof computeTimeOffRange>, { ok: true }>;
      const out: { kind: (typeof TIMEOFF_KINDS)[number]; reason?: string } & TimeOffRange = {
        kind: v.kind,
        start: range.start,
        end: range.end,
        allDay: range.allDay,
      };
      if (v.reason) out.reason = v.reason;
      return out;
    });
}

export type StaffTimeOffInput = z.output<ReturnType<typeof createStaffTimeOffSchema>>;
