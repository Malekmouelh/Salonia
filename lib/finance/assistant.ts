import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addDays, dayKey, fromLocal, parseDayKey, startOfLocalDay, startOfLocalMonth, startOfLocalWeek, toLocal, WEEKDAYS } from "@/lib/booking/time";
import { METHOD_LABELS } from "./labels";
import { roundTnd } from "./money";
import {
  compareCenters,
  getAnomalies,
  getBreakdown,
  getDailyRevenue,
  getForecast,
  getSummary,
  type BreakdownDimension,
  type Scope,
} from "./reports";

// IA Module 6 — Assistant d'analyse financière (cahier des charges §6).
// « Modèle de langage sur requêtes contrôlées » : Claude ne voit jamais la base de données ; il appelle
// des outils en lecture seule (synthèse, ventilation, CA journalier, anomalies, prévision), toujours limités
// à l'organisation et aux centres de l'utilisateur. Sans clé API : moteur par mots-clés (FR/AR).

export type FinanceChatMessage = { role: "user" | "assistant"; text: string };
export type FinanceReply = { text: string; source: "ai" | "offline"; consulted: string[] };

const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Montants arrondis au dinar au-delà de 100 DT : plus lisible dans une réponse d'analyse.
const fmt = (v: number) => `${roundTnd(v).toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })} DT`;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);

type DateRange = { from: Date; to: Date; label: string };

function rangeFromKeys(from: string, to: string): DateRange {
  const f = parseDayKey(from);
  const t = parseDayKey(to);
  if (!f || !t || f > t) throw new Error("Dates invalides : format YYYY-MM-DD, from <= to.");
  if (t.getTime() - f.getTime() > 400 * 86_400_000) throw new Error("Période limitée à 400 jours.");
  return { from: f, to: addDays(t, 1), label: `${from} → ${to}` };
}

function narrow(scope: Scope, centerId?: string | null): Scope {
  if (!centerId) return scope;
  const center = scope.centers.find((c) => c.id === centerId);
  if (!center) throw new Error("center_id inconnu ou non autorisé.");
  return { ...scope, centerIds: [center.id], centers: [center] };
}

// ───────────────────────── Outils (requêtes contrôlées) ─────────────────────────

const RangeInput = z.object({ from: z.string(), to: z.string(), center_id: z.string().optional() });
const BreakdownInput = RangeInput.extend({
  dimension: z.enum(["service", "center", "staff", "category", "method", "month"]),
  limit: z.number().int().min(1).max(20).optional(),
});
const CenterInput = z.object({ center_id: z.string().optional() });

