import { z } from "zod";
import { CRITERIA, baselineScores, gradeFor, overallScore, type CriterionKey, type PerformanceIndicators } from "@/lib/team/performance";

// F4 — Évaluation de performance d'un employé par Google Gemini (GEMINI_API_KEY).
// L'IA PROPOSE, l'utilisateur décide : rien n'est enregistré ni appliqué automatiquement.
// Données envoyées : uniquement les agrégats anonymes de PerformanceIndicators (+ intitulé de poste). Jamais de nom,
// de client, de contact ni de motif d'absence. Sans clé, ou en cas d'échec / réponse invalide : repli calculé sans IA.

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_DEVIATION = 25; // l'IA ne peut pas s'éloigner de plus de 25 points de la note de référence calculée
const TEXT = z.string().trim().min(1).max(280);

const Score = z.number().int().min(0).max(100).nullable();
export const AiPerformanceSchema = z.object({
  scores: z.object({
    reliability: Score,
    presence: Score,
    occupancy: Score,
    revenue: Score,
    loyalty: Score,
    versatility: Score,
  }),
  summary: z.string().trim().min(1).max(500),
  strengths: z.array(TEXT).max(3),
  improvements: z.array(TEXT).max(3),
});

export type PerformanceReport = {
  source: "ai" | "offline";
  overall: number | null;
  grade: "A" | "B" | "C" | "D" | null;
  criteria: { key: CriterionKey; label: string; weight: number; score: number | null }[];
  summary: string;
  strengths: string[];
  improvements: string[];
  indicators: PerformanceIndicators;
};

export type AskModel = (prompt: string) => Promise<string | null>;

const GEMINI_TIMEOUT_MS = 10_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// Appel Gemini : JSON imposé, température 0. Renvoie null si aucune clé n'est définie.
// Un seul nouvel essai sur délai dépassé, erreur réseau, 429 ou 5xx (l'utilisateur attend dans une fenêtre : pas plus de ~20 s).
export const askGemini: AskModel = async (prompt) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 3072 },
    }),
  };
  let res: Response | null = null;
  let failure = "";
  for (let attempt = 0; attempt < 2 && !res?.ok; attempt++) {
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
      if (res.ok || !RETRYABLE.has(res.status)) break;
      failure = `Gemini ${res.status}`;
    } catch {
      res = null;
      failure = "Gemini : délai dépassé ou réseau indisponible";
    }
  }
  // Le corps d'erreur peut citer la requête : on ne remonte que le code HTTP.
  if (!res) throw new Error(failure);
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini : réponse vide.");
  return text;
};

export function buildPrompt(indicators: PerformanceIndicators, jobTitle: string | null, lang: "fr" | "ar", baseline: Record<CriterionKey, number | null>) {
  const rubric = CRITERIA.map((c) => `- ${c.key} (${c.weight} %) : ${c.label}`).join("\n");
  return `Tu es analyste RH pour un salon de beauté en Tunisie. Évalue UN employé à partir de ces indicateurs des ${indicators.periodDays} derniers jours.
Les montants sont en dinars tunisiens (DT). Les taux sont entre 0 et 1. "null" signifie "non mesurable" : ne l'invente pas.
Poste : ${jobTitle ?? "non renseigné"}.

Indicateurs (JSON) :
${JSON.stringify(indicators)}

Notes de référence calculées par formule (0-100) : ${JSON.stringify(baseline)}

Grille (note chaque critère de 0 à 100, ou null s'il n'est pas mesurable) :
${rubric}

Règles :
- Reste cohérent avec les notes de référence : écart maximal de ${MAX_DEVIATION} points, justifie par les indicateurs seulement.
- N'utilise que les données ci-dessus. Pas de suppositions sur la personne, sa santé ou sa vie privée. Les absences sont normales : n'en tire aucun jugement moral.
- Si l'échantillon est faible (moins de 5 rendez-vous réalisés), dis-le dans le résumé et reste prudent.
- Rédige en ${lang === "ar" ? "arabe moderne" : "français"}, ton factuel et bienveillant.

Réponds STRICTEMENT avec ce JSON :
{"scores":{"reliability":0,"presence":0,"occupancy":0,"revenue":0,"loyalty":0,"versatility":0},"summary":"2 phrases maximum","strengths":["max 3"],"improvements":["max 3 actions concrètes"]}`;
}

