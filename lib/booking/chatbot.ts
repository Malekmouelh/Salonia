import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { PublicSalon } from "@/lib/data/public-salon";
import { getDaySlots, type Slot } from "./availability";
import { resolveItems } from "./create";
import { fmtDay, fmtTime } from "./format";
import { addDays, dayKey, parseDayKey, startOfLocalDay, toLocal, WEEKDAYS } from "./time";

// IA Module 3 — Chatbot de réservation.
// Le chatbot cherche de vrais créneaux et PROPOSE un rendez-vous ; c'est le client qui confirme
// (l'IA propose, l'utilisateur valide). Deux moteurs : Claude (outils) ou analyse par mots-clés.

export type ChatMessage = { role: "user" | "assistant"; text: string };
export type ChatProposal = {
  centerId: string;
  serviceIds: string[];
  packId: string | null;
  staffId: string | null;
  slot: Slot;
  label: string;
};
export type ChatReply = { text: string; chips?: string[]; proposals?: ChatProposal[]; source: "ai" | "offline" };

const isArabic = (s: string) => /[؀-ۿ]/.test(s);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ───────────────────────── Moteur par mots-clés (sans IA) ─────────────────────────

const SERVICE_WORDS: [RegExp, string][] = [
  [/brushing|تصفيف|براشينغ/, "Brushing"],
  [/coupe homme|homme|رجال/, "Coupe homme"],
  [/barbe|لحية/, "Taille de barbe"],
  [/coupe|cheveux|حلاقة|قص|شعر/, "Coupe femme"],
  [/coloration|couleur|صبغ/, "Coloration"],
  [/balayage|meches|ميش/, "Balayage"],
  [/keratine|كيراتين/, "Soin kératine"],
  [/manucure|ongles|مانيكير|أظافر|اظافر/, "Manucure"],
  [/gel|vernis/, "Pose gel"],
  [/visage|soin|بشرة|وجه/, "Soin visage éclat"],
  [/maquillage|makeup|مكياج|ماكياج/, "Maquillage soirée"],
];

const DAY_WORDS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  الأحد: 0, الاحد: 0, الإثنين: 1, الاثنين: 1, الثلاثاء: 2, الأربعاء: 3, الاربعاء: 3, الخميس: 4, الجمعة: 5, السبت: 6,
};

function parseDay(text: string, today: Date): Date | null {
  const t = norm(text);
  if (/apres[- ]demain|بعد غد/.test(t)) return addDays(today, 2);
  if (/demain|غدا|غدوة|غداً/.test(t)) return addDays(today, 1);
  if (/aujourd|ce soir|cet apres|اليوم|ليوم/.test(t)) return today;
  for (const [word, wd] of Object.entries(DAY_WORDS)) {
    if (t.includes(norm(word))) {
      const diff = (wd - toLocal(today).weekday + 7) % 7;
      return addDays(today, diff === 0 ? 7 : diff);
    }
  }
  const m = /\b(?:le\s+)?(\d{1,2})(?:\/(\d{1,2}))?\b(?!\s*h)/.exec(t);
  if (m && Number(m[1]) <= 31 && (m[2] || /le\s+\d/.test(t))) {
    const p = toLocal(today);
    const month = m[2] ? Number(m[2]) : p.month;
    let d = parseDayKey(`${p.year}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`);
    if (d && d < today) d = parseDayKey(`${p.year}-${String(month + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`);
    return d;
  }
  return null;
}

function parseTime(text: string): { from: number; to: number } | null {
  const t = norm(text);
  const exact = /(\d{1,2})\s*(?:h|:|heures?)\s*(\d{2})?/.exec(t) ?? /(?:vers|a|à)\s+(\d{1,2})\b/.exec(t);
  if (exact) {
    const minutes = Number(exact[1]) * 60 + Number(exact[2] ?? 0);
    if (minutes >= 6 * 60 && minutes <= 22 * 60) return { from: minutes - 60, to: minutes + 60 };
  }
  if (/matin|صباح|الصباح/.test(t)) return { from: 8 * 60, to: 12 * 60 };
  if (/apres[- ]midi|بعد الظهر|العشية/.test(t)) return { from: 13 * 60, to: 17 * 60 };
  if (/soir|مساء|الليل/.test(t)) return { from: 17 * 60, to: 22 * 60 };
  return null;
}