const centerProp = { type: "string", description: "Identifiant d'un centre (facultatif : tous les centres autorisés par défaut)" } as const;
const dateProps = {
  from: { type: "string", description: "Premier jour inclus, YYYY-MM-DD (heure de Tunis)" },
  to: { type: "string", description: "Dernier jour inclus, YYYY-MM-DD" },
} as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_summary",
    description:
      "Indicateurs d'une période : chiffre d'affaires encaissé (paiements + acomptes − remboursements), dépenses, résultat, marge, nombre de ventes facturées, panier moyen, remises, répartition par moyen de paiement.",
    input_schema: { type: "object", properties: { ...dateProps, center_id: centerProp }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "get_breakdown",
    description:
      "Ventilation d'une période selon un axe : service (prestations les plus vendues, d'après les factures), center (CA par centre), staff (CA par praticien), category (dépenses par catégorie), method (moyens de paiement), month (CA par mois).",
    input_schema: {
      type: "object",
      properties: {
        ...dateProps,
        dimension: { type: "string", enum: ["service", "center", "staff", "category", "method", "month"] },
        center_id: centerProp,
        limit: { type: "integer", description: "Nombre de lignes (1 à 20, 10 par défaut)" },
      },
      required: ["from", "to", "dimension"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_centers",
    description: "Comparaison des centres sur une période : CA, dépenses, résultat, marge, ventes, panier moyen.",
    input_schema: { type: "object", properties: { ...dateProps }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "get_daily_revenue",
    description: "Chiffre d'affaires encaissé jour par jour (92 jours maximum), pour repérer une tendance ou un jour précis.",
    input_schema: { type: "object", properties: { ...dateProps, center_id: centerProp }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "get_anomalies",
    description:
      "Alertes détectées automatiquement : jours de CA anormalement bas ou haut (comparés aux mêmes jours des 8 semaines précédentes), dépenses en forte hausse, dépense isolée inhabituelle, remboursements ou remises excessifs, centre déficitaire.",
    input_schema: { type: "object", properties: { center_id: centerProp }, additionalProperties: false },
  },
  {
    name: "get_forecast",
    description:
      "Prévision du chiffre d'affaires du mois en cours : réalisé à date, prévision des jours restants (moyenne par jour de la semaine sur 12 semaines + tendance), fourchette basse/haute (~80 %), erreur moyenne mesurée sur les 4 dernières semaines.",
    input_schema: { type: "object", properties: { center_id: centerProp }, additionalProperties: false },
  },
];

const TOOL_LABELS: Record<string, string> = {
  get_summary: "Synthèse de la période",
  get_breakdown: "Ventilation",
  compare_centers: "Comparaison des centres",
  get_daily_revenue: "CA journalier",
  get_anomalies: "Détection d'anomalies",
  get_forecast: "Prévision du mois",
};

async function runTool(scope: Scope, name: string, raw: unknown) {
  switch (name) {
    case "get_summary": {
      const i = RangeInput.parse(raw);
      const s = await getSummary(narrow(scope, i.center_id), rangeFromKeys(i.from, i.to));
      return { ...s, margin: s.margin == null ? null : Math.round(s.margin * 1000) / 10, byMethod: s.byMethod.map((m) => ({ method: METHOD_LABELS[m.method], amount: m.amount })) };
    }
    case "get_breakdown": {
      const i = BreakdownInput.parse(raw);
      return getBreakdown(narrow(scope, i.center_id), rangeFromKeys(i.from, i.to), i.dimension as BreakdownDimension, i.limit ?? 10);
    }
    case "compare_centers": {
      const i = RangeInput.parse(raw);
      return compareCenters(scope, rangeFromKeys(i.from, i.to));
    }
    case "get_daily_revenue": {
      const i = RangeInput.parse(raw);
      const range = rangeFromKeys(i.from, i.to);
      if (range.to.getTime() - range.from.getTime() > 92 * 86_400_000) throw new Error("92 jours maximum.");
      const { total } = await getDailyRevenue(narrow(scope, i.center_id), range);
      return total.map((d) => ({ day: d.day, weekday: WEEKDAYS[d.weekday], revenue: d.value }));
    }
    case "get_anomalies": {
      const i = CenterInput.parse(raw ?? {});
      return getAnomalies(narrow(scope, i.center_id));
    }
    case "get_forecast": {
      const i = CenterInput.parse(raw ?? {});
      const f = await getForecast(narrow(scope, i.center_id));
      return { ...f, days: undefined, trend_percent: Math.round((f.trend - 1) * 1000) / 10, backtest_error_percent: f.backtestError == null ? null : Math.round(f.backtestError * 1000) / 10 };
    }
  }
  throw new Error("Outil inconnu.");
}

// ───────────────────────── Moteur Claude ─────────────────────────

async function aiReply(scope: Scope, orgName: string, messages: FinanceChatMessage[]): Promise<FinanceReply> {
  const client = new Anthropic();
  const today = startOfLocalDay(new Date());
  const system = `Tu es l'analyste financier du salon « ${orgName} » (Tunisie). Tu réponds aux questions du propriétaire ou du gérant sur ses chiffres.
Règles :
- Appuie chaque chiffre sur un outil ; n'invente jamais de montant. Si une donnée n'existe pas (ex. salaires par employé), dis-le.
- Réponds dans la langue de la question (français, arabe ou derja), en 2 à 6 phrases ou une courte liste « - ». Pas de tableau.
- Précise toujours la période et le périmètre (centre ou vue consolidée) utilisés.
- Montants en dinars tunisiens (DT). Compare à la période précédente quand c'est utile.
- Termine, si c'est pertinent, par une recommandation concrète et prudente. Tu proposes, le gérant décide : tu ne modifies aucune donnée.
- Le chiffre d'affaires est l'argent encaissé (paiements et acomptes, moins remboursements) ; les ventes et le panier moyen viennent des factures.
Contexte :
- Aujourd'hui : ${dayKey(today)} (${WEEKDAYS[toLocal(today).weekday]}). Semaine : du lundi au dimanche.
- Centres accessibles (center_id) : ${JSON.stringify(scope.centers)}`;

  const history: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({ role: m.role, content: m.text }));
  const consulted = new Set<string>();

  for (let turn = 0; turn < 8; turn++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages: history,
      output_config: { effort: "medium" },
      // Si un filtre de sécurité refuse la requête, l'API la rejoue sur un modèle de repli.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") break;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { source: "ai", text, consulted: [...consulted] };
    }

    history.push({ role: "assistant", content: response.content });
    // Outils exécutés en parallèle, résultats renvoyés ensemble dans un seul message.
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        consulted.add(TOOL_LABELS[use.name] ?? use.name);
        try {
          return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(await runTool(scope, use.name, use.input)) };
        } catch (e) {
          const message = e instanceof z.ZodError ? "Paramètres invalides." : e instanceof Error ? e.message : "Erreur";
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: message };
        }
      }),
    );
    history.push({ role: "user", content: results });
  }
  return { source: "ai", text: "", consulted: [...consulted] };
}

