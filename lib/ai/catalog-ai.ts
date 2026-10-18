import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// IA MODULE 2 — Fonctions intelligentes pour le catalogue de prestations
// (Génération descriptions, suggestions de packs, analyse tarifaire)
// Supporte l'API Anthropic avec repli hors-ligne automatique.
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceInputForDescription {
  name: string;
  category: string;
  durationMinutes: number;
  priceTnd: number;
  options?: { name: string; values: { label: string }[] }[];
}

export interface PackSuggestion {
  name: string;
  description: string;
  serviceIds: string[];
  priceTnd: number;
  regularPriceTnd: number;
  savingsTnd: number;
  savingsPercent: number;
}

export interface PricingRecommendation {
  type: "opportunity" | "warning" | "tip";
  title: string;
  description: string;
}

export interface PricingAnalysisResult {
  summary: string;
  stats: {
    avgPrice: number;
    totalServices: number;
    totalPacks: number;
    categoriesCount: number;
  };
  recommendations: PricingRecommendation[];
  source: "ai" | "offline";
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GÉNÉRATION DE DESCRIPTION DE PRESTATION (Tâche 8)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateServiceDescription(
  service: ServiceInputForDescription,
  lang: string = "fr",
): Promise<string> {
  const optionsText =
    service.options && service.options.length > 0
      ? `Options disponibles : ${service.options.map((o) => `${o.name} (${o.values.map((v) => v.label).join(", ")})`).join("; ")}.`
      : "";

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const prompt = `Tu es rédacteur marketing expert pour les salons de beauté et de coiffure en Tunisie.
Rédige une description courte (2 à 3 phrases percutantes, élégantes et vendeuses) pour cette prestation :
- Nom : ${service.name}
- Catégorie : ${service.category}
- Durée : ${service.durationMinutes} min
- Prix : ${service.priceTnd} DT
${optionsText}

Directives :
- Mets en avant les bienfaits, la sensorialité et le résultat professionnel impeccable.
- Style chaleureux, haut de gamme et engageant.
- Rédige en ${lang === "ar" ? "arabe moderne soigné" : "français soigné"}.
- Retourne UNIQUEMENT le texte de la description, sans guillemets, sans titre et sans fioritures.`;

      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      });

      const firstBlock = response.content[0];
      if (firstBlock && firstBlock.type === "text" && firstBlock.text.trim()) {
        return firstBlock.text.trim();
      }
    } catch (err) {
      console.warn("Échec génération IA Anthropic pour description, utilisation repli hors-ligne :", err);
    }
  }

  // Repli hors-ligne intelligent adapté par catégorie
  return offlineServiceDescription(service, lang);
}

