import test from "node:test";
import assert from "node:assert/strict";
import {
  GenerateStudioPromptSchema,
  GeneratedStudioTemplateSchema,
} from "./studio-ai-schema";
import {
  generateHeuristicTemplate,
  generateStudioTemplateWithAI,
} from "../ai/studio-ai";

test("Studio AI — Validation des schémas d'entrée", () => {
  // Entrée valide complète
  const valid = GenerateStudioPromptSchema.safeParse({
    prompt: "Soirée cocktail prestige avec offre -20%",
    type: "invitation",
    tone: "luxe",
    salonName: "Maison Salonia",
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.tone, "luxe");
    assert.equal(valid.data.type, "invitation");
  }

  // Refus d'un prompt trop court
  const tooShort = GenerateStudioPromptSchema.safeParse({
    prompt: "ab",
    type: "poster",
  });
  assert.equal(tooShort.success, false);

  // Valeurs par défaut
  const defaults = GenerateStudioPromptSchema.safeParse({
    prompt: "Affiche pour la fête des mères avec soins offerts",
  });
  assert.equal(defaults.success, true);
  if (defaults.success) {
    assert.equal(defaults.data.type, "poster");
    assert.equal(defaults.data.tone, "luxe");
  }
});

test("Studio AI — Moteur heuristique de conception d'affiches", () => {
  // 1. Soirée VIP Champagne
  const vipTemplate = generateHeuristicTemplate({
    prompt: "Soirée privée VIP champagne avec réduction -20% sur les forfaits",
    type: "invitation",
    tone: "luxe",
    salonName: "Institut Royal",
  });

  const validVip = GeneratedStudioTemplateSchema.safeParse(vipTemplate);
  assert.equal(validVip.success, true);
  assert.equal(vipTemplate.template, "modern_promo"); // Détecte la promotion/réduction
  assert.match(vipTemplate.discount, /-20%\s?REMISE/i);
  assert.equal(vipTemplate.aspectRatio, "story"); // invitation -> story
  assert.match(vipTemplate.colorPalette.primary, /^#[0-9a-fA-F]{6}$/);
  assert.match(vipTemplate.colorPalette.secondary, /^#[0-9a-fA-F]{6}$/);

  // 2. Journée Zen & Spa
  const zenTemplate = generateHeuristicTemplate({
    prompt: "Journée portes ouvertes bien-être et relaxation naturelle",
    type: "poster",
    tone: "minimaliste",
    salonName: "Spa Émeraude",
  });
  assert.equal(zenTemplate.aspectRatio, "square");
  assert.equal(zenTemplate.template, "beauty_day");
  assert.equal(zenTemplate.fontFamily, "inter");
  assert.equal(zenTemplate.colorPalette.primary, "#10b981");

  // 3. Ambiance Orientale
  const orientalTemplate = generateHeuristicTemplate({
    prompt: "Mise en beauté mariée orientale et henné traditionnel",
    type: "invitation",
    tone: "oriental",
    salonName: "Sultana Beauté",
  });
  assert.equal(orientalTemplate.fontFamily, "cairo");
  assert.equal(orientalTemplate.colorPalette.primary, "#d97706");
});

test("Studio AI — generateStudioTemplateWithAI retourne un résultat valide", async () => {
  const result = await generateStudioTemplateWithAI({
    prompt: "Grande inauguration de notre salon de coiffure chic au Lac 2 avec cocktail de bienvenue",
    type: "poster",
    tone: "luxe",
    salonName: "Salonia Prestige",
  });

  const validated = GeneratedStudioTemplateSchema.safeParse(result);
  assert.equal(validated.success, true);
  assert.ok(result.title.length > 0);
  assert.ok(result.colorPalette.primary.startsWith("#"));
  assert.ok(result.colorPalette.secondary.startsWith("#"));
});

test("Studio AI — Prise en compte de la photo d'arrière-plan et des couleurs préférées", () => {
  const custom = generateHeuristicTemplate({
    prompt: "Soirée prestige avec photo personnalisée",
    type: "invitation",
    tone: "luxe",
    salonName: "Institut Royal",
    aspectRatio: "landscape",
    preferredPrimaryColor: "#ff0077",
    preferredSecondaryColor: "#110022",
    bgPhoto: "data:image/webp;base64,mockCustomBgPhoto",
  });

  assert.equal(custom.aspectRatio, "landscape");
  assert.equal(custom.colorPalette.primary, "#ff0077");
  assert.equal(custom.colorPalette.secondary, "#110022");
  assert.equal(custom.bgPhoto, "data:image/webp;base64,mockCustomBgPhoto");
});

test("Studio AI — Génération de variations créatives différentes (variationIndex)", () => {
  const var0 = generateHeuristicTemplate({
    prompt: "Soirée VIP avec champagne et cocktail",
    type: "invitation",
    tone: "luxe",
    salonName: "Institut Royal",
    variationIndex: 0,
  });

  const var1 = generateHeuristicTemplate({
    prompt: "Soirée VIP avec champagne et cocktail",
    type: "invitation",
    tone: "luxe",
    salonName: "Institut Royal",
    variationIndex: 1,
  });

  // Les deux variations doivent avoir des titres ou des palettes/typographies distinctes
  assert.notEqual(var0.title, var1.title);
  assert.notEqual(var0.colorPalette.primary, var1.colorPalette.primary);
});

test("Studio AI — Fidélité sémantique du texte utilisateur (titre et sous-titre)", () => {
  const result = generateHeuristicTemplate({
    prompt: "Offre spéciale rentrée beauté avec -30% sur tous les soins visages et forfaits coloration ce week-end",
    type: "poster",
    tone: "moderne",
    salonName: "Salonia Prestige",
  });

  assert.match(result.title, /Rentrée Beauté/i);
  assert.match(result.subtitle, /soins visages/i);
  assert.match(result.discount, /-30%\s?REMISE/i);
  assert.match(result.date, /Ce week-end/i);
});



