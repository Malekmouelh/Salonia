import { createHash } from "node:crypto";
import { z } from "zod";
import { AR } from "@/lib/i18n-ar";
import { getConsumptionInsights } from "./insights-data";
import { RECENT_DAYS, TARGET_COVER_DAYS, type Finding, type InsightsReport } from "./insights";
import { STOCK_UNIT_LABELS } from "./labels";
import { ConsumptionAnalysisSchema } from "./schemas";
import { guard, invalid, type StockActor, type StockResult } from "./service";
import type { FetchLike } from "./forecast-explain";

// Module 5 (IA) — Analyse décisionnelle de la consommation entre centres.
//
// RÉPARTITION DES RÔLES
//  - Le code (lib/stock/insights.ts) calcule TOUS les chiffres et détecte les situations : consommation par centre, évolutions, écarts entre
//    centres (par rendez-vous), pics, pertes, stock immobilisé, déséquilibres, risques de rupture.
//  - Gemini reçoit ces CONSTATS (pas les mouvements bruts) et apporte ce qu'une formule ne fait pas : relier plusieurs constats (même produit
//    dans plusieurs centres, même centre sur plusieurs produits), les hiérarchiser, formuler des HYPOTHÈSES à vérifier et choisir une action
//    concrète parmi une liste fermée. Il ne calcule rien et n'exécute rien : l'utilisateur décide.
//
// GARDE-FOUS : seuls des noms de produits et de centres, des quantités et des dates sont envoyés (jamais de nom de client ni de personnel). La
// réponse est REFUSÉE si elle n'est pas du JSON conforme, cite un constat, un produit ou un centre inconnu, propose un transfert qui ne
// correspond à aucun déséquilibre calculé, ou contient un nombre absent des données fournies. Refusée, absente, sans clé ou en cas d'erreur :
// synthèse construite sans IA à partir des mêmes constats. Une synthèse de secours n'est JAMAIS gardée en cache.
// La clé est lue dans GEMINI_API_KEY (même variable que la prévision et le catalogue) ; elle n'est ni journalisée ni renvoyée.

const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
const GEMINI_TIMEOUT_MS = 25_000;
const CACHE_LIMIT = 100;
const MAX_FINDINGS_SENT = 24;
const MAX_PRODUCTS_SENT = 15;

