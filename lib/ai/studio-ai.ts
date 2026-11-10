import dns from "node:dns";
import Anthropic from "@anthropic-ai/sdk";
import {
  GeneratedStudioTemplateSchema,
  STUDIO_FONTS,
  type GenerateStudioPromptInput,
  type GeneratedStudioTemplate,
} from "@/lib/vitrine/studio-ai-schema";

// Sur Windows et certains réseaux où IPv6 est advertised mais non routé, privilégier IPv4 pour éviter les timeouts fetch
try {
  dns.setDefaultResultOrder?.("ipv4first");
} catch {}

// Modèle Gemini par défaut (doté d'un quota gratuit)
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

const SYSTEM_PROMPT = `Tu es le directeur artistique senior et concepteur-rédacteur de Salonia, la plateforme de gestion et vitrine pour salons de coiffure, instituts de beauté et spas de prestige.
Tu conçois des affiches publicitaires et cartons d'invitation numériques haut de gamme (Instagram Stories, publications carrées ou bannières) à partir des demandes des gérants de salon.

Règles de rédaction et de direction artistique :
1. Titre (title) : Court (3 à 7 mots), accrocheur, prestige et soigné. Jamais de guillemets superflus.
2. Sous-titre (subtitle) : Évocateur, décrivant la promesse ou le bénéfice (ex: "Diagnostic sur-mesure & Coupe de champagne offerte").
3. Date (date) : Formulée avec élégance (ex: "Vendredi 24 & Samedi 25 Mai à partir de 16h", "Ce Samedi dès 14h").
4. Lieu (location) : Le nom du salon ou son adresse élégante.
5. Remise/Badge (discount) : Très court et percutant (ex: "-25% PRIVILÈGE", "OFFRE VIP", "COCKTAIL & SOINS", "CADEAU DE BIENVENUE").
6. Modèle de base (template) : 
   - "vip_invitation" pour soirées privées, inaugurations, événements sur liste.
   - "modern_promo" pour soldes, promotions flash, réductions forfaits.
   - "grand_opening" pour nouvelles ouvertures, déménagements de salon.
   - "beauty_day" pour journées portes ouvertes, ateliers beauté, masterclasses.
7. Format (aspectRatio) :
   - "story" (9:16) pour Instagram/TikTok/WhatsApp stories (idéal pour les invitations).
   - "square" (1:1) pour feed Instagram/Facebook ou flyers imprimables.
   - "landscape" (16:9) pour bannières Facebook, écrans salon ou sites web.
8. Palette de couleurs harmonieuse :
   - primary : Hex 6 caractères (ex: #e8b4a0 rose-gold, #d4af37 or imperial, #10b981 émeraude, #ea580c terracotta).
   - secondary : Hex sombre 6 caractères pour fond luxueux dégradé (ex: #2a0f25 prune, #121212 noir velours, #062b1e vert forêt sombre).
   - accent : Hex clair 6 caractères pour reflets satinés et badges (ex: #f3d9cf, #f9e79f, #d1fae5).
9. Typographie (fontFamily) : Choisis parmi : playfair, cormorant, outfit, inter, roboto, poppins, montserrat, cairo, tajawal, amiri.
10. Réponds STRICTEMENT en JSON valide conforme au schéma demandé. Aucun texte introductif ou markdown autour.`;

/**
 * Analyse sémantique avancée du prompt utilisateur :
 * Extrait le sujet réel, les prestations, remises, dates et compose un titre et sous-titre
 * parfaitement fidèles et compatibles avec ce que le gérant de salon a écrit.
 */