async function offlineReply(salon: PublicSalon, messages: ChatMessage[]): Promise<ChatReply> {
  const userText = messages.filter((m) => m.role === "user").map((m) => m.text).join(" \n ");
  const last = messages.filter((m) => m.role === "user").at(-1)?.text ?? "";
  const ar = isArabic(last);
  const L = (fr: string, arabic: string) => (ar ? arabic : fr);
  const t = norm(userText);
  const today = startOfLocalDay(new Date());

  // Centre : ville citée, sinon le premier centre.
  const center =
    salon.centers.find((c) => {
      const city = norm(c.name.split("—")[1] ?? c.name);
      return city.split(/\s+/).some((w) => w.length > 3 && t.includes(w)) || t.includes(norm(c.governorate)) ||
        (c.governorate === "MEDENINE" && /djerba|جربة/.test(t)) || (c.governorate === "TUNIS" && /tunis|تونس/.test(t)) || (c.governorate === "SOUSSE" && /sousse|سوسة/.test(t));
    }) ?? salon.centers[0];

  // Prestation : pack ou service (on regarde d'abord le dernier message).
  const pack = /mariee|mariage|عروس/.test(norm(last) || t)
    ? salon.packs.find((p) => /mari/i.test(p.name))
    : /detente|relax/.test(t)
      ? salon.packs.find((p) => /tente/i.test(p.name))
      : undefined;
  const serviceName = [norm(last), t].map((src) => SERVICE_WORDS.find(([re]) => re.test(src))?.[1]).find(Boolean);
  const service = !pack && serviceName ? salon.services.find((s) => s.name === serviceName) : undefined;

  if (!pack && !service) {
    return {
      source: "offline",
      text: L("Avec plaisir ! Quelle prestation souhaitez-vous ?", "بكل سرور! ما هي الخدمة التي تريدها؟"),
      chips: ar ? ["حلاقة", "تصفيف", "مانيكير", "مكياج"] : ["Coupe femme", "Brushing", "Manucure", "Soin visage", "Pack Mariée"],
    };
  }

  const day = parseDay(userText.split("\n").reverse().join(" "), today);
  if (!day) {
    return {
      source: "offline",
      text: L(`Très bien, ${pack?.name ?? service!.name}. Pour quel jour ?`, `حسنًا، ${pack?.name ?? service!.name}. لأي يوم؟`),
      chips: ar ? ["اليوم", "غدا", "السبت"] : ["Aujourd'hui", "Demain", "Samedi"],
    };
  }

  const staff = center.practitioners.find((p) => t.includes(norm(p.name.split(" ")[0])));
  const range = parseTime(userText);
  const selection = pack ? { packId: pack.id } : { serviceIds: [service!.id] };
  const { duration } = await resolveItems(salon.id, selection);

  // Jour demandé, puis les 3 jours suivants si complet.
  for (let i = 0; i < 4; i++) {
    const d = addDays(day, i);
    let slots = await getDaySlots({ organizationId: salon.id, centerId: center.id, day: d, durationMinutes: duration, staffId: staff?.id });
    if (range) {
      const inRange = slots.filter((s) => {
        const p = toLocal(new Date(s.start));
        const m = p.hour * 60 + p.minute;
        return m >= range.from && m <= range.to;
      });
      if (inRange.length) slots = inRange;
      else if (i === 0) slots = slots.slice(0, 0);
    }
    if (slots.length) {
      // Trois propositions bien réparties dans la journée.
      const picks = [slots[0], slots[Math.floor(slots.length / 2)], slots[slots.length - 1]].filter((s, j, a) => a.findIndex((x) => x.start === s.start) === j);
      const label = pack?.name ?? service!.name;
      const lang = ar ? "ar" : "fr";
      return {
        source: "offline",
        text:
          (i > 0 ? L("Ce jour-là est complet. ", "هذا اليوم ممتلئ. ") : "") +
          L(`Voici mes propositions pour ${label} à ${center.name}, ${fmtDay(d, lang)} :`,
            `إليك اقتراحاتي لـ ${label}، ${fmtDay(d, lang)}:`),
        proposals: picks.map((slot) => ({ centerId: center.id, serviceIds: pack ? [] : [service!.id], packId: pack?.id ?? null, staffId: staff?.id ?? null, slot, label: `${label} · ${fmtTime(slot.start, lang)}` })),
      };
    }
  }
  return {
    source: "offline",
    text: L("Désolé, je ne trouve pas de créneau proche. Essayez une autre date ?", "عذرًا، لا يوجد موعد قريب. هل تجرب تاريخًا آخر؟"),
    chips: ar ? ["الأسبوع القادم"] : ["Semaine prochaine", "Lundi", "Mardi"],
  };
}

// ───────────────────────── Moteur Claude (outils) ─────────────────────────

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find_slots",
    description:
      "Liste les créneaux libres d'une journée pour une prestation (service(s) ou pack) dans un centre. Toujours appeler cet outil avant de proposer un horaire : ne jamais inventer de disponibilité.",
    input_schema: {
      type: "object",
      properties: {
        center_id: { type: "string" },
        service_ids: { type: "array", items: { type: "string" }, description: "Identifiants des services (vide si pack)" },
        pack_id: { type: "string", description: "Identifiant du pack, si le client veut un pack" },
        staff_id: { type: "string", description: "Praticien souhaité (facultatif)" },
        date: { type: "string", description: "Jour au format YYYY-MM-DD (heure de Tunis)" },
      },
      required: ["center_id", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_booking",
    description:
      "Propose au client un créneau précis trouvé avec find_slots. Le client verra une carte « Confirmer » et saisira lui-même ses coordonnées. Peut être appelé jusqu'à 3 fois pour proposer plusieurs horaires.",
    input_schema: {
      type: "object",
      properties: {
        center_id: { type: "string" },
        service_ids: { type: "array", items: { type: "string" } },
        pack_id: { type: "string" },
        staff_id: { type: "string" },
        start: { type: "string", description: "Début du créneau (ISO 8601, tel que renvoyé par find_slots)" },
      },
      required: ["center_id", "start"],
      additionalProperties: false,
    },
  },
];

