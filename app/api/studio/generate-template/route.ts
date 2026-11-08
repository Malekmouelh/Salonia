import { NextResponse, type NextRequest } from "next/server";
import { generateStudioTemplateWithAI } from "@/lib/ai/studio-ai";
import {
  GenerateStudioPromptSchema,
  type GeneratedStudioTemplate,
} from "@/lib/vitrine/studio-ai-schema";
import { getCurrentUser } from "@/lib/dal";

/**
 * Route API Next.js : /api/studio/generate-template
 * - GET  : Indique quel moteur d'IA est actuellement actif (Gemini, OpenAI, Claude ou Offline)
 * - POST : Génération IA de modèles d'affiches et d'invitations structurés pour le studio Salonia.
 */
export async function GET() {
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  let activeEngine: "groq" | "gemini" | "openai" | "claude" | "offline" = "offline";
  if (hasGroq) activeEngine = "groq";
  else if (hasGemini) activeEngine = "gemini";
  else if (hasOpenAI) activeEngine = "openai";
  else if (hasAnthropic) activeEngine = "claude";

  return NextResponse.json({
    ok: true,
    activeEngine,
    hasLiveAI: activeEngine !== "offline",
    models: {
      groq: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      gemini: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      openai: process.env.OPENAI_MODEL || "gpt-4o-mini",
      claude: "claude-3-5-sonnet",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    // Vérification de session utilisateur (propriétaire ou gérant du salon)
    let userSalonName = "";
    try {
      const user = await getCurrentUser();
      if (user?.organization?.name) {
        userSalonName = user.organization.name;
      }
    } catch {
      // Tolérance en cas de test ou d'accès anonyme pré-connecté
    }

    const body = await req.json();

    // Validation du schéma d'entrée
    const parsed = GenerateStudioPromptSchema.safeParse({
      ...body,
      salonName: body.salonName || userSalonName || "Maison de Beauté",
    });

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Données d'entrée invalides.";
      return NextResponse.json(
        { ok: false, error: firstError, issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Appel du service d'intelligence artificielle (Gemini -> Claude -> Heuristique)
    const template: GeneratedStudioTemplate = await generateStudioTemplateWithAI(
      parsed.data
    );

    return NextResponse.json({
      ok: true,
      template,
      provider: template.provider || "offline",
    });
  } catch (error) {
    console.error("Erreur dans /api/studio/generate-template :", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Une erreur est survenue lors de la génération du modèle.",
      },
      { status: 500 }
    );
  }
}

