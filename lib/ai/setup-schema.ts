import { z } from "zod";
import { GOVERNORATES } from "@/lib/definitions";
import type { Governorate } from "@/lib/enums";

const governorate = z.enum(GOVERNORATES.map((g) => g.value) as [Governorate, ...Governorate[]]);
const slot = z.string().nullable().describe('Plage "HH:MM-HH:MM", ou null si fermé');

// Proposition structurée de l'assistant de configuration (cahier des charges §6, Module 1).
export const SetupProposalSchema = z.object({
  summary: z.string().describe("Résumé en une phrase de la configuration proposée"),
  centers: z
    .array(
      z.object({
        name: z.string(),
        governorate,
        openingHours: z.object({
          lundi: slot,
          mardi: slot,
          mercredi: slot,
          jeudi: slot,
          vendredi: slot,
          samedi: slot,
          dimanche: slot,
        }),
      }),
    )
    .min(1),
  services: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      durationMinutes: z.number().int(),
      priceTnd: z.number(),
    }),
  ),
  team: z.array(
    z.object({
      title: z.string().describe("Poste, ex. Coiffeuse, Esthéticienne, Réceptionniste"),
      role: z.enum(["MANAGER", "STAFF"]),
      count: z.number().int(),
    }),
  ),
});

export type SetupProposal = z.infer<typeof SetupProposalSchema>;
export type ProposalSource = "ai" | "offline";
