import { AR } from "@/lib/i18n-ar";
import { STOCK_UNIT_LABELS } from "./labels";
import { getStockForecast, type ForecastRow } from "./forecast-data";
import { MSG_PRODUCT_NOT_FOUND, guard, invalid, type StockActor, type StockResult } from "./service";
import { ForecastExplainSchema } from "./schemas";

// Module 5 (IA) — Explication en langage clair d'une prévision de stock.
//
// Les CHIFFRES (rythme, date de rupture, quantité) viennent toujours du calcul (lib/stock/forecast.ts). Gemini ne fait que reformuler : on ne lui
// envoie que des quantités, des dates et le nom du produit (jamais de nom de client ni de donnée personnelle), et sa réponse est REFUSÉE si elle
// contient un nombre absent des chiffres fournis. Sans clé, en cas d'erreur, de réponse vide ou refusée : phrase de secours construite sans IA.
//
// La clé est lue dans GEMINI_API_KEY (même variable que le catalogue, Module 2) ; elle n'est ni journalisée ni renvoyée au client.
// Les réponses de l'IA sont gardées en mémoire pour la journée (quota gratuit de Gemini) : la clé du cache contient les chiffres, donc une
// consommation qui change produit une nouvelle phrase. Une phrase de secours n'est JAMAIS gardée : un échec passager de Gemini ne doit pas
// priver l'utilisateur de l'explication pour le reste de la journée.

// Alias qui suit le dernier modèle « flash-lite » : les modèles datés disparaissent (gemini-2.5-* n'est plus proposé aux nouveaux comptes) ou
// saturent (503) ; l'alias reste disponible. GEMINI_MODEL permet d'en changer sans toucher au code (variable partagée avec le catalogue).
const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
const GEMINI_TIMEOUT_MS = 12_000;
const CACHE_LIMIT = 500;
const MAX_TEXT = 600;

export type ExplainLang = "fr" | "ar";
export type Explanation = { text: string; source: "AI" | "BASIC" };
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const cache = new Map<string, Explanation>();
export const clearExplanationCache = () => cache.clear();

const unitLabel = (row: ForecastRow, lang: ExplainLang) => {
  const fr = STOCK_UNIT_LABELS[row.unit];
  return lang === "ar" ? (AR[fr] ?? fr) : fr;
};
const plainDate = (key: string, lang: ExplainLang) => new Date(`${key}T00:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-TN" : "fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
const nf = (value: number, lang: ExplainLang) => new Intl.NumberFormat(lang === "ar" ? "ar-TN" : "fr-FR").format(Math.round(value));

// Chiffres communiqués au modèle : uniquement ce qui est nécessaire, jamais de donnée personnelle.
// Une date limite de commande déjà dépassée n'est pas communiquée comme une date : « commanderDesAujourdhui » la remplace.
function facts(row: ForecastRow, lang: ExplainLang, todayKey?: string) {
  const overdue = !!(row.orderBy && todayKey && row.orderBy <= todayKey);
  return {
    produit: row.productName,
    unite: unitLabel(row, lang),
    stockActuel: row.stock,
    consommationParJour: Math.round(row.dailyRate),
    consommationParSemaine: Math.round(row.weeklyRate),
    dateRupture: row.ruptureDate ? { iso: row.ruptureDate, texte: plainDate(row.ruptureDate, lang) } : null,
    joursAvantRupture: row.daysLeft,
    delaiFournisseurJours: row.leadDays,
    commanderAvant: row.orderBy && !overdue ? { iso: row.orderBy, texte: plainDate(row.orderBy, lang) } : null,
    commanderDesAujourdhui: overdue,
    ruptureAvantLivraison: row.breakBeforeDelivery,
    commandeEnCours: row.onOrder,
    quantiteSuggeree: row.suggestedQuantity,
    fiabilite: row.confidence,
    semainesDHistorique: row.weeksOfData,
    statut: row.status,
  };
}

// Phrase de secours : mêmes chiffres, aucun appel externe.
export function basicExplanation(row: ForecastRow, lang: ExplainLang = "fr"): string {
  const u = unitLabel(row, lang);
  const n = (v: number) => nf(v, lang);
  const ar = lang === "ar";
  if (row.status === "NO_DATA") {
    return ar ? `لا يوجد سجلّ كافٍ (أقل من أسبوعين من الاستهلاك) لتقدير نفاد ${row.productName}.` : `Pas assez d'historique (moins de 2 semaines de consommation) pour estimer une rupture de ${row.productName}.`;
  }
  if (row.status === "NO_CONSUMPTION") {
    return ar ? `لم يُستهلك ${row.productName} بعد: لا يُتوقع أي نفاد.` : `${row.productName} n'a pas encore été consommé : aucune rupture n'est annoncée.`;
  }
  const parts: string[] = [];
  parts.push(ar ? `${row.productName}: حوالي ${n(row.dailyRate)} ${u} في اليوم.` : `${row.productName} : environ ${n(row.dailyRate)} ${u} par jour.`);
  if (row.ruptureDate) {
    parts.push(
      ar
        ? `بهذا المعدّل سينفد المخزون الحالي (${n(row.stock)} ${u}) حوالي ${plainDate(row.ruptureDate, lang)}.`
        : `Au rythme actuel, le stock de ${n(row.stock)} ${u} sera épuisé vers le ${plainDate(row.ruptureDate, lang)}.`,
    );
  } else {
    parts.push(ar ? `لا يُتوقع أي نفاد خلال الأشهر الأربعة القادمة (المخزون: ${n(row.stock)} ${u}).` : `Aucune rupture prévue dans les 4 prochains mois (stock : ${n(row.stock)} ${u}).`);
  }
  if (row.leadDays !== null) {
    parts.push(
      row.breakBeforeDelivery
        ? ar ? `يسلّم المزوّد في ${n(row.leadDays)} يومًا: سيحدث النفاد قبل التسليم حتى لو طلبتم اليوم.` : `Le fournisseur livre en ${n(row.leadDays)} jours : la rupture arrivera avant la livraison, même en commandant aujourd'hui.`
        : ar ? `يسلّم المزوّد في ${n(row.leadDays)} يومًا.` : `Le fournisseur livre en ${n(row.leadDays)} jours.`,
    );
  }
  if (row.suggestedQuantity > 0) parts.push(ar ? `الكمية المقترحة: ${n(row.suggestedQuantity)} ${u}.` : `Quantité suggérée : ${n(row.suggestedQuantity)} ${u}.`);
  return parts.join(" ");
}