function offlineServiceDescription(service: ServiceInputForDescription, lang: string): string {
  const cat = (service.category || "").toLowerCase();
  const name = service.name.trim();

  if (lang === "ar") {
    if (cat.includes("coiff") || cat.includes("حلاق") || cat.includes("قص")) {
      return `تألقي بإطلالة مميزة مع خدمة ${name}. لمسة احترافية تمنح شعرك الحيوية واللمعان وتدوم طويلاً مع أفضل المنتجات.`;
    }
    if (cat.includes("soin") || cat.includes("visage") || cat.includes("وجه")) {
      return `امنحي بشرتك عناية فائقة مع ${name}. جلسة متكاملة لتنقية البشرة وتجديد نضارتها وإشراقتها الطبيعية.`;
    }
    if (cat.includes("ongl") || cat.includes("manucure") || cat.includes("أظافر")) {
      return `يدان ناعمتان وأظافر أنيقة مع خدمة ${name}. لمسة دقيقة ولمعان جذاب يدوم لأسابيع.`;
    }
    if (cat.includes("mass") || cat.includes("bien") || cat.includes("تدليك")) {
      return `استمتعي بلحظة استرخاء استثنائية مع ${name}. جلسة مهدئة للأعصاب لإزالة التوتر وتجديد الطاقة والحيوية.`;
    }
    return `استمتعي بتجربة فريدة مع خدمة ${name}، المنفذة بأيدي خبيراتنا وبأرقى معايير الجودة والراحة.`;
  }

  // Français
  if (cat.includes("coiff") || cat.includes("coupe") || cat.includes("brushing")) {
    return `Sublimez votre chevelure avec notre prestation ${name}. Un savoir-faire expert pour apporter brillance, tenue et souplesse à vos cheveux avec des produits professionnels haute gamme.`;
  }
  if (cat.includes("color") || cat.includes("mèche") || cat.includes("balayage")) {
    return `Révélez l'éclat de vos cheveux grâce à notre ${name}. Des reflets subtils et une couleur riche et lumineuse qui respecte la fibre capillaire.`;
  }
  if (cat.includes("soin") || cat.includes("visage")) {
    return `Offrez à votre visage une véritable cure de jeunesse et d'éclat avec notre ${name}. Un soin en profondeur qui purifie, hydrate et illumine le teint durablement.`;
  }
  if (cat.includes("ongl") || cat.includes("manucure") || cat.includes("pédicure")) {
    return `Des mains et des ongles impeccablement soignés avec notre ${name}. Travail minutieux des cuticules et finition élégante pour une tenue irréprochable.`;
  }
  if (cat.includes("épil") || cat.includes("cire")) {
    return `Une peau douce et soyeuse avec notre prestation ${name}. Réalisée avec une cire délicate adaptée aux peaux sensibles pour un confort absolu.`;
  }
  if (cat.includes("mass") || cat.includes("bien-être") || cat.includes("spa")) {
    return `Accordez-vous une parenthèse de détente absolue avec notre ${name}. Des manœuvres enveloppantes pour libérer les tensions et retrouver sérénité et vitalité.`;
  }
  if (cat.includes("maquillage") || cat.includes("regard") || cat.includes("cils")) {
    return `Sublimez la beauté naturelle de votre regard avec ${name}. Un rendu sur-mesure, sophistiqué et longue tenue pour toutes vos occasions.`;
  }

  return `Profitez d'un moment de détente et d'excellence avec notre prestation ${name}. Nos praticiennes qualifiées prennent soin de vous avec les meilleurs protocoles et produits professionnels.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUGGESTION DE PACKS IA (Tâche 9)
// ─────────────────────────────────────────────────────────────────────────────

export interface MinimalService {
  id: string;
  name: string;
  category: string;
  priceTnd: number;
  durationMinutes: number;
}

export async function suggestPacks(services: MinimalService[]): Promise<PackSuggestion[]> {
  if (services.length < 2) return [];

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const servicesPrompt = services
        .map((s) => `ID: "${s.id}" | Nom: "${s.name}" | Catégorie: "${s.category}" | Prix: ${s.priceTnd} DT | Durée: ${s.durationMinutes} min`)
        .join("\n");

      const prompt = `Tu es consultant expert en merchandising pour les salons de beauté en Tunisie.
Voici les services actifs du salon :
${servicesPrompt}

Tâche : Propose entre 2 et 3 packs irrésistibles combinant des prestations complémentaires (ex : Coiffure + Soin, Manucure + Beauté du regard, Forfait Mariée / Soirée, Détente Totale).
Pour chaque pack :
- Nom vendeur et élégant (ex : "Pack Éclat & Beauté", "Rituel Sérénité", "Formule Mariée Sublime")
- Description courte valorisant le gain pour la cliente (1 à 2 phrases)
- serviceIds : tableau exact des IDs des services inclus (2 à 4 services par pack)
- priceTnd : prix du pack en dinars tunisiens, calculé avec environ 15% à 25% de remise par rapport à la somme des prix individuels.

Réponds STRICTEMENT avec un tableau JSON valide contenant des objets avec { name, description, serviceIds, priceTnd }. Aucun texte avant ou après.`;

      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      const firstBlock = response.content[0];
      if (firstBlock && firstBlock.type === "text") {
        const jsonMatch = firstBlock.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{
            name: string;
            description: string;
            serviceIds: string[];
            priceTnd: number;
          }>;

          return parsed
            .map((p) => {
              const matched = services.filter((s) => p.serviceIds.includes(s.id));
              if (matched.length < 2) return null;
              const regularTotal = matched.reduce((sum, s) => sum + s.priceTnd, 0);
              const packPrice = Math.min(regularTotal - 1, Math.max(5, Math.round(p.priceTnd)));
              const savingsTnd = regularTotal - packPrice;
              const savingsPercent = Math.round((savingsTnd / regularTotal) * 100);
              return {
                name: p.name,
                description: p.description,
                serviceIds: matched.map((s) => s.id),
                priceTnd: packPrice,
                regularPriceTnd: regularTotal,
                savingsTnd,
                savingsPercent,
              };
            })
            .filter((p): p is PackSuggestion => p !== null);
        }
      }
    } catch (err) {
      console.warn("Échec suggestion packs IA Anthropic, utilisation du moteur heuristique :", err);
    }
  }

  // Moteur heuristique hors-ligne
  return offlineSuggestPacks(services);
}

function offlineSuggestPacks(services: MinimalService[]): PackSuggestion[] {
  const suggestions: PackSuggestion[] = [];

  // 1. Pack Coiffure & Soin
  const hair = services.find((s) => /brushing|coupe|coiffure/i.test(s.name) || /coiffure/i.test(s.category));
  const care = services.find((s) => /soin|masque|kératine|traitement/i.test(s.name) || /soin/i.test(s.category));
  if (hair && care && hair.id !== care.id) {
    const regular = hair.priceTnd + care.priceTnd;
    const price = Math.round(regular * 0.82);
    suggestions.push({
      name: `Pack Rituel Beauté Cheveux`,
      description: `L'alliance parfaite entre une coupe ou coiffage soigné et un soin nourrissant en profondeur.`,
      serviceIds: [hair.id, care.id],
      priceTnd: price,
      regularPriceTnd: regular,
      savingsTnd: regular - price,
      savingsPercent: Math.round(((regular - price) / regular) * 100),
    });
  }

  // 2. Pack Beauté des Mains & Regard
  const nails = services.find((s) => /manucure|vernis|ongle/i.test(s.name) || /ongle|manucure/i.test(s.category));
  const faceOrLashes = services.find(
    (s) => (/regard|cils|sourcil|visage/i.test(s.name) || /regard|visage/i.test(s.category)) && s.id !== nails?.id,
  );
  if (nails && faceOrLashes) {
    const regular = nails.priceTnd + faceOrLashes.priceTnd;
    const price = Math.round(regular * 0.85);
    suggestions.push({
      name: `Pack Éclat & Finitions`,
      description: `Prenez soin de vos ongles et de votre regard en une seule séance beauté harmonieuse.`,
      serviceIds: [nails.id, faceOrLashes.id],
      priceTnd: price,
      regularPriceTnd: regular,
      savingsTnd: regular - price,
      savingsPercent: Math.round(((regular - price) / regular) * 100),
    });
  }

  // 3. Pack Complet Découverte (3 services de catégories différentes)
  const categories = [...new Set(services.map((s) => s.category))];
  if (categories.length >= 3) {
    const s1 = services.find((s) => s.category === categories[0])!;
    const s2 = services.find((s) => s.category === categories[1])!;
    const s3 = services.find((s) => s.category === categories[2])!;
    const regular = s1.priceTnd + s2.priceTnd + s3.priceTnd;
    const price = Math.round(regular * 0.8);
    suggestions.push({
      name: `Formule Privilège Complète`,
      description: `Le combiné idéal de vos 3 prestations phares pour une remise en beauté totale à tarif préférentiel.`,
      serviceIds: [s1.id, s2.id, s3.id],
      priceTnd: price,
      regularPriceTnd: regular,
      savingsTnd: regular - price,
      savingsPercent: Math.round(((regular - price) / regular) * 100),
    });
  } else if (services.length >= 2 && suggestions.length === 0) {
    // Si aucun pattern spécifique n'a matché, on combine les deux premiers services
    const s1 = services[0];
    const s2 = services[1];
    const regular = s1.priceTnd + s2.priceTnd;
    const price = Math.round(regular * 0.85);
    suggestions.push({
      name: `Pack Duo Express`,
      description: `Combinez ${s1.name} et ${s2.name} pour une expérience complète à prix doux.`,
      serviceIds: [s1.id, s2.id],
      priceTnd: price,
      regularPriceTnd: regular,
      savingsTnd: regular - price,
      savingsPercent: Math.round(((regular - price) / regular) * 100),
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ANALYSE TARIFAIRE IA (Tâche 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface MinimalPack {
  id: string;
  name: string;
  priceTnd: number;
  serviceIds: string[];
}

export interface MinimalCenter {
  name: string;
  governorate: string;
}

export async function analyzePricing(
  services: MinimalService[],
  packs: MinimalPack[] = [],
  centers: MinimalCenter[] = [],
): Promise<PricingAnalysisResult> {
  const avgPrice =
    services.length > 0 ? Math.round(services.reduce((acc, s) => acc + s.priceTnd, 0) / services.length) : 0;
  const categoriesCount = new Set(services.map((s) => s.category)).size;

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const prompt = `Tu es consultant expert en pricing et rentabilité pour les instituts de beauté et salons de coiffure en Tunisie.
Voici la structure du salon :
- Centres : ${centers.map((c) => `${c.name} (${c.governorate})`).join(", ")}
- Nombre de services : ${services.length}
- Prix moyen d'une prestation : ${avgPrice} DT
- Répartition :
${services.map((s) => `  * ${s.name} (${s.category}) : ${s.priceTnd} DT, ${s.durationMinutes} min`).join("\n")}
- Packs existants : ${packs.length > 0 ? packs.map((p) => `${p.name} (${p.priceTnd} DT)`).join(", ") : "Aucun pack actif"}

Donne une analyse tarifaire percutante comprenant :
1. Un résumé concis (2 phrases) évaluant la cohérence des prix par rapport au marché tunisien.
2. 3 à 4 recommandations concrètes sous format JSON :
   type: "opportunity" | "warning" | "tip"
   title: titre court
   description: explication avec chiffres concrets

Réponds STRICTEMENT avec du JSON valide :
{
  "summary": "...",
  "recommendations": [ { "type": "...", "title": "...", "description": "..." } ]
}`;

      const response = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      const firstBlock = response.content[0];
      if (firstBlock && firstBlock.type === "text") {
        const jsonMatch = firstBlock.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            summary: parsed.summary,
            recommendations: parsed.recommendations,
            stats: {
              avgPrice,
              totalServices: services.length,
              totalPacks: packs.length,
              categoriesCount,
            },
            source: "ai",
          };
        }
      }
    } catch (err) {
      console.warn("Échec analyse pricing IA Anthropic, bascule sur l'audit analytique :", err);
    }
  }

  // Audit analytique hors-ligne
  return offlinePricingAnalysis(services, packs, centers, avgPrice, categoriesCount);
}

