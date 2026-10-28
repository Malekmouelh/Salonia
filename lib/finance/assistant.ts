// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/assistant.ts — L'ASSISTANT IA D'ANALYSE FINANCIÈRE
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Permet au propriétaire/gérant de poser une question en langage naturel
//   (« Quel centre est le plus rentable ? ») et d'obtenir une réponse chiffrée.
//
// DEUX MOTEURS (le second sert de « plan B »)
//   1. Moteur CLAUDE (aiReply)   : un modèle de langage (LLM) d'Anthropic. Utilisé si la clé
//      ANTHROPIC_API_KEY est présente dans le fichier .env.
//   2. Moteur MOTS-CLÉS (offlineReply) : sans IA, il repère des mots (« dépenses », « anomalie »…)
//      et appelle directement les bonnes fonctions. Il garantit que l'assistant marche toujours,
//      même sans clé, sans internet ou en cas de panne (cahier des charges §13 : « version de repli sans IA »).
//
// ★ POINT CLÉ À RETENIR POUR LA SOUTENANCE : « LLM sur requêtes contrôlées »
//   Le LLM n'a JAMAIS accès à la base de données et n'écrit AUCUNE requête. On lui donne une liste
//   restreinte d'OUTILS (get_summary, get_breakdown…) qu'il peut demander d'exécuter ; c'est NOTRE code
//   qui les exécute, avec NOS filtres (salon + centres autorisés) et en LECTURE SEULE.
//   → Impossible qu'il lise les données d'un autre salon ou modifie quoi que ce soit.
//   C'est le mécanisme du « tool use » (appel d'outils) : le modèle répond « j'ai besoin de get_summary
//   avec ces paramètres », on exécute, on lui renvoie le résultat, et il rédige la réponse finale.
//
//   Principes communs de l'IA du projet (cahier des charges §6) : « l'IA propose, l'utilisateur valide »
//   et « les données d'un salon ne servent jamais à répondre à un autre salon ».
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod"; // bibliothèque de validation des données (Zod)
import { addDays, dayKey, fromLocal, parseDayKey, startOfLocalDay, startOfLocalMonth, startOfLocalWeek, toLocal, WEEKDAYS } from "@/lib/booking/time";
import { METHOD_LABELS } from "./labels";
import { roundTnd } from "./money";
import {
  compareCenters,
  getAnomalies,
  getBreakdown,
  getClosingsInRange,
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

// Un message de la conversation (utilisateur ou assistant).
export type FinanceChatMessage = { role: "user" | "assistant"; text: string };
// La réponse renvoyée à l'interface : le texte, quel moteur l'a produite, et les « données consultées » affichées sous la réponse.
export type FinanceReply = { text: string; source: "ai" | "offline"; consulted: string[] };

// Petits utilitaires de texte.
// isArabic : le texte contient-il au moins un caractère arabe (plage Unicode U+0600 à U+06FF) ?
const isArabic = (s: string) => /[؀-ۿ]/.test(s);
// norm : « normalise » un texte pour la recherche de mots-clés. normalize("NFD") sépare les lettres
// de leurs accents (é → e + ´), le regex supprime ces accents (U+0300 à U+036F), puis on passe en minuscules.
// Ainsi « Dépenses », « depenses » et « DÉPENSES » donnent tous « depenses ».
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Montants arrondis au dinar au-delà de 100 DT : plus lisible dans une réponse d'analyse.
const fmt = (v: number) => `${roundTnd(v).toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })} DT`;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);

// Une période demandée.
type DateRange = { from: Date; to: Date; label: string };

// Convertit deux dates texte « YYYY-MM-DD » (fournies par le LLM) en période, après VALIDATION.
// On ne fait jamais confiance à ce que renvoie le modèle : on contrôle le format, l'ordre et la durée max.
function rangeFromKeys(from: string, to: string): DateRange {
  const f = parseDayKey(from);
  const t = parseDayKey(to);
  if (!f || !t || f > t) throw new Error("Dates invalides : format YYYY-MM-DD, from <= to.");
  if (t.getTime() - f.getTime() > 400 * 86_400_000) throw new Error("Période limitée à 400 jours.");
  // `to` devient le lendemain (borne exclue) pour inclure le dernier jour en entier.
  return { from: f, to: addDays(t, 1), label: `${from} → ${to}` };
}