// Tout nombre écrit par le modèle doit figurer dans les chiffres fournis (sous forme brute ou mise en forme) ; sinon la réponse est refusée.
const digitGroups = (text: string) => text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).match(/\d+/g) ?? [];
export function usesOnlyGivenNumbers(text: string, row: ForecastRow, lang: ExplainLang, todayKey?: string): boolean {
  const given = facts(row, lang, todayKey);
  const allowed = new Set<string>(digitGroups(JSON.stringify(given)));
  for (const value of [given.stockActuel, given.consommationParJour, given.consommationParSemaine, given.quantiteSuggeree, given.commandeEnCours]) for (const g of digitGroups(nf(value, lang))) allowed.add(g);
  return digitGroups(text).every((g) => allowed.has(g) || allowed.has(String(Number(g))));
}

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

async function askGemini(row: ForecastRow, lang: ExplainLang, todayKey: string, apiKey: string, fetchImpl: FetchLike): Promise<string | null> {
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const prompt = [
    "Tu es l'assistant de stock d'un salon de beauté en Tunisie.",
    `Rédige en ${lang === "ar" ? "arabe" : "français"} une explication de DEUX phrases au plus, simple et directe, destinée au gérant, à partir des chiffres ci-dessous.`,
    "Règles strictes : n'écris AUCUN nombre qui ne figure pas dans les chiffres fournis ; ne calcule rien ; n'ajoute aucune recommandation hors de commander la quantité suggérée ; pas de liste, pas de mise en forme.",
    `Chiffres (JSON) : ${JSON.stringify(facts(row, lang, todayKey))}`,
  ].join("\n");
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048 + 300 } }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = (await res.json()) as GeminiResponse;
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim() || null;
}

export async function explainForecastRow(row: ForecastRow, lang: ExplainLang, todayKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<Explanation> {
  const key = `${lang}:${todayKey}:${JSON.stringify(facts(row, lang, todayKey))}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let result: Explanation = { text: basicExplanation(row, lang), source: "BASIC" };
  const apiKey = process.env.GEMINI_API_KEY;
  // Rien à reformuler sans prévision : la phrase de secours suffit et n'utilise pas le quota.
  if (apiKey && row.status === "OK") {
    try {
      const text = await askGemini(row, lang, todayKey, apiKey, fetchImpl);
      if (text && text.length <= MAX_TEXT && usesOnlyGivenNumbers(text, row, lang, todayKey)) result = { text, source: "AI" };
    } catch (error) {
      // Jamais la clé ni le corps de la requête : seulement le type d'échec.
      console.error("Explication de prévision : Gemini indisponible, phrase de secours utilisée.", error instanceof Error ? error.message : "erreur");
    }
  }
  if (result.source === "AI") {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, result);
  }
  return result;
}

// Service appelé par l'action : droits et périmètre vérifiés par getStockForecast ; les chiffres sont RECALCULÉS côté serveur (jamais ceux du client).
export function explainStockForecast(actor: StockActor, input: unknown, now: Date = new Date(), fetchImpl?: FetchLike): Promise<StockResult<Explanation>> {
  return guard(async () => {
    const parsed = ForecastExplainSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const forecast = await getStockForecast(actor, parsed.data.centerId, now);
    if (!forecast.ok) return forecast;
    const row = forecast.rows.find((r) => r.productId === parsed.data.productId.toLowerCase() && r.centerId === parsed.data.centerId.toLowerCase());
    if (!row) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    return { ok: true, ...(await explainForecastRow(row, parsed.data.lang, forecast.todayKey, fetchImpl)) };
  });
}