export type AnalysisLang = "fr" | "ar";
export const ACTION_TYPES = ["COMMANDER", "TRANSFERER", "VERIFIER", "SURVEILLER", "REVOIR_RECETTE"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export type AnalysisAction = { type: ActionType; productId: string | null; centerId: string | null; toCenterId: string | null; label: string };
export type AnalysisItem = { findingIds: string[]; reading: string; hypotheses: string[]; action: AnalysisAction };
export type ConsumptionAnalysis = { source: "AI" | "BASIC"; title: string; priorities: string[]; items: AnalysisItem[]; limits: string[] };

const cache = new Map<string, ConsumptionAnalysis>();
export const clearAnalysisCache = () => cache.clear();

// ── Mise en mots sans IA : mêmes constats, mêmes chiffres ──
const nf = (value: number, lang: AnalysisLang) => new Intl.NumberFormat(lang === "ar" ? "ar-TN" : "fr-FR").format(Math.round(value));
const num = (f: Finding, key: string) => Number(f.metrics[key] ?? 0);

type Names = { product: (id: string) => string; center: (id: string) => string; unit: (id: string) => string };
function namesOf(report: InsightsReport, lang: AnalysisLang): Names {
  const products = new Map(report.products.map((p) => [p.productId, p]));
  const centers = new Map(report.centers.map((c) => [c.centerId, c.name]));
  return {
    product: (id) => products.get(id)?.name ?? "—",
    center: (id) => centers.get(id) ?? "—",
    unit: (id) => {
      const fr = STOCK_UNIT_LABELS[products.get(id)?.unit ?? "PIECE"];
      return lang === "ar" ? (AR[fr] ?? fr) : fr;
    },
  };
}

export function describeFinding(f: Finding, names: Names, lang: AnalysisLang): string {
  const P = names.product(f.productId);
  const C = names.center(f.centerId);
  const C2 = f.otherCenterId ? names.center(f.otherCenterId) : "";
  const u = names.unit(f.productId);
  const n = (key: string) => nf(num(f, key), lang);
  const ar = lang === "ar";
  switch (f.type) {
    case "RUPTURE_RISK":
      if (f.metrics.forecastAvailable) {
        const before = f.metrics.breakBeforeDelivery === true;
        return ar
          ? `${P} (${C}): المخزون ${n("stock")} ${u}، النفاد المتوقع خلال ${n("daysLeft")} يومًا${before ? "، قبل أن يتمكن المزوّد من التسليم" : ""}.`
          : `${P} (${C}) : stock de ${n("stock")} ${u}, rupture estimée dans ${n("daysLeft")} jour(s)${before ? ", avant la livraison possible du fournisseur" : ""}.`;
      }
      return ar ? `${P} (${C}): المخزون ${n("stock")} ${u} عند الصفر أو عند حدّ التنبيه، دون سجلّ كافٍ لتقدير النفاد.` : `${P} (${C}) : stock de ${n("stock")} ${u} à zéro ou au seuil d'alerte, sans assez d'historique pour estimer la rupture.`;
    case "IMBALANCE": {
      const sender = f.metrics.senderCoverDays === null;
      return ar
        ? `لم يبقَ في ${C} سوى ${n("receiverCoverDays")} يومًا من ${P}، بينما يحتفظ ${C2} بـ ${n("senderStock")} ${u}${sender ? " دون استهلاكه" : ` (تغطية ${n("senderCoverDays")} يومًا)`}: نقل حوالي ${n("quantity")} ${u} يعيد ${C} إلى ${n("targetCoverDays")} يومًا من التغطية.`
        : `${C} n'a plus que ${n("receiverCoverDays")} jour(s) de ${P}, alors que ${C2} en détient ${n("senderStock")} ${u}${sender ? " sans le consommer" : ` (${n("senderCoverDays")} jours de couverture)`} : transférer environ ${n("quantity")} ${u} ramènerait ${C} à ${n("targetCoverDays")} jours de couverture.`;
    }
    case "SPIKE":
      return ar
        ? `${C}: استُهلك ${n("lastWeek")} ${u} من ${P} هذا الأسبوع الأخير مقابل حوالي ${n("usualWeek")} ${u} أسبوعيًا سابقًا (+${n("aboveUsualPct")}%).`
        : `${C} : ${P} consommé à ${n("lastWeek")} ${u} cette dernière semaine, contre environ ${n("usualWeek")} ${u} par semaine auparavant (+${n("aboveUsualPct")} %).`;
    case "LOSSES":
      return ar
        ? `${C}: خرج ${n("manualOut")} ${u} من ${P} يدويًا (دون التحويلات) مقابل ${n("consumption")} ${u} استهلكتها المواعيد (${n("sharePct")}% من الخروجات).`
        : `${C} : ${n("manualOut")} ${u} de ${P} sortis à la main (hors transferts), contre ${n("consumption")} ${u} consommés par les rendez-vous (${n("sharePct")} % des sorties).`;
    case "CENTER_OUTLIER":
      if (f.metrics.normalizedBy === "APPOINTMENTS") {
        return ar ? `يستهلك ${C} ${n("aboveOthersPct")}% أكثر من ${P} مقارنةً بالمراكز الأخرى لنفس عدد المواعيد.` : `${C} consomme ${n("aboveOthersPct")} % de ${P} de plus que les autres centres, pour un même nombre de rendez-vous.`;
      }
      return ar ? `يستهلك ${C} ${n("aboveOthersPct")}% أكثر من ${P} يوميًا مقارنةً بالمراكز الأخرى (تعذّر قياس النشاط في كل المراكز).` : `${C} consomme ${n("aboveOthersPct")} % de ${P} de plus par jour que les autres centres (l'activité n'a pas pu être mesurée dans tous les centres).`;
    case "TREND_UP":
      return ar
        ? `${C}: استهلاك ${P} في ارتفاع بنسبة ${n("changePct")}% (${n("current")} ${u} مقابل ${n("previous")} ${u} في الفترة السابقة).`
        : `${C} : consommation de ${P} en hausse de ${n("changePct")} % (${n("current")} ${u} contre ${n("previous")} ${u} sur la période précédente).`;
    case "TREND_DOWN":
      return ar
        ? `${C}: استهلاك ${P} في انخفاض بنسبة ${nf(Math.abs(num(f, "changePct")), lang)}% (${n("current")} ${u} مقابل ${n("previous")} ${u} في الفترة السابقة).`
        : `${C} : consommation de ${P} en baisse de ${nf(Math.abs(num(f, "changePct")), lang)} % (${n("current")} ${u} contre ${n("previous")} ${u} sur la période précédente).`;
    case "DORMANT":
      return ar
        ? `يحتفظ ${C} بـ ${n("stock")} ${u} من ${P} دون أي استهلاك في هذه الفترة، بينما كان ${n("previous")} ${u} قبلها.`
        : `${C} garde ${n("stock")} ${u} de ${P} sans aucune consommation sur la période, alors qu'il y en avait ${n("previous")} ${u} avant.`;
  }
}

function basicAction(f: Finding, names: Names, lang: AnalysisLang): AnalysisAction {
  const P = names.product(f.productId);
  const C = names.center(f.centerId);
  const u = names.unit(f.productId);
  const ar = lang === "ar";
  const q = nf(num(f, "quantity") || num(f, "suggestedQuantity"), lang);
  const make = (type: ActionType, label: string, toCenterId: string | null = null, centerId: string | null = f.centerId): AnalysisAction => ({ type, productId: f.productId, centerId, toCenterId, label });
  switch (f.type) {
    case "RUPTURE_RISK":
      return num(f, "suggestedQuantity") > 0
        ? make("COMMANDER", ar ? `طلب حوالي ${q} ${u} من ${P} لفائدة ${C}.` : `Commander environ ${q} ${u} de ${P} pour ${C}.`)
        : make("SURVEILLER", ar ? `متابعة مخزون ${P} في ${C}.` : `Surveiller le stock de ${P} à ${C}.`);
    case "IMBALANCE":
      return make("TRANSFERER", ar ? `نقل حوالي ${q} ${u} من ${P} من ${names.center(f.otherCenterId ?? "")} إلى ${C}.` : `Transférer environ ${q} ${u} de ${P} de ${names.center(f.otherCenterId ?? "")} vers ${C}.`, f.centerId, f.otherCenterId ?? null);
    case "SPIKE":
      return make("VERIFIER", ar ? `التحقق من سبب ذروة ${P} في ${C} (حدث، خدمة جديدة، هدر).` : `Vérifier l'origine du pic de ${P} à ${C} (événement, nouvelle prestation, gaspillage).`);
    case "LOSSES":
      return make("VERIFIER", ar ? `مراجعة الخروجات اليدوية لـ ${P} في ${C}.` : `Vérifier les sorties manuelles de ${P} à ${C}.`);
    case "CENTER_OUTLIER":
      return make("VERIFIER", ar ? `مقارنة استعمال ${P} في ${C} بالمراكز الأخرى (الجرعة، الوصفة).` : `Comparer l'utilisation de ${P} à ${C} avec les autres centres (dosage, recette).`);
    case "TREND_UP":
      return make("SURVEILLER", ar ? `متابعة تغطية ${P} في ${C}.` : `Surveiller la couverture de ${P} à ${C}.`);
    case "TREND_DOWN":
      return make("SURVEILLER", ar ? `تكييف طلبات ${P} لفائدة ${C} مع الانخفاض.` : `Adapter les commandes de ${P} pour ${C} à la baisse.`);
    case "DORMANT":
      return make("SURVEILLER", ar ? `تحديد مصير المخزون الراكد من ${P} في ${C} (استعمال أو نقل أو عدم إعادة الطلب).` : `Décider du sort du stock immobilisé de ${P} à ${C} (utiliser, transférer ou ne pas recommander).`);
  }
}

const MAX_BASIC_ITEMS = 6;
// Synthèse sans IA : un point par constat prioritaire (déjà classés par gravité), sans hypothèse inventée.
export function basicAnalysis(report: InsightsReport, lang: AnalysisLang = "fr"): ConsumptionAnalysis {
  const names = namesOf(report, lang);
  const ar = lang === "ar";
  const high = report.findings.filter((f) => f.severity === "HIGH").length;
  const top = report.findings.slice(0, MAX_BASIC_ITEMS);
  const title =
    report.findings.length === 0
      ? ar ? "لم تُرصد أي حالة غير عادية في هذه الفترة." : "Aucune situation inhabituelle détectée sur cette période."
      : ar ? `${nf(report.findings.length, lang)} حالة تستحق الفحص، منها ${nf(high, lang)} ذات أولوية.` : `${nf(report.findings.length, lang)} situation(s) à examiner, dont ${nf(high, lang)} prioritaire(s).`;
  return {
    source: "BASIC",
    title,
    priorities: top.slice(0, 3).map((f) => f.id),
    items: top.map((f) => ({ findingIds: [f.id], reading: describeFinding(f, names, lang), hypotheses: [], action: basicAction(f, names, lang) })),
    limits: [],
  };
}

// ── Données communiquées à Gemini : constats et contexte, avec des alias courts (F1, C1, P1) : aucun identifiant de base n'est transmis ──
type Aliases = { finding: Map<string, Finding>; center: Map<string, string>; product: Map<string, string>; findingOf: Map<string, string>; centerOf: Map<string, string>; productOf: Map<string, string> };

function buildFacts(report: InsightsReport, lang: AnalysisLang) {
  const findings = report.findings.slice(0, MAX_FINDINGS_SENT);
  const aliases: Aliases = { finding: new Map(), center: new Map(), product: new Map(), findingOf: new Map(), centerOf: new Map(), productOf: new Map() };
  report.centers.forEach((c, i) => {
    aliases.center.set(`C${i + 1}`, c.centerId);
    aliases.centerOf.set(c.centerId, `C${i + 1}`);
  });
  report.products.forEach((p, i) => {
    aliases.product.set(`P${i + 1}`, p.productId);
    aliases.productOf.set(p.productId, `P${i + 1}`);
  });
  findings.forEach((f, i) => {
    aliases.finding.set(`F${i + 1}`, f);
    aliases.findingOf.set(f.id, `F${i + 1}`);
  });
  const names = namesOf(report, lang);
  const facts = {
    langue: lang === "ar" ? "arabe" : "français",
    periode: { jours: report.windowDays, semaineRecente: RECENT_DAYS, couvertureCibleJours: TARGET_COVER_DAYS, aujourdhui: report.todayKey },
    qualite: { joursHistorique: report.quality.historyDays, partDonneesDemonstrationPct: report.quality.simulatedSharePct, centresComparables: report.quality.comparable },
    centres: report.centers.map((c) => ({ id: aliases.centerOf.get(c.centerId), nom: c.name, rendezVous: c.appointments, rendezVousPrecedents: c.previousAppointments, indiceIntensite: c.intensityIndex })),
    produits: report.products.slice(0, MAX_PRODUCTS_SENT).map((p) => ({
      id: aliases.productOf.get(p.productId),
      nom: p.name,
      unite: names.unit(p.productId),
      total: p.current,
      precedent: p.previous,
      evolutionPct: p.changePct,
      parCentre: p.centers.map((c) => ({ centre: aliases.centerOf.get(c.centerId), consommation: c.current, partPct: c.sharePct, stock: c.stock, couvertureJours: c.coverDays })),
    })),
    constats: findings.map((f) => ({
      id: aliases.findingOf.get(f.id),
      type: f.type,
      gravite: f.severity,
      produit: aliases.productOf.get(f.productId),
      centre: aliases.centerOf.get(f.centerId),
      ...(f.otherCenterId ? { autreCentre: aliases.centerOf.get(f.otherCenterId) } : {}),
      mesures: f.metrics,
    })),
  };
  return { facts, aliases };
}

// ── Réponse de Gemini : JSON conforme, références connues, aucun nombre inventé ──
// Gemini met parfois le NOM au lieu de l'identifiant : on accepte les deux (résolus plus bas), jamais autre chose que ce qui existe.
const AliasOrNull = z.string().max(120).nullable().optional();
const AiResponse = z.object({
  titre: z.string().trim().min(1).max(200),
  priorites: z.array(z.string().max(8)).max(5).default([]),
  analyses: z
    .array(
      z.object({
        constats: z.array(z.string().max(8)).min(1).max(4),
        lecture: z.string().trim().min(1).max(450),
        hypotheses: z.array(z.string().trim().min(1).max(240)).max(2).default([]),
        action: z.object({ type: z.enum(ACTION_TYPES), produit: AliasOrNull, centre: AliasOrNull, versCentre: AliasOrNull, libelle: z.string().trim().min(1).max(240) }),
      }),
    )
    .min(1)
    .max(6),
  limites: z.array(z.string().trim().min(1).max(240)).max(3).default([]),
});

const digitGroups = (text: string) => text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).match(/\d+/g) ?? [];