function toReport(
  source: "ai" | "offline",
  scores: Record<CriterionKey, number | null>,
  texts: { summary: string; strengths: string[]; improvements: string[] },
  indicators: PerformanceIndicators,
): PerformanceReport {
  const overall = overallScore(scores);
  return {
    source,
    overall,
    grade: gradeFor(overall),
    criteria: CRITERIA.map((c) => ({ key: c.key, label: c.label, weight: c.weight, score: scores[c.key] })),
    ...texts,
    indicators,
  };
}

// Évaluation sans IA : mêmes notes de référence, commentaire déduit des indicateurs.
export function offlineReport(indicators: PerformanceIndicators, lang: "fr" | "ar" = "fr"): PerformanceReport {
  const scores = baselineScores(indicators);
  const strengths: string[] = [];
  const improvements: string[] = [];
  const ar = lang === "ar";
  if ((scores.reliability ?? 0) >= 85) strengths.push(ar ? "التزام ممتاز بالمواعيد." : "Très bonne fiabilité : rendez-vous honorés.");
  else if (scores.reliability !== null && scores.reliability < 65) improvements.push(ar ? "تقليل الإلغاءات وحالات الغياب." : "Réduire les annulations et les absences de clients.");
  if ((scores.presence ?? 0) >= 90) strengths.push(ar ? "حضور منتظم." : "Présence régulière.");
  if (scores.occupancy !== null && scores.occupancy < 50) improvements.push(ar ? "رفع نسبة إشغال الجدول." : "Augmenter le remplissage du planning.");
  if ((scores.loyalty ?? 0) >= 70) strengths.push(ar ? "زبائن أوفياء يعودون." : "Bonne fidélisation : des clients reviennent.");
  else if (scores.loyalty !== null) improvements.push(ar ? "تشجيع الزبائن على العودة." : "Encourager les clients à revenir.");
  if (scores.versatility !== null && scores.versatility < 50) improvements.push(ar ? "تنويع الخدمات المقدمة." : "Élargir les prestations réalisées.");
  const overall = overallScore(scores);
  const low = indicators.completed < 5;
  const summary = overall === null
    ? ar ? "لا توجد بيانات كافية لتقييم هذا الموظف." : "Pas assez de données pour évaluer cet employé sur la période."
    : ar
      ? `التقييم العام ${overall}/100 على ${indicators.periodDays} يومًا${low ? " (عدد المواعيد قليل، النتيجة تقريبية)" : ""}.`
      : `Note globale ${overall}/100 sur ${indicators.periodDays} jours${low ? " (peu de rendez-vous : résultat indicatif)" : ""}.`;
  return toReport("offline", scores, { summary, strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 3) }, indicators);
}

// Évaluation par l'IA, validée par Zod puis bornée autour des notes de référence ; repli hors ligne en cas de problème.
export async function evaluatePerformance(
  indicators: PerformanceIndicators,
  jobTitle: string | null,
  lang: "fr" | "ar" = "fr",
  ask: AskModel = askGemini,
): Promise<PerformanceReport> {
  // Rien à évaluer : inutile de payer un appel.
  if (indicators.bookingsTotal === 0 && indicators.absentDays === 0) return offlineReport(indicators, lang);
  const baseline = baselineScores(indicators);
  try {
    const raw = await ask(buildPrompt(indicators, jobTitle, lang, baseline));
    if (!raw) return offlineReport(indicators, lang);
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const parsed = AiPerformanceSchema.safeParse(json);
    if (!parsed.success) throw new Error("réponse hors schéma");
    const scores = {} as Record<CriterionKey, number | null>;
    for (const c of CRITERIA) {
      const base = baseline[c.key];
      const ai = parsed.data.scores[c.key];
      // Critère non mesurable : toujours null. Sinon, note de l'IA bornée autour de la référence.
      scores[c.key] = base === null || ai === null ? null : Math.max(base - MAX_DEVIATION, Math.min(base + MAX_DEVIATION, ai));
    }
    const { summary, strengths, improvements } = parsed.data;
    return toReport("ai", scores, { summary, strengths, improvements }, indicators);
  } catch (error) {
    // Jamais le prompt, ni la réponse, ni la clé : seulement le type de problème.
    console.warn("Performance IA indisponible, repli hors ligne :", error instanceof SyntaxError ? "JSON invalide" : error instanceof Error ? error.message.slice(0, 40) : "erreur");
    return offlineReport(indicators, lang);
  }
}
