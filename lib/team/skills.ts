// F4 — Compétences des employés : texte libre, comparé sans casse ni accents.
// Fonctions pures (aucun accès à la base) : utilisables côté serveur comme côté client.

export const MAX_SKILL_LENGTH = 40;
export const MAX_SKILLS = 20;

// Libellé affiché : espaces superflus retirés, casse et accents conservés.
export function cleanSkill(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

// Clé de comparaison : « Épilation  Cire » et « epilation cire » ont la même clé.
export function skillKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Retire les doublons (même clé) et les valeurs vides ; garde le libellé de la première occurrence.
export function normalizeSkills(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const label = cleanSkill(value);
    const key = skillKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

// Suggestions à partir des compétences déjà exigées par les services (Service.requiredSkills).
// Une suggestion par clé, triée par fréquence décroissante puis par ordre alphabétique.
export function buildSkillSuggestions(
  lists: readonly (readonly string[])[],
  options: { query?: string; exclude?: readonly string[]; limit?: number } = {},
) {
  const { query = "", exclude = [], limit = 10 } = options;
  const excluded = new Set(exclude.map(skillKey));
  const wanted = skillKey(query);

  const found = new Map<string, { label: string; count: number }>();
  for (const list of lists) {
    // Une compétence répétée dans un même service ne compte qu'une fois.
    for (const label of normalizeSkills(list)) {
      const key = skillKey(label);
      const entry = found.get(key);
      if (entry) entry.count += 1;
      else found.set(key, { label, count: 1 });
    }
  }

  return [...found.entries()]
    .filter(([key]) => !excluded.has(key) && (!wanted || key.includes(wanted)))
    .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, "fr"))
    .slice(0, Math.max(0, limit))
    .map(([, entry]) => entry.label);
}