// ───────────────────────── Moteur par mots-clés (sans IA) ─────────────────────────

const MONTHS: [RegExp, number][] = [
  [/janvier|جانفي|يناير/, 1], [/fevrier|فيفري|فبراير/, 2], [/mars|مارس/, 3], [/avril|أفريل|افريل|أبريل/, 4],
  [/\bmai\b|ماي|مايو/, 5], [/juin|جوان|يونيو/, 6], [/juillet|جويلية|يوليو/, 7], [/aout|أوت|اوت|أغسطس/, 8],
  [/septembre|سبتمبر/, 9], [/octobre|أكتوبر|اكتوبر/, 10], [/novembre|نوفمبر/, 11], [/decembre|ديسمبر/, 12],
];

export function parsePeriod(text: string, now = new Date()): DateRange & { ar: string } {
  const t = norm(text);
  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  const p = toLocal(now);
  if (/aujourd|اليوم|ليوم/.test(t)) return { from: today, to: tomorrow, label: "aujourd'hui", ar: "اليوم" };
  if (/\bhier\b|امس|البارح/.test(t)) return { from: addDays(today, -1), to: today, label: "hier", ar: "أمس" };
  if (/semaine derniere|الاسبوع الماضي|الأسبوع الماضي/.test(t)) {
    const start = addDays(startOfLocalWeek(now), -7);
    return { from: start, to: addDays(start, 7), label: "la semaine dernière", ar: "الأسبوع الماضي" };
  }
  if (/semaine|اسبوع|أسبوع/.test(t)) return { from: startOfLocalWeek(now), to: tomorrow, label: "cette semaine", ar: "هذا الأسبوع" };
  if (/mois dernier|mois precedent|الشهر الماضي|الشهر اللي فات/.test(t)) {
    const start = fromLocal(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 1);
    return { from: start, to: startOfLocalMonth(now), label: "le mois dernier", ar: "الشهر الماضي" };
  }
  if (/annee|cette annee|\ban\b|السنة|العام/.test(t)) return { from: fromLocal(p.year, 1, 1), to: tomorrow, label: "cette année", ar: "هذه السنة" };
  const trimestre = /trimestre|3 mois|90 jours|ثلاث اشهر|ثلاثة أشهر/.test(t);
  if (trimestre) return { from: addDays(tomorrow, -90), to: tomorrow, label: "les 90 derniers jours", ar: "آخر 90 يومًا" };
  for (const [re, month] of MONTHS) {
    if (re.test(t)) {
      const year = month > p.month ? p.year - 1 : p.year;
      const start = fromLocal(year, month, 1);
      const end = fromLocal(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
      return { from: start, to: end < tomorrow ? end : tomorrow, label: `${["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][month - 1]} ${year}`, ar: `${month}/${year}` };
    }
  }
  return { from: startOfLocalMonth(now), to: tomorrow, label: "ce mois-ci", ar: "هذا الشهر" };
}

function findCenter(scope: Scope, text: string) {
  const t = norm(text);
  return scope.centers.find((c) => {
    const words = norm(c.name).split(/[\s—–-]+/).filter((w) => w.length > 3 && !["yasmine", "salon", "centre"].includes(w));
    return words.some((w) => t.includes(w)) || (/djerba|جربة/.test(t) && /djerba/i.test(c.name)) || (/sousse|سوسة/.test(t) && /sousse/i.test(c.name)) || (/tunis|تونس/.test(t) && /tunis/i.test(c.name));
  });
}

async function offlineReply(scope: Scope, messages: FinanceChatMessage[]): Promise<FinanceReply> {
  const last = messages.filter((m) => m.role === "user").at(-1)?.text ?? "";
  const ar = isArabic(last);
  const L = (fr: string, arabic: string) => (ar ? arabic : fr);
  const t = norm(last);
  const center = findCenter(scope, last);
  const s = center ? narrow(scope, center.id) : scope;
  const where = center ? center.name : L("tous vos centres", "كل الفروع");
  const period = parsePeriod(last);
  const when = ar ? period.ar : period.label;

  if (/prevision|prevoir|prevu|fin du mois|projection|توقع|تنبؤ|آخر الشهر|اخر الشهر/.test(t)) {
    const f = await getForecast(s);
    const quality = f.backtestError == null ? "" : L(` Erreur moyenne du modèle sur les 4 dernières semaines : ${Math.round(f.backtestError * 100)} %.`, ` متوسط خطأ النموذج في آخر 4 أسابيع: ${Math.round(f.backtestError * 100)}٪.`);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_forecast],
      text: L(
        `Prévision pour ce mois (${where}) : environ ${fmt(f.forecastTotal)}, entre ${fmt(f.low)} et ${fmt(f.high)}. Déjà encaissé : ${fmt(f.actualToDate)} ; attendu sur les jours restants : ${fmt(f.forecastRemaining)}. Tendance récente : ${f.trend >= 1 ? "+" : ""}${Math.round((f.trend - 1) * 100)} %.${quality}`,
        `التوقع لهذا الشهر (${where}): حوالي ${fmt(f.forecastTotal)}، بين ${fmt(f.low)} و${fmt(f.high)}. المحصّل حتى الآن: ${fmt(f.actualToDate)}.${quality}`,
      ),
    };
  }
  if (/anomal|alerte|probleme|inhabituel|bizarre|suspect|شذوذ|غريب|مشكل|تنبيه/.test(t)) {
    const list = await getAnomalies(s);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_anomalies],
      text: list.length
        ? L(`${list.length} point(s) d'attention :\n`, `${list.length} تنبيه:\n`) + list.slice(0, 5).map((a) => `- ${a.title} : ${a.detail}`).join("\n")
        : L("Aucune anomalie détectée sur les dernières semaines.", "لا توجد أي حالة غير عادية في الأسابيع الأخيرة."),
    };
  }
  if (/depense|charge|cout|loyer|مصاريف|مصروف|تكاليف|كراء/.test(t)) {
    const [summary, rows] = await Promise.all([getSummary(s, period), getBreakdown(s, period, "category", 5)]);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_summary, TOOL_LABELS.get_breakdown],
      text:
        L(`Dépenses ${when} (${where}) : ${fmt(summary.expenses)}.`, `المصاريف ${when} (${where}): ${fmt(summary.expenses)}.`) +
        (rows.length ? "\n" + rows.map((r) => `- ${L(r.label, r.label)} : ${fmt(r.amount)}`).join("\n") : ""),
    };
  }
  if (/service|prestation|demande|vendu|populaire|خدمة|خدمات|الأكثر/.test(t)) {
    const rows = await getBreakdown(s, period, "service", 5);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_breakdown],
      text: rows.length
        ? L(`Prestations les plus vendues ${when} (${where}) :\n`, `الخدمات الأكثر مبيعًا ${when}:\n`) + rows.map((r, i) => `${i + 1}. ${r.label} — ${r.count} · ${fmt(r.amount)}`).join("\n")
        : L(`Aucune vente facturée ${when}.`, `لا توجد مبيعات ${when}.`),
    };
  }
  if (/praticien|employe|staff|coiffeu|estheticien|equipe|موظف|الفريق|حلاق/.test(t)) {
    const rows = await getBreakdown(s, period, "staff", 6);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_breakdown],
      text: rows.length
        ? L(`Chiffre d'affaires par praticien ${when} :\n`, `المداخيل حسب الموظف ${when}:\n`) + rows.map((r) => `- ${r.label} : ${fmt(r.amount)} (${r.count} RDV)`).join("\n")
        : L(`Aucun encaissement lié à un rendez-vous ${when}.`, `لا توجد مداخيل ${when}.`),
    };
  }
  if (/centre|compar|meilleur|classement|فرع|فروع|قارن|مقارنة/.test(t) && scope.centers.length > 1 && !center) {
    const byProfit = /rentab|benefice|profit|resultat|marge|ربح|مربح|أرباح/.test(t);
    const rows = (await compareCenters(scope, period)).sort((a, b) => (byProfit ? b.profit - a.profit : b.revenue - a.revenue));
    const top = rows[0];
    const lead = byProfit
      ? L(`${top.name} est le centre le plus rentable ${when} : résultat ${fmt(top.profit)} (marge ${pct(top.margin)}).\n`, `${top.name} هو الفرع الأكثر ربحًا ${when}: ${fmt(top.profit)}.\n`)
      : L(`${top.name} réalise le plus gros chiffre d'affaires ${when} : ${fmt(top.revenue)}.\n`, `${top.name} يحقق أعلى مداخيل ${when}: ${fmt(top.revenue)}.\n`);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.compare_centers],
      text: lead + rows.map((r) => `- ${r.name} : CA ${fmt(r.revenue)}, ${L("résultat", "النتيجة")} ${fmt(r.profit)}, ${L("panier moyen", "متوسط السلة")} ${fmt(r.averageBasket)}`).join("\n"),
    };
  }
  if (/moyen de paiement|especes|carte|mobile|cash|نقدا|بطاقة|كاش/.test(t)) {
    const summary = await getSummary(s, period);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_summary],
      text: L(`Encaissements par moyen de paiement ${when} :\n`, `المداخيل حسب طريقة الدفع ${when}:\n`) + summary.byMethod.map((m) => `- ${METHOD_LABELS[m.method]} : ${fmt(m.amount)}`).join("\n"),
    };
  }

  // Par défaut : synthèse de la période.
  const summary = await getSummary(s, period);
  return {
    source: "offline",
    consulted: [TOOL_LABELS.get_summary],
    text: L(
      `${when[0].toUpperCase()}${when.slice(1)} (${where}) : ${fmt(summary.revenue)} encaissés, ${fmt(summary.expenses)} de dépenses, résultat ${fmt(summary.profit)} (marge ${pct(summary.margin)}). ${summary.sales} ventes facturées, panier moyen ${fmt(summary.averageBasket)}.`,
      `${when} (${where}): المداخيل ${fmt(summary.revenue)}، المصاريف ${fmt(summary.expenses)}، النتيجة ${fmt(summary.profit)}. ${summary.sales} عملية بيع، متوسط السلة ${fmt(summary.averageBasket)}.`,
    ),
  };
}

export async function financeAssistantReply(scope: Scope, orgName: string, messages: FinanceChatMessage[]): Promise<FinanceReply> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const reply = await aiReply(scope, orgName, messages);
      if (reply.text) return reply;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) console.error("Assistant financier : clé d'API invalide.");
      else if (error instanceof Anthropic.RateLimitError) console.error("Assistant financier : limite de l'API atteinte.");
      else if (error instanceof Anthropic.APIError) console.error(`Assistant financier : erreur API ${error.status}`, error.message);
      else console.error("Assistant financier indisponible :", error);
    }
  }
  return offlineReply(scope, messages);
}

