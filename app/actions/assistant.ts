"use server";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { redirect } from "next/navigation";
import { offlineSetup } from "@/lib/ai/offline-setup";
import { SetupProposalSchema, type ProposalSource, type SetupProposal } from "@/lib/ai/setup-schema";
import { logEvent } from "@/lib/audit";
import { requireRole } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

export type AssistantState =
  | { proposal?: SetupProposal; source?: ProposalSource; error?: string; description?: string }
  | undefined;

const SYSTEM_PROMPT = `Tu es l'assistant de configuration d'une plateforme de gestion de salons de beauté et de coiffure en Tunisie.
Le propriétaire décrit son salon en langage libre (français, arabe ou derja). Tu proposes une configuration initiale qu'il validera :
- un centre par ville ou adresse mentionnée, rattaché au bon gouvernorat tunisien (Djerba et Zarzis sont dans MEDENINE, Hammamet dans NABEUL, La Marsa et le Lac dans TUNIS) ;
- les horaires d'ouverture par jour au format "HH:MM-HH:MM", null si fermé (par défaut, fermé le dimanche sauf indication contraire) ;
- un catalogue de départ cohérent avec les prestations citées, avec durées réalistes et prix en dinars tunisiens adaptés au marché local ;
- une équipe type (postes et effectifs) pour faire tourner les centres.
Rédige les noms et le résumé dans la langue de la description. N'invente pas de centres qui ne sont pas suggérés par la description.`;

const MAX_CALLS_PER_HOUR = 10;
const calls = new Map<string, number[]>();

function allowCall(userId: string) {
  const now = Date.now();
  const recent = (calls.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_CALLS_PER_HOUR) return false;
  calls.set(userId, [...recent, now]);
  return true;
}

async function askClaude(description: string): Promise<SetupProposal | null> {
  // Les identifiants sont lus par le SDK (ANTHROPIC_API_KEY dans .env).
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: description }],
    output_config: { effort: "low", format: betaZodOutputFormat(SetupProposalSchema) },
    // Si un filtre de sécurité refuse la requête, l'API la rejoue sur un modèle de repli.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}

export async function generateSetup(_state: AssistantState, formData: FormData): Promise<AssistantState> {
  const user = await requireRole("OWNER");
  const description = String(formData.get("description") ?? "").trim();

  if (description.length < 15) {
    return { error: "Décrivez votre salon en une ou deux phrases (villes, prestations, horaires).", description };
  }
  if (description.length > 1500) {
    return { error: "Description trop longue (1500 caractères maximum).", description };
  }
  if (!allowCall(user.id)) {
    return { error: "Limite atteinte : réessayez dans une heure.", description };
  }

  try {
    const proposal = await askClaude(description);
    if (proposal) return { proposal, source: "ai", description };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error("Clé d'API Anthropic invalide.");
    else if (error instanceof Anthropic.RateLimitError) console.error("Limite de l'API Anthropic atteinte.");
    else if (error instanceof Anthropic.APIError) console.error(`Erreur API ${error.status} :`, error.message);
    else console.error("Assistant IA indisponible :", error);
  }

  // Repli sans IA : l'utilisateur obtient toujours une proposition modifiable.
  return { proposal: offlineSetup(description), source: "offline", description };
}

export async function applySetup(formData: FormData) {
  const user = await requireRole("OWNER");
  if (!user.organization) redirect("/dashboard");

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("proposal") ?? ""));
  } catch {
    redirect("/dashboard/assistant");
  }
  const parsed = SetupProposalSchema.safeParse(raw);
  if (!parsed.success) redirect("/dashboard/assistant");

  const { centers, services, team } = parsed.data;
  const organizationId = user.organization.id;
  const existing = new Set(user.organization.centers.map((c) => c.name.toLowerCase()));

  await prisma.$transaction(async (tx) => {
    for (const c of centers) {
      if (existing.has(c.name.toLowerCase())) {
        // Centre déjà présent : on met seulement à jour ses horaires.
        await tx.center.updateMany({
          where: { organizationId, name: { equals: c.name, mode: "insensitive" } },
          data: { openingHours: c.openingHours, governorate: c.governorate },
        });
      } else {
        await tx.center.create({
          data: {
            organizationId,
            name: c.name,
            governorate: c.governorate,
            openingHours: c.openingHours,
            members: { create: { userId: user.id } },
          },
        });
      }
    }
    // Le catalogue et l'équipe type seront importés par les modules Catalogue (3) et Équipe (4).
    await tx.organization.update({
      where: { id: organizationId },
      data: { catalogDraft: { services, team, createdAt: new Date().toISOString() } },
    });
  });

  await logEvent("AI_SETUP_APPLIED", {
    userId: user.id,
    organizationId,
    detail: `${centers.length} centre(s), ${services.length} service(s)`,
  });
  redirect("/dashboard?welcome=1");
}
