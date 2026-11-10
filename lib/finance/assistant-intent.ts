// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/assistant-intent.ts — INTENTION ET DATES DE L'ASSISTANT FINANCIER
// ═══════════════════════════════════════════════════════════════════════════
// Fonctions PURES (sans base de données ni IA), testées dans assistant-intent.test.ts :
//   • classifyIntent : salutation, remerciement, question financière ou hors sujet ;
//   • parseFutureMonth : mois futur demandé (« le mois prochain », « en mars », « dans 3 mois »).
// ═══════════════════════════════════════════════════════════════════════════
import { toLocal } from "@/lib/booking/time";

// isArabic : le texte contient-il au moins un caractère arabe (plage Unicode U+0600 à U+06FF) ?
export const isArabic = (s: string) => /[؀-ۿ]/.test(s);
// norm : enlève les accents et passe en minuscules (« Dépenses » → « depenses »).
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ───────────────────────── Intention et périmètre ─────────────────────────
// L'assistant ne traite QUE trois intentions : salutations, remerciements, et questions sur les
// données financières du salon. Tout le reste reçoit un refus poli et toujours identique.
export const REFUSAL = {
  fr: "Je ne peux pas répondre à cette question, car je suis un agent spécialisé dans la gestion financière des salons de beauté. Posez-moi plutôt une question sur les chiffres de votre salon : chiffre d'affaires, dépenses, rentabilité, prévisions…",
  ar: "لا يمكنني الإجابة عن هذا السؤال لأنني وكيل متخصص في التسيير المالي لصالونات التجميل. اسألني عن أرقام صالونك: المداخيل، المصاريف، الربحية، التوقعات…",
};

export type FinanceIntent = "greeting" | "thanks" | "finance" | "offtopic";

// Mots qui signalent une question financière (français, arabe, derja en lettres latines).
const FINANCE_WORDS =
  /chiffre|affaire|\bca\b(?! va)|revenu|recettes|encaiss|depens|charge|cout|loyer|benefic|profit|marge|resultat|rentab|perte|deficit|previs|prevoi|prevu|predi|projection|estim|futur|prochain|caisse|cloture|ecart|paiement|facture|vente|vendu|panier|remise|rembours|anomal|alerte|centre|service|prestation|praticien|employe|staff|equipe|tresorerie|argent|dinar|\bdt\b|\btnd\b|combien|evolution|tendance|croissance|baisse|hausse|bilan|statisti|performance|salon|activite|business|\bmois\b|semaine|annee|trimestre|aujourd|\bhier\b|janvier|fevrier|\bmars\b|avril|\bmai\b|juin|juillet|\baout\b|septembre|octobre|novembre|decembre|ch7al|chhal|9adeh|flous|mdakhil|masarif|ربح|مداخيل|مدخول|مصاريف|مصروف|تكاليف|توقع|تنبؤ|فلوس|دينار|مبيعات|خدمات|خدمة|فرع|فروع|صندوق|الشهر|شهر|الأسبوع|السنة|(^|\s)كم(\s|$)|قداش|الدخل|خسارة|موظف|صالون/;
const GREETING_WORDS =
  /^(bonjour|bonsoir|salut|coucou|hello|hi|hey|bjr|slt|salam|salem|aslema|asslema|ahla|ahlan|marhba|labes|cv|ca va|السلام عليكم|سلام|مرحبا|اهلا|أهلا|عسلامة|صباح الخير|مساء الخير|لاباس)(\s|$)/;
const THANKS_WORDS = /\b(merci|mrc|thanks|thank you|thx|parfait|super|genial|top|nickel|yaatik saha|ya3tik sa7a|barak allah)\b|شكرا|شكراً|يعطيك الصحة|بارك الله|ممتاز|برافو/;

// Classe un message selon son intention (règles simples, sans IA : instantané et prévisible).
export function classifyIntent(text: string): FinanceIntent {
  const t = norm(text).replace(/[!?.,;:()«»"'’]/g, " ").replace(/\s+/g, " ").trim();
  if (FINANCE_WORDS.test(t)) return "finance";
  const words = t.split(" ").filter(Boolean).length;
  if (THANKS_WORDS.test(t) && words <= 8) return "thanks";
  if (GREETING_WORDS.test(t) && words <= 6) return "greeting";
  return "offtopic";
}


// Reconnaissance des noms de mois en français et en arabe (tunisien et standard) → numéro du mois.
// Chaque entrée = [expression régulière, numéro]. Le « | » signifie « ou ».
export const MONTHS: [RegExp, number][] = [
  [/janvier|جانفي|يناير/, 1], [/fevrier|فيفري|فبراير/, 2], [/mars|مارس/, 3], [/avril|أفريل|افريل|أبريل/, 4],
  [/\bmai\b|ماي|مايو/, 5], [/juin|جوان|يونيو/, 6], [/juillet|جويلية|يوليو/, 7], [/aout|أوت|اوت|أغسطس/, 8],
  [/septembre|سبتمبر/, 9], [/octobre|أكتوبر|اكتوبر/, 10], [/novembre|نوفمبر/, 11], [/decembre|ديسمبر/, 12],
];

export const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Mois FUTUR demandé (1 à 12 mois après le mois en cours) : « le mois prochain », « dans 3 mois »,
// « en mars » (prochain mois de mars), « mars 2027 ». null = pas de mois futur reconnu.
export function parseFutureMonth(text: string, now = new Date()): { year: number; month: number } | null {
  const t = norm(text);
  const p = toLocal(now);
  const shift = (n: number) => {
    const index = p.year * 12 + (p.month - 1) + n;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  };
  if (/mois prochain|prochain mois|mois suivant|الشهر القادم|الشهر الجاي|الشهر المقبل/.test(t)) return shift(1);
  const inMonths = /dans (\d{1,2}) mois|(\d{1,2}) mois (a venir|prochains)/.exec(t);
  if (inMonths) {
    const n = Number(inMonths[1] ?? inMonths[2]);
    return n >= 1 && n <= 12 ? shift(n) : null;
  }
  for (const [re, month] of MONTHS) {
    if (!re.test(t)) continue;
    const explicitYear = /\b(20\d{2})\b/.exec(t);
    // Mois en cours sans année : c'est la prévision « fin de mois », pas un mois futur.
    if (!explicitYear && month === p.month) return null;
    const year = explicitYear ? Number(explicitYear[1]) : month > p.month ? p.year : p.year + 1;
    const ahead = (year - p.year) * 12 + (month - p.month);
    return ahead >= 1 && ahead <= 12 ? { year, month } : null;
  }
  return null;
}

