import { z } from "zod";
import { MAX_CANDIDATES, rankCandidates, type RankedCandidate } from "@/lib/team/assignment";
import { askGemini, type AskModel } from "./team-performance";

// F4 — Suggestion de praticien par Gemini. L'IA classe et explique ; le serveur ne retient que des candidats éligibles
// qu'il a lui-même fournis (étiquettes A, B…). Données envoyées : étiquettes et chiffres seulement, jamais de nom,
// de client, de contact ni de motif d'absence. Sans clé ou réponse invalide : classement de référence, sans IA.

export type Suggestion = { staffId: string; score: number; reason: string; skillMatch: number | null; loadMinutes: number; performance: number | null };
export type AssignmentSuggestions = { source: "ai" | "offline"; suggestions: Suggestion[]; blocked: number };

const AiSchema = z.object({
  ranking: z.array(z.object({ label: z.string().trim().min(1).max(4), reason: z.string().trim().min(1).max(200) })).min(1).max(MAX_CANDIDATES),
});

function offlineReason(c: RankedCandidate, lang: "fr" | "ar"): string {
  const ar = lang === "ar";
  const parts: string[] = [];
  if (c.skillMatch === null || c.skillMatch === 1) parts.push(ar ? "المهارات مناسبة" : "compétences adaptées");
  else parts.push(ar ? "مهارات ناقصة جزئيًا" : "compétences partielles");
  parts.push(c.loadMinutes < 600 ? (ar ? "جدول خفيف هذا الأسبوع" : "planning léger cette semaine") : ar ? "جدول مشغول هذا الأسبوع" : "planning chargé cette semaine");
  if ((c.performance ?? 0) >= 65) parts.push(ar ? "أداء جيد" : "bonne performance");
  return parts.join(ar ? "، " : ", ");
}

export function buildAssignmentPrompt(candidates: readonly RankedCandidate[], serviceNames: readonly string[], lang: "fr" | "ar") {
  const rows = candidates
    .filter((c) => c.eligible)
    .map((c) => ({ label: c.label, skillMatch: c.skillMatch, loadMinutesNext7Days: c.loadMinutes, performance0to100: c.performance, referenceScore: c.score }));
  return `Tu aides un salon de beauté en Tunisie à choisir le praticien le plus adapté pour un rendez-vous.
Prestations demandées : ${serviceNames.join(", ")}.
Candidats DISPONIBLES sur le créneau (JSON ; skillMatch = part des compétences exigées possédées, null = aucune exigée) :
${JSON.stringify(rows)}

Règles :
- Classe les candidats du meilleur au moins bon, en privilégiant : compétences complètes, puis charge de travail équilibrée, puis performance.
- Utilise uniquement les étiquettes fournies. N'invente aucun candidat et n'en omets aucun.
- Chaque "reason" : une phrase courte appuyée sur les chiffres. Aucun jugement personnel.
- Rédige en ${lang === "ar" ? "arabe moderne" : "français"}.

Réponds STRICTEMENT avec ce JSON : {"ranking":[{"label":"A","reason":"..."}]}`;
}

export async function suggestPractitioners(
  candidates: readonly import("@/lib/team/assignment").Candidate[],
  serviceNames: readonly string[],
  lang: "fr" | "ar" = "fr",
  ask: AskModel = askGemini,
): Promise<AssignmentSuggestions> {
  const ranked = rankCandidates(candidates);
  const eligible = ranked.filter((c) => c.eligible);
  const blocked = ranked.length - eligible.length;
  const toSuggestion = (c: RankedCandidate, reason: string): Suggestion => ({
    staffId: c.id, score: c.score, reason, skillMatch: c.skillMatch, loadMinutes: c.loadMinutes, performance: c.performance,
  });
  const offline = (): AssignmentSuggestions => ({ source: "offline", suggestions: eligible.slice(0, 3).map((c) => toSuggestion(c, offlineReason(c, lang))), blocked });
  if (eligible.length === 0) return { source: "offline", suggestions: [], blocked };
  // Un seul candidat : inutile de payer un appel.
  if (eligible.length === 1) return offline();

  try {
    const raw = await ask(buildAssignmentPrompt(ranked, serviceNames, lang));
    if (!raw) return offline();
    const parsed = AiSchema.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
    if (!parsed.success) throw new Error("réponse hors schéma");
    const byLabel = new Map(eligible.map((c) => [c.label, c]));
    const seen = new Set<string>();
    const picked: Suggestion[] = [];
    for (const r of parsed.data.ranking) {
      const c = byLabel.get(r.label);
      // Étiquette inconnue, non éligible ou répétée : ignorée.
      if (!c || seen.has(c.label)) continue;
      seen.add(c.label);
      picked.push(toSuggestion(c, r.reason));
    }
    if (picked.length === 0) throw new Error("aucun candidat valide");
    // Les candidats que l'IA a oubliés suivent dans l'ordre de référence : jamais de perte silencieuse.
    for (const c of eligible) if (!seen.has(c.label)) picked.push(toSuggestion(c, offlineReason(c, lang)));
    return { source: "ai", suggestions: picked.slice(0, 3), blocked };
  } catch (error) {
    console.warn("Suggestion IA indisponible, classement de référence :", error instanceof SyntaxError ? "JSON invalide" : error instanceof Error ? error.message.slice(0, 40) : "erreur");
    return offline();
  }
}