export function extractSemanticPosterContent(
  prompt: string,
  salonName: string,
  variationIndex: number = 0,
  isInvitation: boolean = false
): {
  title: string;
  subtitle: string;
  date: string;
  discount: string;
} {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const vIdx = Math.abs(variationIndex || 0);

  // 1. Détection de date / horaires
  let extractedDate = isInvitation ? "Ce Vendredi & Samedi dès 15h" : "Ce week-end";
  const dateMatch = p.match(
    /\b((ce\s+)?(vendredi|samedi|dimanche|lundi|mardi|mercredi|jeudi)(\s+(et|&)\s+(vendredi|samedi|dimanche|lundi))?(\s+(à|dès|a partir de)\s+\d{1,2}h(\d{2})?)?)\b/i
  );
  const weekendMatch = p.match(/\b((ce\s+)?week-?end(\s+(prochain))?)\b/i);
  const timeOnlyMatch = p.match(/\b(dès|à partir de|à)\s+(\d{1,2}h(\d{2})?)\b/i);

  if (dateMatch) {
    extractedDate = dateMatch[1].charAt(0).toUpperCase() + dateMatch[1].slice(1);
  } else if (weekendMatch) {
    extractedDate = "Ce week-end";
  } else if (timeOnlyMatch) {
    extractedDate = `Dès ${timeOnlyMatch[2]}`;
  }

  // 2. Détection de remise / badge
  const discountMatch = p.match(/(-?\d{1,2}\s?%)/i);
  let discountBadge = discountMatch ? `${discountMatch[1].toUpperCase()} REMISE` : "";
  const priceMatch = p.match(/(\d+)\s?(dt|tnd|dinars|€|\$)/i);

  if (!discountBadge) {
    if (priceMatch) {
      discountBadge = `OFFRE ${priceMatch[1]} ${priceMatch[2].toUpperCase()}`;
    } else if (lower.includes("champagne")) {
      discountBadge = "CHAMPAGNE OFFERT";
    } else if (lower.includes("diagnostic")) {
      discountBadge = "DIAGNOSTIC OFFERT";
    } else if (lower.includes("soin") && lower.includes("offert")) {
      discountBadge = "SOIN OFFERT";
    } else if (lower.includes("brushing") && lower.includes("offert")) {
      discountBadge = "BRUSHING OFFERT";
    } else if (lower.includes("cadeau") || lower.includes("gratuit")) {
      discountBadge = "CADEAU OFFERT";
    } else if (lower.includes("vip") || lower.includes("privilège")) {
      discountBadge = "INVITATION VIP";
    } else if (lower.includes("ouverture") || lower.includes("inaugur")) {
      discountBadge = "BIENVENUE";
    } else if (lower.includes("flash") || lower.includes("promo") || lower.includes("réduction")) {
      discountBadge = "VENTE FLASH";
    } else {
      discountBadge = isInvitation ? "ENTRÉE PRIVILÈGE" : "ÉVÉNEMENT EXCLUSIF";
    }
  }

  // 3. Découpage en Sujet Principal (Titre) et Détails des Prestations (Sous-titre)
  let cleaned = p
    .replace(/^(créer|générer|faire|je veux|je souhaite|voici|proposer)\s+(une\s+)?(affiche|carte|invitation)?\s+(pour|sur)?\s*/i, "")
    .replace(/^annonce\s+(pour|de)?\s*/i, "")
    .trim();

  // Séparateurs de clauses : "avec", "à l'occasion de", ":", "-", "+", "pour célébrer", etc.
  const splitRegex = /\s*(?:[:;•–—+]|\bavec\b|\bà l'occasion de\b|\bprofitez de\b|\bbénéficiez de\b|\bpour célébrer\b|\bpour seulement\b|\boffre\s*:?)\s*/i;
  let parts = cleaned.split(splitRegex).map((s) => s.trim()).filter(Boolean);

  // Si une seule partie mais longue ou avec "et", couper intelligemment pour alimenter le sous-titre
  if (parts.length === 1) {
    if (cleaned.includes(",") || cleaned.includes(".")) {
      const commaSplit = cleaned.split(/[,.]\s*/).filter(Boolean);
      if (commaSplit.length > 1) {
        parts = commaSplit;
      }
    } else if (cleaned.split(" ").length >= 6 && /\s+et\s+/i.test(cleaned)) {
      const andSplit = cleaned.split(/\s+et\s+/i).filter(Boolean);
      if (andSplit.length > 1) {
        parts = andSplit;
      }
    }
  }

  let mainSubject = parts[0] || cleaned;
  let detailClause = parts.slice(1).join(" • ") || "";

  mainSubject = mainSubject
    .replace(/^(notre|notre nouveau|notre nouvelle|nouveau|nouvelle|offre|promo|promotion)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();

  const toTitleCase = (str: string) =>
    str
      .split(" ")
      .map((word, idx) => {
        const wLower = word.toLowerCase();
        if (
          idx > 0 &&
          ["et", "de", "du", "des", "la", "le", "les", "un", "une", "au", "aux", "pour", "en", "sur", "par", "a", "à"].includes(wLower)
        ) {
          return wLower;
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");

  let baseTitle = toTitleCase(mainSubject);
  if (baseTitle.length > 55) {
    const words = baseTitle.split(" ");
    baseTitle = words.slice(0, 6).join(" ");
  }

  // Formulation du Sous-titre fidèle au texte utilisateur
  let baseSubtitle = "";
  if (detailClause) {
    let sub = detailClause.replace(/^[•\s,]+/, "").trim();
    sub = sub.charAt(0).toUpperCase() + sub.slice(1);
    baseSubtitle = sub;
  } else {
    // Si aucun séparateur n'a été trouvé, reprendre le texte utilisateur pour éviter une phrase générique
    if (cleaned.length > 25 && cleaned.length !== mainSubject.length) {
      baseSubtitle = cleaned;
    } else if (lower.includes("visage") || lower.includes("peau") || lower.includes("soin")) {
      baseSubtitle = "Diagnostic personnalisé & Soins d'exception réalisés par nos expertes";
    } else if (lower.includes("cheveu") || lower.includes("coiffure") || lower.includes("coloration") || lower.includes("lissage") || lower.includes("botox")) {
      baseSubtitle = "Sublimez votre chevelure avec nos rituels capillaires signatures";
    } else if (lower.includes("massage") || lower.includes("spa") || lower.includes("relaxation")) {
      baseSubtitle = "Une parenthèse sensorielle relaxante dans notre espace dédié au bien-être";
    } else if (lower.includes("mariée") || lower.includes("mariage") || lower.includes("henné")) {
      baseSubtitle = "Essayages coiffure, mise en beauté orientale & Conseils d'expertes";
    } else {
      baseSubtitle = `Prestations d'exception & accueil privilégié chez ${salonName}`;
    }
  }

  // Personnalisation selon Invitation vs Affiche
  if (isInvitation) {
    if (!discountBadge || discountBadge === "ÉVÉNEMENT EXCLUSIF") {
      discountBadge = "INVITATION PRIVÉE";
    }
    if (!baseTitle.toLowerCase().includes("invitation") && !baseTitle.toLowerCase().includes("soirée")) {
      if (baseTitle.length < 35) {
        baseTitle = `Invitation : ${baseTitle}`;
      }
    }
  } else {
    if (!discountBadge) {
      discountBadge = "OFFRE SPÉCIALE";
    }
  }

  if (baseSubtitle.length > 140) {
    baseSubtitle = baseSubtitle.slice(0, 137).replace(/\s+[^\s]*$/, "...");
  }

  // 4. Variations selon variationIndex
  let finalTitle = baseTitle;
  let finalSubtitle = baseSubtitle;

  if (vIdx === 1) {
    finalTitle = isInvitation
      ? `Invitation · ${baseTitle}`
      : `Événement Beauté : ${baseTitle}`;
    if (!detailClause) {
      finalSubtitle = `Venez vivre un moment unique chez ${salonName} • Prestations d'exception`;
    }
  } else if (vIdx === 2) {
    finalTitle = `Privilège d'Exception : ${baseTitle}`;
    finalSubtitle = detailClause
      ? `${baseSubtitle} • Offre limitée`
      : `Offre exclusive réservée à nos clientes privilégiées chez ${salonName}`;
  }

  return {
    title: finalTitle,
    subtitle: finalSubtitle,
    date: extractedDate,
    discount: discountBadge,
  };
}

/**
 * Moteur heuristique d'art direction en cas d'absence de clé API ou de panne réseau.
 */
export function generateHeuristicTemplate(input: GenerateStudioPromptInput): GeneratedStudioTemplate {
  const p = input.prompt.toLowerCase();
  const salon = input.salonName?.trim() || "Maison de Beauté";
  const isInvitation = input.type === "invitation";
  const vIdx = Math.abs(input.variationIndex || 0);

  // Analyse sémantique fine du prompt utilisateur
  const semantic = extractSemanticPosterContent(input.prompt, salon, vIdx, isInvitation);

  // Détection du template de base
  let template: GeneratedStudioTemplate["template"] = "vip_invitation";
  if (p.includes("promo") || p.includes("réduction") || p.includes("solde") || p.match(/-?\d{1,2}\s?%/)) {
    template = "modern_promo";
  } else if (p.includes("ouverture") || p.includes("nouveau") || p.includes("inaugur")) {
    template = "grand_opening";
  } else if (p.includes("journée") || p.includes("portes ouvertes") || p.includes("atelier") || p.includes("découverte")) {
    template = "beauty_day";
  } else if (isInvitation) {
    template = "vip_invitation";
  }

  // Palette & typographie selon l'ambiance et la variation
  const TONE_VARIATIONS: Record<
    string,
    Array<{
      primary: string;
      secondary: string;
      accent: string;
      font: GeneratedStudioTemplate["fontFamily"];
      toneExpl: string;
    }>
  > = {
    luxe: [
      {
        primary: "#d4af37",
        secondary: "#121212",
        accent: "#f9e79f",
        font: "cormorant",
        toneExpl: "Élégance impériale noire et or champagne haute couture.",
      },
      {
        primary: "#e8b4a0",
        secondary: "#1e0b1c",
        accent: "#fce7f3",
        font: "playfair",
        toneExpl: "Rose Gold Impérial & Velours Noir Nuit.",
      },
      {
        primary: "#f59e0b",
        secondary: "#09090b",
        accent: "#fef08a",
        font: "outfit",
        toneExpl: "Or Miroir & Noir Minimaliste Contemporain.",
      },
    ],
    moderne: [
      {
        primary: "#38bdf8",
        secondary: "#0c1524",
        accent: "#e0f2fe",
        font: "outfit",
        toneExpl: "Design moderne, épuré et contemporain aux reflets cyan.",
      },
      {
        primary: "#06b6d4",
        secondary: "#0f172a",
        accent: "#cffafe",
        font: "montserrat",
        toneExpl: "Teinte sarcelle & bleu nuit urbain dynamique.",
      },
      {
        primary: "#818cf8",
        secondary: "#0f0e26",
        accent: "#e0e7ff",
        font: "inter",
        toneExpl: "Indigo chic & reflets violets modernes.",
      },
    ],
    minimaliste: [
      {
        primary: "#10b981",
        secondary: "#052317",
        accent: "#d1fae5",
        font: "inter",
        toneExpl: "Ambiance zen, végétale et minimaliste avec vert émeraude.",
      },
      {
        primary: "#059669",
        secondary: "#062b1e",
        accent: "#a7f3d0",
        font: "cormorant",
        toneExpl: "Émeraude Royale & nuances végétales pures.",
      },
      {
        primary: "#14b8a6",
        secondary: "#042f2e",
        accent: "#ccfbf1",
        font: "outfit",
        toneExpl: "Vert d'eau & sérénité minérale contemporaine.",
      },
    ],
    fete: [
      {
        primary: "#f59e0b",
        secondary: "#200926",
        accent: "#fef08a",
        font: "montserrat",
        toneExpl: "Atmosphère festive éclatante et énergique.",
      },
      {
        primary: "#f97316",
        secondary: "#31102b",
        accent: "#ffedd5",
        font: "poppins",
        toneExpl: "Cocktail mandarine & prune festif.",
      },
      {
        primary: "#ec4899",
        secondary: "#270822",
        accent: "#fdf2f8",
        font: "outfit",
        toneExpl: "Framboise éclatante & nuances pétillantes.",
      },
    ],
    oriental: [
      {
        primary: "#d97706",
        secondary: "#281204",
        accent: "#fef3c7",
        font: "cairo",
        toneExpl: "Palette ambrée et dorée aux inspirations orientales chaleureuses.",
      },
      {
        primary: "#b45309",
        secondary: "#1f0c02",
        accent: "#fde68a",
        font: "tajawal",
        toneExpl: "Ocre ambré & bois précieux.",
      },
      {
        primary: "#ea580c",
        secondary: "#2c1103",
        accent: "#fed7aa",
        font: "amiri",
        toneExpl: "Cuir ambré & calligraphie orientale majestueuse.",
      },
    ],
    romantique: [
      {
        primary: "#f472b6",
        secondary: "#2d0d21",
        accent: "#fce7f3",
        font: "playfair",
        toneExpl: "Douceur romantique et poudrée pour célébrations et mariées.",
      },
      {
        primary: "#e8b4a0",
        secondary: "#2a0f25",
        accent: "#f3d9cf",
        font: "cormorant",
        toneExpl: "Rose Gold Poudré & Nacre Délicate.",
      },
      {
        primary: "#fb7185",
        secondary: "#330b22",
        accent: "#ffe4e6",
        font: "outfit",
        toneExpl: "Pétale de rose moderne & nuances douces.",
      },
    ],
  };

  const currentToneKey =
    input.tone ||
    (input.tone === "oriental" || p.includes("arabe") || p.includes("orient") || p.includes("henné") || p.includes("hammam")
      ? "oriental"
      : input.tone === "moderne" || p.includes("flash") || p.includes("tendance")
      ? "moderne"
      : input.tone === "minimaliste" || p.includes("zen") || p.includes("nature")
      ? "minimaliste"
      : input.tone === "fete" || p.includes("fête") || p.includes("cocktail")
      ? "fete"
      : input.tone === "romantique" || p.includes("mariée") || p.includes("rose")
      ? "romantique"
      : "luxe");

  const availableVariations = TONE_VARIATIONS[currentToneKey] || TONE_VARIATIONS.luxe;
  const pickedVar = availableVariations[vIdx % availableVariations.length];

  let primary = pickedVar.primary;
  let secondary = pickedVar.secondary;
  const accent = pickedVar.accent;
  const font = pickedVar.font;
  const toneExpl = pickedVar.toneExpl;

  // Format optimal
  const aspectRatio: GeneratedStudioTemplate["aspectRatio"] =
    input.aspectRatio || (isInvitation ? "story" : "square");

  // Remplacement par les couleurs préférées de l'utilisateur si spécifiées
  if (input.preferredPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredPrimaryColor)) {
    primary = input.preferredPrimaryColor;
  }
  if (input.preferredSecondaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredSecondaryColor)) {
    secondary = input.preferredSecondaryColor;
  }

  // Sélection d'un arrière-plan thématique si l'utilisateur n'en a pas fourni un
  let pickedBg = input.bgPhoto || "";
  if (!pickedBg) {
    if (p.includes("spa") || p.includes("zen") || p.includes("massage") || p.includes("relaxation")) {
      pickedBg = "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80";
    } else if (p.includes("coiff") || p.includes("cheveu") || p.includes("lissage") || p.includes("brushing")) {
      pickedBg = "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1200&q=80";
    } else if (p.includes("soirée") || p.includes("fête") || p.includes("cocktail") || p.includes("inaugur")) {
      pickedBg = vIdx % 2 === 0
        ? "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?auto=format&fit=crop&w=1200&q=80"
        : "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80";
    } else if (p.includes("mariée") || p.includes("rose") || p.includes("boudoir")) {
      pickedBg = "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80";
    } else {
      const bgPool = [
        "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1200&q=80",
      ];
      pickedBg = bgPool[vIdx % bgPool.length];
    }
  }

  return {
    title: semantic.title,
    subtitle: semantic.subtitle,
    date: semantic.date,
    location: salon,
    discount: semantic.discount,
    template,
    aspectRatio,
    colorPalette: {
      primary,
      secondary,
      accent,
    },
    fontFamily: font,
    layoutType: isInvitation ? "editorial" : "centered",
    toneDescription: toneExpl,
    bgPhoto: pickedBg,
    provider: "offline",
  };
}

/**
 * Appelle l'un des moteurs IA (Gemini ou Claude) avec Structured Output JSON,
 * ou bascule gracieusement sur le moteur heuristique de repli.
 */
export async function generateStudioTemplateWithAI(
  input: GenerateStudioPromptInput
): Promise<GeneratedStudioTemplate> {
  const userPrompt = `
Demande de création de visuel :
- Type : ${input.type === "invitation" ? "Carte d'invitation privée" : "Affiche promotionnelle / événement"}
- Ambiance souhaitée : ${input.tone || "luxe"}
- Format : ${input.aspectRatio || (input.type === "invitation" ? "story" : "square")}
- Index de variation : ${input.variationIndex || 0} (IMPORTANT: propose une approche créative différente avec une NOUVELLE palette de couleurs captivante et une formulation textuelle alternative originale)
- Nom du salon : ${input.salonName || "Salon de prestige"}
${input.preferredPrimaryColor ? `- Couleur primaire d'accent préférée : ${input.preferredPrimaryColor}` : "- Palette de couleurs : CRÉE une palette de 3 couleurs (#RRGGBB) variée et adaptée au thème (ex: Émeraude #10b981 / Sombre #052317, Nuit Saphir #38bdf8 / Nuit #0c1524, Or Impérial #d4af37 / Noir #121212, Rose Gold #e8b4a0 / Prune #2a0f25, Rubis #f43f5e / Noir #200610, Ambre #f59e0b / Chocolat #261304, Terracotta #ea580c / Sombre #1e0b04, Titane #94a3b8 / Mat #0f172a). Ne reste PAS sur les mêmes couleurs !"}
${input.preferredSecondaryColor ? `- Couleur de fond sombre préférée : ${input.preferredSecondaryColor}` : ""}
- Description / Brief de l'utilisateur :
"${input.prompt}"

Génère un objet JSON valide avec les champs :
- title : Titre percutant
- subtitle : Sous-titre ou description courte
- date : Date / horaires proposés
- location : Nom du salon ou lieu
- discount : Badge d'offre / remise (ex: "-20% REMISE", "VIP PASS")
- template : "vip_invitation" | "modern_promo" | "grand_opening" | "beauty_day"
- aspectRatio : "story" | "square" | "landscape"
- colorPalette : { primary: "#RRGGBB", secondary: "#RRGGBB", accent: "#RRGGBB" }
- fontFamily : parmi "playfair", "cormorant", "outfit", "inter", "roboto", "poppins", "montserrat", "cairo", "tajawal", "amiri"
- layoutType : "centered" | "editorial" | "minimal" | "bold"
- toneDescription : courte phrase résumant le parti-pris visuel
- bgPhoto : URL de fond choisie parmi :
  * "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80" (Marbre & Or)
  * "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80" (Boudoir Rose)
  * "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80" (Spa & Sérénité)
  * "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80" (Salon Tamisé)
  * "https://images.unsplash.com/photo-1519751138087-5bf79df62d5b?auto=format&fit=crop&w=1200&q=80" (Soirée & Paillettes)
  * "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1200&q=80" (Coiffure & Miroirs)
  * "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80" (Velours Émeraude)
  * "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80" (Marbre Pur)
`;

  // 1. Priorité Groq Cloud (si clé GROQ_API_KEY configurée — LLM ultra-rapide)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim() || "";
        if (content) {
          const parsed = JSON.parse(content);
          const validated = GeneratedStudioTemplateSchema.safeParse(parsed);
          if (validated.success) {
            const finalBg = (input.bgPhoto && input.bgPhoto.startsWith("data:"))
              ? input.bgPhoto
              : (validated.data.bgPhoto || input.bgPhoto || "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80");

            return {
              ...validated.data,
              provider: "groq",
              bgPhoto: finalBg,
              colorPalette: {
                ...validated.data.colorPalette,
                primary: input.preferredPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredPrimaryColor)
                  ? input.preferredPrimaryColor
                  : validated.data.colorPalette.primary,
                secondary: input.preferredSecondaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredSecondaryColor)
                  ? input.preferredSecondaryColor
                  : validated.data.colorPalette.secondary,
              },
            };
          }
        }
      } else {
        const errDetails = await res.text().catch(() => "");
        console.warn(`[Studio AI] Échec Groq (${res.status}) : ${errDetails.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn("[Studio AI] Erreur réseau / timeout Groq :", err);
    }
  }

  // 2. Deuxième priorité Google Gemini (si clé GEMINI_API_KEY configurée)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.7,
              maxOutputTokens: 2048,
            },
          }),
          signal: AbortSignal.timeout(20_000),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text =
          data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (text) {
          const parsed = JSON.parse(text);
          const validated = GeneratedStudioTemplateSchema.safeParse(parsed);
          if (validated.success) {
            const finalBg = (input.bgPhoto && input.bgPhoto.startsWith("data:"))
              ? input.bgPhoto
              : (validated.data.bgPhoto || input.bgPhoto || "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80");

            return {
              ...validated.data,
              provider: "gemini",
              bgPhoto: finalBg,
              colorPalette: {
                ...validated.data.colorPalette,
                primary: input.preferredPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredPrimaryColor)
                  ? input.preferredPrimaryColor
                  : validated.data.colorPalette.primary,
                secondary: input.preferredSecondaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredSecondaryColor)
                  ? input.preferredSecondaryColor
                  : validated.data.colorPalette.secondary,
              },
            };
          }
        }
      } else {
        const errDetails = await res.text().catch(() => "");
        console.warn(`[Studio AI] Échec Google Gemini (${res.status}) : ${errDetails.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn("[Studio AI] Erreur réseau / timeout Google Gemini :", err);
    }
  }

  // 3. Troisième priorité OpenAI (si clé OPENAI_API_KEY configurée)
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim() || "";
        if (content) {
          const parsed = JSON.parse(content);
          const validated = GeneratedStudioTemplateSchema.safeParse(parsed);
          if (validated.success) {
            const finalBg = (input.bgPhoto && input.bgPhoto.startsWith("data:"))
              ? input.bgPhoto
              : (validated.data.bgPhoto || input.bgPhoto || "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80");

            return {
              ...validated.data,
              provider: "openai",
              bgPhoto: finalBg,
              colorPalette: {
                ...validated.data.colorPalette,
                primary: input.preferredPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredPrimaryColor)
                  ? input.preferredPrimaryColor
                  : validated.data.colorPalette.primary,
                secondary: input.preferredSecondaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredSecondaryColor)
                  ? input.preferredSecondaryColor
                  : validated.data.colorPalette.secondary,
              },
            };
          }
        }
      } else {
        const errDetails = await res.text().catch(() => "");
        console.warn(`[Studio AI] Échec OpenAI (${res.status}) : ${errDetails.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn("[Studio AI] Erreur réseau / timeout OpenAI :", err);
    }
  }

  // 4. Quatrième priorité Anthropic Claude (si clé ANTHROPIC_API_KEY configurée)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const firstBlock = response.content[0];
      if (firstBlock && firstBlock.type === "text") {
        const text = firstBlock.text.trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const validated = GeneratedStudioTemplateSchema.safeParse(parsed);
          if (validated.success) {
            const finalBg = (input.bgPhoto && input.bgPhoto.startsWith("data:"))
              ? input.bgPhoto
              : (validated.data.bgPhoto || input.bgPhoto || "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80");

            return {
              ...validated.data,
              provider: "claude",
              bgPhoto: finalBg,
              colorPalette: {
                ...validated.data.colorPalette,
                primary: input.preferredPrimaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredPrimaryColor)
                  ? input.preferredPrimaryColor
                  : validated.data.colorPalette.primary,
                secondary: input.preferredSecondaryColor && /^#[0-9a-fA-F]{6}$/.test(input.preferredSecondaryColor)
                  ? input.preferredSecondaryColor
                  : validated.data.colorPalette.secondary,
              },
            };
          }
        }
      }
    } catch (err) {
      console.warn("[Studio AI] Échec Anthropic Claude, repli en cours...", err);
    }
  }

  // 4. Repli automatique et gracieux sur le moteur heuristique de design (offline)
  return generateHeuristicTemplate(input);
}