// Tout nombre du texte doit figurer dans les données fournies, brut ou mis en forme (« 1 800 » compte pour 1800).
function allowedNumbers(facts: unknown, lang: AnalysisLang): Set<string> {
  const allowed = new Set<string>(digitGroups(JSON.stringify(facts)));
  const walk = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      for (const g of digitGroups(nf(value, lang))) allowed.add(g);
      for (const g of digitGroups(nf(Math.abs(value), lang))) allowed.add(g);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(facts);
  return allowed;
}

export function usesOnlyGivenNumbers(texts: string[], facts: unknown, lang: AnalysisLang): boolean {
  const allowed = allowedNumbers(facts, lang);
  return texts.every((text) => digitGroups(text).every((g) => allowed.has(g) || allowed.has(String(Number(g)))));
}

type ParseOutcome = { analysis: ConsumptionAnalysis; reason?: undefined } | { analysis: null; reason: string };
const refuse = (reason: string): ParseOutcome => ({ analysis: null, reason });

// Motif de refus = une catégorie fixe (jamais le contenu de la réponse), pour le journal du serveur.
export function parseAiAnalysisDetailed(raw: string, facts: unknown, aliases: Aliases, lang: AnalysisLang): ParseOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return refuse("JSON illisible");
  }
  const parsed = AiResponse.safeParse(json);
  if (!parsed.success) return refuse(`structure non conforme : ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "racine"} ${i.code}`).join(", ")}`);
  const ai = parsed.data;

  const finding = (alias: string) => aliases.finding.get(alias);
  const namesByAlias = (list: unknown) => new Map((Array.isArray(list) ? list : []).flatMap((x: { id?: string; nom?: string }) => (x?.id && x?.nom ? [[x.nom.trim().toLowerCase(), x.id] as const] : [])));
  const f = facts as { centres?: unknown; produits?: unknown };
  const centerNames = namesByAlias(f.centres);
  const productNames = namesByAlias(f.produits);
  const refOf = (value: string, names: Map<string, string>) => names.get(value.trim().toLowerCase()) ?? value.trim().toUpperCase();
  if (ai.priorites.some((a) => !finding(a))) return refuse("priorité inconnue");
  const items: AnalysisItem[] = [];
  for (const a of ai.analyses) {
    const cited = a.constats.map(finding);
    if (cited.some((f) => !f)) return refuse("constat cité inconnu");
    const list = cited as Finding[];
    const product = a.action.produit ? aliases.product.get(refOf(a.action.produit, productNames)) : null;
    const center = a.action.centre ? aliases.center.get(refOf(a.action.centre, centerNames)) : null;
    const toCenter = a.action.versCentre ? aliases.center.get(refOf(a.action.versCentre, centerNames)) : null;
    if ((a.action.produit && !product) || (a.action.centre && !center) || (a.action.versCentre && !toCenter)) return refuse("produit ou centre d'action inconnu");
    // L'action doit porter sur un produit et un centre cités par les constats de l'analyse.
    if (product && !list.some((f) => f.productId === product)) return refuse("produit d'action non cité par les constats");
    if (center && !list.some((f) => f.centerId === center || f.otherCenterId === center)) return refuse("centre d'action non cité par les constats");
    if (toCenter && !list.some((f) => f.centerId === toCenter || f.otherCenterId === toCenter)) return refuse("centre de destination non cité par les constats");
    if (a.action.type === "TRANSFERER") {
      // Un transfert n'est proposé que s'il correspond exactement à un déséquilibre CALCULÉ : de la source vers le centre en tension.
      const ok = !!product && !!center && !!toCenter && center !== toCenter && list.some((f) => f.type === "IMBALANCE" && f.productId === product && f.otherCenterId === center && f.centerId === toCenter);
      if (!ok) return refuse("transfert ne correspondant à aucun déséquilibre calculé");
    }
    if (a.action.type === "COMMANDER" && (!product || !center)) return refuse("commande sans produit ou centre");
    items.push({
      findingIds: list.map((f) => f.id),
      reading: a.lecture,
      hypotheses: a.hypotheses,
      action: { type: a.action.type, productId: product ?? null, centerId: center ?? null, toCenterId: toCenter ?? null, label: a.action.libelle },
    });
  }
  const texts = [ai.titre, ...ai.limites, ...ai.analyses.flatMap((a) => [a.lecture, a.action.libelle, ...a.hypotheses])];
  if (!usesOnlyGivenNumbers(texts, facts, lang)) return refuse("nombre absent des données");
  return { analysis: { source: "AI", title: ai.titre, priorities: ai.priorites.map((a) => finding(a)!.id), items, limits: ai.limites } };
}

export function parseAiAnalysis(raw: string, facts: unknown, aliases: Aliases, lang: AnalysisLang): ConsumptionAnalysis | null {
  return parseAiAnalysisDetailed(raw, facts, aliases, lang).analysis;
}

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

const SCHEMA_HINT = `{"titre":"...","priorites":["F2","F1"],"analyses":[{"constats":["F1","F4"],"lecture":"...","hypotheses":["..."],"action":{"type":"COMMANDER|TRANSFERER|VERIFIER|SURVEILLER|REVOIR_RECETTE","produit":"P1","centre":"C1","versCentre":null,"libelle":"..."}}],"limites":["..."]}`;

async function askGemini(facts: unknown, lang: AnalysisLang, apiKey: string, fetchImpl: FetchLike): Promise<string | null> {
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const prompt = [
    "Tu es l'analyste de stock d'un groupe de salons de beauté en Tunisie. Tu t'adresses au propriétaire, ou à un gérant de plusieurs centres.",
    "À partir des CONSTATS déjà calculés ci-dessous (JSON), produis une analyse qui aide à décider.",
    "Ta valeur ajoutée : relier plusieurs constats entre eux (même produit dans plusieurs centres, même centre sur plusieurs produits), les hiérarchiser, avancer des HYPOTHÈSES plausibles et proposer UNE action concrète par analyse.",
    "Règles STRICTES :",
    "- N'écris AUCUN nombre qui ne figure pas dans les données. Ne calcule rien.",
    "- N'écris jamais les identifiants (F1, C1, P1…) dans les textes : écris les noms des produits et des centres. Dans les champs de référence (constats, produit, centre, versCentre), écris UNIQUEMENT l'identifiant court (F1, C1, P1…), jamais un nom.",
    "- Une hypothèse est une piste à vérifier, jamais un fait : formule-la avec prudence (« peut s'expliquer par », « à vérifier »). Si les données ne permettent pas d'avancer une hypothèse, n'en donne pas.",
    "- Chaque analyse cite les constats qu'elle explique (champ constats) ; son action doit être justifiée par ces constats.",
    "- Types d'action : COMMANDER (réapprovisionner un produit dans un centre), TRANSFERER (UNIQUEMENT pour un constat IMBALANCE : produit, centre qui envoie dans « centre » = autreCentre du constat, centre en tension dans « versCentre » = centre du constat), VERIFIER (contrôle sur place), SURVEILLER, REVOIR_RECETTE.",
    "- Pour un constat CENTER_OUTLIER dont normalizedBy vaut APPOINTMENTS, la comparaison est faite par rendez-vous : un centre plus actif n'est pas fautif pour autant.",
    "- LOSSES : les sorties manuelles ne sont pas forcément des pertes (atelier, démonstration, casse) ; reste prudent.",
    "- Si l'historique est court ou si une part de données de démonstration est signalée (qualite), dis-le dans « limites ».",
    `- Rédige tous les textes en ${lang === "ar" ? "arabe" : "français"}, en 2 phrases courtes au plus par champ.`,
    `Réponds UNIQUEMENT par un objet JSON de cette forme (priorites : de 1 à 5 constats, du plus important au moins important) : ${SCHEMA_HINT}`,
    `Données (JSON) : ${JSON.stringify(facts)}`,
  ].join("\n");
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 6144, temperature: 0.2, responseMimeType: "application/json" } }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = (await res.json()) as GeminiResponse;
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim() || null;
}

export async function analyzeReport(report: InsightsReport, lang: AnalysisLang, organizationId: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ConsumptionAnalysis> {
  // Rien à interpréter : la synthèse sans IA suffit et n'utilise pas le quota de Gemini.
  if (report.findings.length === 0) return basicAnalysis(report, lang);
  const { facts, aliases } = buildFacts(report, lang);
  const key = `${organizationId}:${lang}:${createHash("sha1").update(JSON.stringify(facts)).digest("hex")}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const text = await askGemini(facts, lang, apiKey, fetchImpl);
      const outcome = text ? parseAiAnalysisDetailed(text, facts, aliases, lang) : null;
      const analysis = outcome?.analysis ?? null;
      if (analysis) {
        if (cache.size >= CACHE_LIMIT) cache.clear();
        cache.set(key, analysis);
        return analysis;
      }
      // Ni le contenu de la réponse ni la clé ne sont journalisés : seulement le fait qu'elle a été refusée.
      console.error(text ? `Analyse de consommation : réponse de Gemini refusée (${outcome?.reason}), synthèse sans IA utilisée.` : "Analyse de consommation : réponse de Gemini vide, synthèse sans IA utilisée.");
    } catch (error) {
      // Jamais la clé ni le corps de la requête : seulement le type d'échec.
      console.error("Analyse de consommation : Gemini indisponible, synthèse sans IA utilisée.", error instanceof Error ? error.message : "erreur");
    }
  }
  return basicAnalysis(report, lang);
}

// Service appelé par l'action : droits et périmètre vérifiés par getConsumptionInsights ; les chiffres sont RECALCULÉS côté serveur.
export function analyzeStockConsumption(actor: StockActor, input: unknown, now: Date = new Date(), fetchImpl?: FetchLike): Promise<StockResult<ConsumptionAnalysis>> {
  return guard(async () => {
    const parsed = ConsumptionAnalysisSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const result = await getConsumptionInsights(actor, parsed.data.days, now);
    if (!result.ok) return result;
    return { ok: true, ...(await analyzeReport(result.report, parsed.data.lang, actor.organization!.id, fetchImpl)) };
  });
}