function offlinePricingAnalysis(
  services: MinimalService[],
  packs: MinimalPack[] = [],
  centers: MinimalCenter[] = [],
  avgPrice: number,
  categoriesCount: number,
): PricingAnalysisResult {
  const recommendations: PricingRecommendation[] = [];

  // 1. Opportunité de packs
  if ((packs || []).length === 0 && services.length >= 4) {
    recommendations.push({
      type: "opportunity",
      title: "Activez des packs pour augmenter le panier moyen",
      description:
        "Votre catalogue ne propose aucun forfait groupé. Les packs (ex: Coiffure + Soin) augmentent le panier moyen de 25 à 35% tout en fidélisant les clientes.",
    });
  }

  // 2. Vérification des prix par minute (rentabilité du temps)
  const hourlyRates = services
    .filter((s) => s.durationMinutes > 0)
    .map((s) => ({
      name: s.name,
      ratePerHour: (s.priceTnd / s.durationMinutes) * 60,
    }));

  const lowestRate = hourlyRates.sort((a, b) => a.ratePerHour - b.ratePerHour)[0];
  if (lowestRate && lowestRate.ratePerHour < 25) {
    recommendations.push({
      type: "warning",
      title: `Rendement horaire faible sur "${lowestRate.name}"`,
      description: `Cette prestation génère environ ${Math.round(lowestRate.ratePerHour)} DT/heure, ce qui est en dessous de la moyenne rentable (35-50 DT/h). Envisagez de réajuster son tarif de 5 à 10 DT.`,
    });
  }

  // 3. Diversité du catalogue
  if (categoriesCount < 3) {
    recommendations.push({
      type: "tip",
      title: "Élargissez l'éventail de vos catégories",
      description: `Votre offre est concentrée sur seulement ${categoriesCount} catégorie(s). L'ajout de prestations complémentaires (soins express, regard ou manucure) favorise les ventes croisées.`,
    });
  } else {
    recommendations.push({
      type: "tip",
      title: "Excellente couverture de services",
      description: `Votre offre couvre ${categoriesCount} univers de beauté différents. Pensez à proposer des options payantes personnalisables pour maximiser la marge sur chaque prestation.`,
    });
  }

  // 4. Benchmark géographique
  const isTunisOrCoast = (centers || []).some((c) =>
    /TUNIS|ARIANA|BEN_AROUS|NABEUL|SOUSSE/i.test(c.governorate),
  );
  if (isTunisOrCoast && avgPrice < 35) {
    recommendations.push({
      type: "opportunity",
      title: "Positionnement tarifaire favorable à une hausse",
      description: `Pour votre implantation géographique (Grand Tunis / Sahel), le panier moyen du marché se situe généralement entre 45 et 70 DT. Vos tarifs compétitifs laissent une marge d'optimisation de 10 à 15%.`,
    });
  }

  return {
    summary: `Votre catalogue compte ${services.length} prestation(s) pour un prix moyen de ${avgPrice} DT. Le niveau global de prix est compétitif et présente des opportunités claires d'optimisation du panier moyen.`,
    stats: {
      avgPrice,
      totalServices: services.length,
      totalPacks: packs.length,
      categoriesCount,
    },
    recommendations,
    source: "offline",
  };
}