// Restreint le périmètre à UN centre si le modèle en demande un.
// SÉCURITÉ : on cherche ce centre dans la liste des centres AUTORISÉS (scope.centers) ; si le modèle
// invente un identifiant ou en vise un auquel l'utilisateur n'a pas droit, on refuse.
function narrow(scope: Scope, centerId?: string | null): Scope {
  if (!centerId) return scope;
  const center = scope.centers.find((c) => c.id === centerId);
  if (!center) throw new Error("center_id inconnu ou non autorisé.");
  return { ...scope, centerIds: [center.id], centers: [center] };
}

// ───────────────────────── Outils (requêtes contrôlées) ─────────────────────────

// Schémas Zod : ils décrivent la forme EXACTE des paramètres acceptés pour chaque outil.
// Quand le modèle appelle un outil, on valide ses paramètres avec `.parse()` : s'ils sont faux,
// Zod lève une erreur au lieu de laisser passer des données inattendues.
const RangeInput = z.object({ from: z.string(), to: z.string(), center_id: z.string().optional() });
const BreakdownInput = RangeInput.extend({
  dimension: z.enum(["service", "center", "staff", "category", "method", "month"]),
  limit: z.number().int().min(1).max(20).optional(),
});
const CenterInput = z.object({ center_id: z.string().optional() });

// Morceaux de description réutilisés dans la définition des outils (`as const` = valeurs figées pour TypeScript).
const centerProp = { type: "string", description: "Identifiant d'un centre (facultatif : tous les centres autorisés par défaut)" } as const;
const dateProps = {
  from: { type: "string", description: "Premier jour inclus, YYYY-MM-DD (heure de Tunis)" },
  to: { type: "string", description: "Dernier jour inclus, YYYY-MM-DD" },
} as const;

// LISTE DES OUTILS donnée à Claude. Pour chacun : un nom, une description EN FRANÇAIS (c'est elle que le
// modèle lit pour décider quand l'utiliser) et un schéma JSON des paramètres (`input_schema`).
// `additionalProperties: false` interdit tout paramètre non prévu.
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
    name: "get_cash_closings",
    description:
      "Clôtures de caisse d'une période : pour chaque journée clôturée, les espèces attendues, les espèces comptées et l'écart de caisse (négatif = il manque de l'argent). Utile pour les questions sur les écarts, les manques ou la fiabilité de la caisse.",
    input_schema: { type: "object", properties: { ...dateProps }, required: ["from", "to"], additionalProperties: false },
  },
  {
    name: "get_forecast",
    description:
      "Prévision du chiffre d'affaires du mois en cours : réalisé à date, prévision des jours restants (moyenne par jour de la semaine sur 12 semaines + tendance), fourchette basse/haute (~80 %), erreur moyenne mesurée sur les 4 dernières semaines.",
    input_schema: { type: "object", properties: { center_id: centerProp }, additionalProperties: false },
  },
];

// Nom lisible de chaque outil, affiché sous la réponse (« Données consultées : … »).
const TOOL_LABELS: Record<string, string> = {
  get_summary: "Synthèse de la période",
  get_breakdown: "Ventilation",
  compare_centers: "Comparaison des centres",
  get_daily_revenue: "CA journalier",
  get_anomalies: "Détection d'anomalies",
  get_forecast: "Prévision du mois",
  get_cash_closings: "Clôtures de caisse",
};

// EXÉCUTEUR D'OUTILS : reçoit le nom de l'outil demandé par Claude et ses paramètres bruts (`raw`).
// Pour chaque outil : (1) on valide les paramètres avec Zod, (2) on restreint le périmètre si besoin,
// (3) on appelle la fonction de reports.ts. Le résultat est renvoyé à Claude sous forme de JSON.
async function runTool(scope: Scope, name: string, raw: unknown) {
  switch (name) {
    case "get_summary": {
      const i = RangeInput.parse(raw);
      const s = await getSummary(narrow(scope, i.center_id), rangeFromKeys(i.from, i.to));
      // On remplace la marge (0,62) par un pourcentage lisible (62) et les codes de moyens de paiement
      // par leurs libellés, pour que le modèle comprenne bien les données.
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
      // Limite de 92 jours : évite de renvoyer au modèle une réponse énorme (coût en « tokens »).
      if (range.to.getTime() - range.from.getTime() > 92 * 86_400_000) throw new Error("92 jours maximum.");
      const { total } = await getDailyRevenue(narrow(scope, i.center_id), range);
      return total.map((d) => ({ day: d.day, weekday: WEEKDAYS[d.weekday], revenue: d.value }));
    }
    case "get_anomalies": {
      const i = CenterInput.parse(raw ?? {});
      return getAnomalies(narrow(scope, i.center_id));
    }
    case "get_cash_closings": {
      const i = RangeInput.parse(raw);
      const range = rangeFromKeys(i.from, i.to);
      // rangeFromKeys renvoie une borne `to` exclue (lendemain) ; la clôture est indexée par jour : on reprend les clés d'origine.
      return getClosingsInRange(narrow(scope, i.center_id), i.from, i.to).then((rows) => ({ period: range.label, closings: rows }));
    }
    case "get_forecast": {
      const i = CenterInput.parse(raw ?? {});
      const f = await getForecast(narrow(scope, i.center_id));
      // `days: undefined` retire le détail jour par jour (inutile pour le modèle, il alourdirait la réponse).
      return { ...f, days: undefined, trend_percent: Math.round((f.trend - 1) * 1000) / 10, backtest_error_percent: f.backtestError == null ? null : Math.round(f.backtestError * 1000) / 10 };
    }
  }
  // Nom d'outil inconnu (ne devrait pas arriver : on ne propose que ceux de TOOLS).
  throw new Error("Outil inconnu.");
}

