import { z } from "zod";
import { BUSY, LOW, OVERLOADED, type Forecast } from "@/lib/team/forecast";
import { askGemini, type AskModel } from "./team-performance";

// F4 — Lecture de la prévision de charge par Gemini : résumé et recommandations. L'IA PROPOSE, rien n'est appliqué.
// Données envoyées : agrégats par semaine et jours signalés (dates, taux), jamais de nom, de client ni de motif d'absence.
// Sans clé ou réponse invalide : recommandations déduites des règles, sans IA.

export const KINDS = ["hours", "leave", "staffing", "promotion"] as const;
export type RecommendationKind = (typeof KINDS)[number];
export type Recommendation = { kind: RecommendationKind; title: string; detail: string; dates: string[] };
export type ForecastAdvice = { source: "ai" | "offline"; summary: string; recommendations: Recommendation[] };

const AiSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  recommendations: z
    .array(
      z.object({
        kind: z.enum(KINDS),
        title: z.string().trim().min(1).max(100),
        detail: z.string().trim().min(1).max(300),
        dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(7).default([]),
      }),
    )
    .max(4),
});

export function buildForecastPrompt(f: Forecast, lang: "fr" | "ar") {
  const data = {
    referenceAvgRatePast28Days: f.referenceAvgRate,
    weeks: f.weeks,
    flaggedDays: f.alerts.slice(0, 20),
  };
  return `Tu aides le gérant d'un centre de beauté en Tunisie à anticiper la charge de travail des 4 prochaines semaines.
"rate" = minutes de rendez-vous / minutes de présence des praticiens (0 à 1+). Seuils : creux < ${LOW}, chargé >= ${BUSY}, surchargé >= ${OVERLOADED}.
Statuts : overloaded = surchargé, low = creux, uncovered = des praticiens mais tous absents ce jour-là.
Données (JSON) :
${JSON.stringify(data)}

Tâche : résume la situation (2 phrases max) puis propose jusqu'à 4 actions concrètes parmi : "hours" (ajuster des horaires), "leave" (déplacer ou limiter des congés), "staffing" (renforcer ou réaffecter), "promotion" (remplir un creux).
Règles : appuie-toi uniquement sur les données ; dans "dates" n'utilise que des dates de "flaggedDays" ; aucune décision à la place du gérant ; aucun jugement sur les personnes.
Rédige en ${lang === "ar" ? "arabe moderne" : "français"}.

Réponds STRICTEMENT avec ce JSON : {"summary":"...","recommendations":[{"kind":"hours","title":"...","detail":"...","dates":["AAAA-MM-JJ"]}]}`;
}

export function offlineAdvice(f: Forecast, lang: "fr" | "ar" = "fr"): ForecastAdvice {
  const ar = lang === "ar";
  const dates = (s: string) => f.alerts.filter((a) => a.status === s).map((a) => a.date).slice(0, 7);
  const over = dates("overloaded");
  const low = dates("low");
  const unc = dates("uncovered");
  const recs: Recommendation[] = [];
  if (unc.length) recs.push({ kind: "staffing", dates: unc, title: ar ? "أيام دون ممارسين" : "Jours sans praticien", detail: ar ? "جميع الممارسين غائبون في هذه الأيام: أعد توزيع الغيابات أو عيّن بديلًا." : "Tous les praticiens sont absents ces jours-là : répartir les absences ou prévoir un renfort." });
  if (over.length) recs.push({ kind: "hours", dates: over, title: ar ? "أيام مشغولة جدًا" : "Jours très chargés", detail: ar ? "الحمل مرتفع: مدّد ساعات العمل أو أعد توزيع المواعيد." : "Charge élevée : étendre les horaires ou répartir les rendez-vous sur d'autres jours." });
  if (low.length) recs.push({ kind: "promotion", dates: low, title: ar ? "أيام هادئة" : "Jours creux", detail: ar ? "حمل منخفض: مناسب للإجازات أو لعرض ترويجي." : "Charge faible : bons jours pour des congés ou une promotion." });
  const summary = f.days.length === 0
    ? ar ? "لا توجد بيانات للفترة." : "Aucune donnée sur la période."
    : ar
      ? `${over.length} يومًا مشغولًا جدًا، ${low.length} يومًا هادئًا و${unc.length} يومًا دون تغطية خلال 4 أسابيع.`
      : `Sur 4 semaines : ${over.length} jour(s) surchargé(s), ${low.length} jour(s) creux et ${unc.length} jour(s) sans couverture.`;
  return { source: "offline", summary, recommendations: recs };
}

export async function adviseForecast(f: Forecast, lang: "fr" | "ar" = "fr", ask: AskModel = askGemini): Promise<ForecastAdvice> {
  // Rien à signaler : inutile de payer un appel.
  if (f.days.length === 0 || f.alerts.length === 0) return offlineAdvice(f, lang);
  try {
    const raw = await ask(buildForecastPrompt(f, lang));
    if (!raw) return offlineAdvice(f, lang);
    const parsed = AiSchema.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
    if (!parsed.success) throw new Error("réponse hors schéma");
    const known = new Set(f.alerts.map((a) => a.date));
    return {
      source: "ai",
      summary: parsed.data.summary,
      // Une date inventée par l'IA est retirée : seules les dates signalées par le calcul sont conservées.
      recommendations: parsed.data.recommendations.map((r) => ({ ...r, dates: r.dates.filter((d) => known.has(d)) })),
    };
  } catch (error) {
    console.warn("Prévision IA indisponible, conseils calculés :", error instanceof SyntaxError ? "JSON invalide" : error instanceof Error ? error.message.slice(0, 40) : "erreur");
    return offlineAdvice(f, lang);
  }
}