type ToolInput = { center_id?: string; service_ids?: string[]; pack_id?: string; staff_id?: string; date?: string; start?: string };

async function aiReply(salon: PublicSalon, messages: ChatMessage[]): Promise<ChatReply> {
  const client = new Anthropic();
  const today = startOfLocalDay(new Date());
  const catalog = {
    salon: salon.name,
    today: `${dayKey(today)} (${WEEKDAYS[toLocal(today).weekday]})`,
    centers: salon.centers.map((c) => ({ id: c.id, name: c.name, opening_hours: c.openingHours, practitioners: c.practitioners })),
    services: salon.services.map((s) => ({ id: s.id, name: s.name, category: s.category, minutes: s.durationMinutes, price_tnd: s.priceTnd })),
    packs: salon.packs.map((p) => ({ id: p.id, name: p.name, services: p.serviceNames, minutes: p.durationMinutes, price_tnd: p.priceTnd })),
  };
  const system = `Tu es l'assistant de réservation du salon ${salon.name} en Tunisie. Tu aides le client à trouver un rendez-vous.
Règles :
- Réponds dans la langue du client (français, arabe ou derja tunisienne), en 1 à 3 phrases chaleureuses.
- Utilise find_slots pour vérifier les disponibilités, puis propose_booking pour 1 à 3 créneaux proches de la demande.
- Ne demande jamais le nom ni le téléphone : le client les saisira en confirmant la carte proposée.
- Si la prestation, le centre ou le jour manquent, pose une seule question courte.
- Ne parle que de réservation dans ce salon.
Catalogue (JSON) : ${JSON.stringify(catalog)}`;

  const history: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({ role: m.role, content: m.text }));
  const proposals: ChatProposal[] = [];

  for (let turn = 0; turn < 6; turn++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system,
      tools: TOOLS,
      messages: history,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") break;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.Beta.BetaTextBlock).text).join("\n").trim();
      return { source: "ai", text: text || "…", proposals };
    }

    history.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = use.input as ToolInput;
      try {
        results.push({ type: "tool_result", tool_use_id: use.id, content: await runTool(salon, use.name, input, proposals) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: e instanceof Error ? e.message : "Erreur" });
      }
    }
    history.push({ role: "user", content: results });
  }
  return { source: "ai", text: "", proposals };
}

async function runTool(salon: PublicSalon, name: string, input: ToolInput, proposals: ChatProposal[]) {
  const center = salon.centers.find((c) => c.id === input.center_id);
  if (!center) throw new Error("center_id inconnu");
  const selection = input.pack_id ? { packId: input.pack_id } : { serviceIds: input.service_ids ?? [] };
  const { duration } = await resolveItems(salon.id, selection);
  const staffId = center.practitioners.some((p) => p.id === input.staff_id) ? input.staff_id! : null;

  if (name === "find_slots") {
    const day = input.date ? parseDayKey(input.date) : null;
    if (!day) throw new Error("date invalide (YYYY-MM-DD)");
    const slots = await getDaySlots({ organizationId: salon.id, centerId: center.id, day, durationMinutes: duration, staffId });
    if (!slots.length) return "Aucun créneau libre ce jour-là.";
    const names = new Map(center.practitioners.map((p) => [p.id, p.name]));
    return JSON.stringify(slots.slice(0, 24).map((s) => ({ start: s.start, heure: fmtTime(s.start), praticiens: s.staffIds.map((id) => names.get(id)) })));
  }

  if (name === "propose_booking") {
    if (proposals.length >= 3) return "Trois propositions déjà faites.";
    const start = new Date(input.start ?? "");
    const slots = await getDaySlots({ organizationId: salon.id, centerId: center.id, day: startOfLocalDay(start), durationMinutes: duration, staffId });
    const slot = slots.find((s) => s.start === start.toISOString());
    if (!slot) throw new Error("Ce créneau n'est pas libre : rappelle find_slots.");
    const label = input.pack_id
      ? salon.packs.find((p) => p.id === input.pack_id)?.name ?? ""
      : salon.services.filter((s) => input.service_ids?.includes(s.id)).map((s) => s.name).join(" + ");
    proposals.push({ centerId: center.id, serviceIds: input.pack_id ? [] : input.service_ids ?? [], packId: input.pack_id ?? null, staffId, slot, label: `${label} · ${fmtTime(slot.start)}` });
    return "Proposition affichée au client.";
  }
  throw new Error("outil inconnu");
}

export async function chatbotReply(salon: PublicSalon, messages: ChatMessage[]): Promise<ChatReply> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const reply = await aiReply(salon, messages);
      if (reply.text || reply.proposals?.length) return reply;
    } catch (error) {
      if (error instanceof Anthropic.APIError) console.error(`Chatbot : erreur API ${error.status}`, error.message);
      else console.error("Chatbot indisponible :", error);
    }
  }
  return offlineReply(salon, messages);
}