// ───────────────────────── Moteur Claude ─────────────────────────

// BOUCLE D'AGENT (« tool use loop ») :
//   1. On envoie à Claude la conversation + la liste des outils.
//   2. Si Claude répond « j'utilise l'outil X » (stop_reason = "tool_use"), on exécute X et on lui
//      renvoie le résultat, puis on recommence à l'étape 1.
//   3. Quand Claude répond par du texte (sans demander d'outil), c'est la réponse finale.
async function aiReply(scope: Scope, orgName: string, messages: FinanceChatMessage[]): Promise<FinanceReply> {
  // Le client lit automatiquement la clé API dans la variable d'environnement ANTHROPIC_API_KEY.
  const client = new Anthropic();
  const today = startOfLocalDay(new Date());
  // LE « PROMPT SYSTÈME » : les instructions permanentes données au modèle (son rôle, ses règles).
  // On lui donne aussi la date du jour (il ne la connaît pas) et la liste de CENTRES AUTORISÉS avec leurs
  // identifiants, pour qu'il puisse passer le bon `center_id` aux outils.
  // (Attention : ce texte est envoyé tel quel au modèle ; ne pas y insérer de commentaire de code.)
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

  // Historique au format attendu par l'API (rôle + contenu).
  const history: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({ role: m.role, content: m.text }));
  // Ensemble (sans doublon) des outils utilisés, pour l'affichage « Données consultées ».
  const consulted = new Set<string>();

  // Maximum 8 tours d'aller-retour : garde-fou contre une boucle infinie (et contre les coûts).
  for (let turn = 0; turn < 8; turn++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5", // le modèle utilisé
      max_tokens: 16000, // longueur maximale de la réponse
      system,
      tools: TOOLS,
      messages: history,
      output_config: { effort: "medium" }, // niveau de « réflexion » : compromis qualité/coût/vitesse
      // Si un filtre de sécurité refuse la requête, l'API la rejoue sur un modèle de repli.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    // Refus de sécurité : on sort de la boucle (l'appelant utilisera le moteur de repli).
    if (response.stop_reason === "refusal") break;

    // Parmi les blocs de la réponse, on isole ceux où Claude demande l'exécution d'un outil.
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    // Pas d'outil demandé = réponse finale : on assemble les blocs de texte.
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { source: "ai", text, consulted: [...consulted] };
    }

    // On ajoute la réponse de Claude (avec ses demandes d'outils) à l'historique…
    history.push({ role: "assistant", content: response.content });
    // Outils exécutés en parallèle, résultats renvoyés ensemble dans un seul message.
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        consulted.add(TOOL_LABELS[use.name] ?? use.name);
        try {
          // On exécute l'outil et on renvoie le résultat sérialisé en JSON, lié à la demande par son identifiant.
          return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(await runTool(scope, use.name, use.input)) };
        } catch (e) {
          // En cas d'erreur (paramètres invalides, période trop longue…), on le dit à Claude (`is_error`)
          // pour qu'il corrige son appel ou explique le problème, au lieu de faire planter la conversation.
          const message = e instanceof z.ZodError ? "Paramètres invalides." : e instanceof Error ? e.message : "Erreur";
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: message };
        }
      }),
    );
    // …puis les résultats des outils, et la boucle recommence : Claude va rédiger sa réponse avec ces données.
    history.push({ role: "user", content: results });
  }
  // Sortie de boucle sans réponse (refus ou 8 tours dépassés) : texte vide → l'appelant bascule sur le moteur hors ligne.
  return { source: "ai", text: "", consulted: [...consulted] };
}

// ───────────────────────── Moteur par mots-clés (sans IA) ─────────────────────────

// Reconnaissance des noms de mois en français et en arabe (tunisien et standard) → numéro du mois.
// Chaque entrée = [expression régulière, numéro]. Le « | » signifie « ou ».
const MONTHS: [RegExp, number][] = [
  [/janvier|جانفي|يناير/, 1], [/fevrier|فيفري|فبراير/, 2], [/mars|مارس/, 3], [/avril|أفريل|افريل|أبريل/, 4],
  [/\bmai\b|ماي|مايو/, 5], [/juin|جوان|يونيو/, 6], [/juillet|جويلية|يوليو/, 7], [/aout|أوت|اوت|أغسطس/, 8],
  [/septembre|سبتمبر/, 9], [/octobre|أكتوبر|اكتوبر/, 10], [/novembre|نوفمبر/, 11], [/decembre|ديسمبر/, 12],
];

// Devine la période demandée dans la question (« ce mois-ci », « hier », « en septembre »…).
// Les tests se font du plus précis au plus général ; à défaut, on prend « ce mois-ci ».
export function parsePeriod(text: string, now = new Date()): DateRange & { ar: string } {
  const t = norm(text);
  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  const p = toLocal(now);
  if (/aujourd|اليوم|ليوم/.test(t)) return { from: today, to: tomorrow, label: "aujourd'hui", ar: "اليوم" };
  // \b = limite de mot : « hier » mais pas « premier ».
  if (/\bhier\b|امس|البارح/.test(t)) return { from: addDays(today, -1), to: today, label: "hier", ar: "أمس" };
  // « semaine dernière » est testé AVANT « semaine » (sinon le cas général l'emporterait toujours).
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
  // Nom de mois : si le mois cité est postérieur au mois courant, c'est celui de l'année précédente.
  for (const [re, month] of MONTHS) {
    if (re.test(t)) {
      const year = month > p.month ? p.year - 1 : p.year;
      const start = fromLocal(year, month, 1);
      const end = fromLocal(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
      return { from: start, to: end < tomorrow ? end : tomorrow, label: `${["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][month - 1]} ${year}`, ar: `${month}/${year}` };
    }
  }
  // Rien reconnu : par défaut, le mois en cours.
  return { from: startOfLocalMonth(now), to: tomorrow, label: "ce mois-ci", ar: "هذا الشهر" };
}

// Devine le centre cité dans la question (« à Sousse », « Djerba »…) parmi les centres autorisés.
function findCenter(scope: Scope, text: string) {
  const t = norm(text);
  return scope.centers.find((c) => {
    // Mots significatifs du nom du centre (> 3 lettres, hors mots génériques) comparés au texte de la question.
    const words = norm(c.name).split(/[\s—–-]+/).filter((w) => w.length > 3 && !["yasmine", "salon", "centre"].includes(w));
    // + raccourcis pour les trois villes de la démo, y compris en écriture arabe.
    return words.some((w) => t.includes(w)) || (/djerba|جربة/.test(t) && /djerba/i.test(c.name)) || (/sousse|سوسة/.test(t) && /sousse/i.test(c.name)) || (/tunis|تونس/.test(t) && /tunis/i.test(c.name));
  });
}

// MOTEUR HORS LIGNE : on regarde la dernière question de l'utilisateur et on cherche des mots-clés.
// Chaque bloc `if` correspond à un type de question ; le premier qui reconnaît un mot-clé répond.
// Les réponses sont fabriquées avec les MÊMES fonctions que les outils de Claude (getSummary, etc.) :
// seul le « langage » change, pas les chiffres.
async function offlineReply(scope: Scope, messages: FinanceChatMessage[]): Promise<FinanceReply> {
  // Dernière question posée par l'utilisateur.
  const last = messages.filter((m) => m.role === "user").at(-1)?.text ?? "";
  const ar = isArabic(last); // on répond dans la langue de la question
  // L(français, arabe) : choisit le texte selon la langue détectée.
  const L = (fr: string, arabic: string) => (ar ? arabic : fr);
  const t = norm(last);
  const center = findCenter(scope, last); // centre cité ? (sinon : tous les centres)
  const s = center ? narrow(scope, center.id) : scope; // périmètre de la réponse
  const where = center ? center.name : L("tous vos centres", "كل الفروع");
  const period = parsePeriod(last);
  const when = ar ? period.ar : period.label;

  // 1) Questions de PRÉVISION.
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
  // 2) Questions sur les ANOMALIES / problèmes.
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
  // 3) Questions sur les DÉPENSES.
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
  // 4) Questions sur les SERVICES les plus vendus.
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
  // 5) Questions sur les PRATICIENS / l'équipe.
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
  // 6) Questions de COMPARAISON entre centres (seulement s'il y a plusieurs centres et qu'aucun n'est ciblé).
  if (/centre|compar|meilleur|classement|فرع|فروع|قارن|مقارنة/.test(t) && scope.centers.length > 1 && !center) {
    // « rentable », « bénéfice », « marge »… → on classe par RÉSULTAT ; sinon par chiffre d'affaires.
    const byProfit = /rentab|benefice|profit|resultat|marge|ربح|مربح|أرباح/.test(t);
    const rows = (await compareCenters(scope, period)).sort((a, b) => (byProfit ? b.profit - a.profit : b.revenue - a.revenue));
    const top = rows[0]; // le meilleur centre selon le critère
    const lead = byProfit
      ? L(`${top.name} est le centre le plus rentable ${when} : résultat ${fmt(top.profit)} (marge ${pct(top.margin)}).\n`, `${top.name} هو الفرع الأكثر ربحًا ${when}: ${fmt(top.profit)}.\n`)
      : L(`${top.name} réalise le plus gros chiffre d'affaires ${when} : ${fmt(top.revenue)}.\n`, `${top.name} يحقق أعلى مداخيل ${when}: ${fmt(top.revenue)}.\n`);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.compare_centers],
      text: lead + rows.map((r) => `- ${r.name} : CA ${fmt(r.revenue)}, ${L("résultat", "النتيجة")} ${fmt(r.profit)}, ${L("panier moyen", "متوسط السلة")} ${fmt(r.averageBasket)}`).join("\n"),
    };
  }
  // 7) Questions sur les MOYENS DE PAIEMENT.
  // 6 bis) Questions sur les CLÔTURES et ÉCARTS de caisse.
  if (/ecart|cloture|manque|tiroir|إقفال|فارق|عجز/.test(t)) {
    const from = dayKey(addDays(startOfLocalDay(new Date()), -29));
    const rows = await getClosingsInRange(s, from, dayKey(startOfLocalDay(new Date())));
    const gaps = rows.filter((r) => r.varianceTnd !== 0);
    return {
      source: "offline",
      consulted: [TOOL_LABELS.get_cash_closings],
      text: rows.length
        ? L(
            `${rows.length} clôture(s) sur 30 jours (${where}), dont ${gaps.length} avec un écart :\n`,
            `${rows.length} إقفال خلال 30 يومًا (${where})، منها ${gaps.length} بفارق:\n`,
          ) + (gaps.length ? gaps.slice(0, 6).map((r) => `- ${r.day} · ${r.center} : ${r.varianceTnd > 0 ? "+" : ""}${fmt(r.varianceTnd)}`).join("\n") : L("Aucun écart : caisses justes.", "لا فوارق: الصناديق مضبوطة."))
        : L("Aucune clôture de caisse enregistrée sur les 30 derniers jours.", "لا توجد عمليات إقفال خلال آخر 30 يومًا."),
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

// POINT D'ENTRÉE appelé par la Server Action askFinanceAssistantAction (app/actions/finance.ts).
// Stratégie « essayer l'IA, sinon plan B » :
//   - si une clé API existe, on tente Claude ; en cas de succès avec du texte → on renvoie sa réponse ;
//   - en cas d'erreur (clé invalide, quota dépassé, panne réseau) ou de réponse vide → moteur hors ligne.
//   L'utilisateur obtient donc TOUJOURS une réponse. Les détails des erreurs vont dans la console du
//   serveur (jamais à l'utilisateur).
export async function financeAssistantReply(scope: Scope, orgName: string, messages: FinanceChatMessage[]): Promise<FinanceReply> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const reply = await aiReply(scope, orgName, messages);
      if (reply.text) return reply;
    } catch (error) {
      // Classes d'erreurs du SDK Anthropic, de la plus précise à la plus générale.
      if (error instanceof Anthropic.AuthenticationError) console.error("Assistant financier : clé d'API invalide.");
      else if (error instanceof Anthropic.RateLimitError) console.error("Assistant financier : limite de l'API atteinte.");
      else if (error instanceof Anthropic.APIError) console.error(`Assistant financier : erreur API ${error.status}`, error.message);
      else console.error("Assistant financier indisponible :", error);
    }
  }
  return offlineReply(scope, messages);
}
