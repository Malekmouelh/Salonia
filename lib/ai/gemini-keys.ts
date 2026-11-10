// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/ai/gemini-keys.ts — PLUSIEURS CLÉS GEMINI (celles des membres de l'équipe)
// ═══════════════════════════════════════════════════════════════════════════
// Chaque clé gratuite a son propre quota. On en déclare plusieurs dans .env :
//   GEMINI_API_KEY="…"  GEMINI_API_KEY_2="…"  GEMINI_API_KEY_3="…"  (jusqu'à _9)
//   ou GEMINI_API_KEYS="clé1,clé2,clé3"
// Les appels sont répartis entre les clés (tour à tour) ; si une clé est en quota dépassé (429) ou
// refusée (400 clé invalide, 401, 403), on réessaie aussitôt avec la suivante.
// Une surcharge du modèle (503) ne dépend pas de la clé : elle est renvoyée telle quelle (l'appelant
// passe alors à un autre modèle ou au mode hors ligne).
// Les clés ne sont jamais journalisées ni renvoyées au navigateur.
// ═══════════════════════════════════════════════════════════════════════════

type Env = Record<string, string | undefined>;

// Toutes les clés configurées, sans doublon, dans l'ordre de déclaration.
export function geminiKeys(env: Env = process.env): string[] {
  const numbered = Array.from({ length: 8 }, (_, i) => env[`GEMINI_API_KEY_${i + 2}`]);
  const listed = (env.GEMINI_API_KEYS ?? "").split(",");
  return [...new Set([env.GEMINI_API_KEY, ...numbered, ...listed].map((k) => k?.trim() ?? "").filter(Boolean))];
}

// Codes HTTP pour lesquels une AUTRE clé peut réussir.
const KEY_SPECIFIC = new Set([400, 401, 403, 429]);
let cursor = 0;

// Envoie la requête avec une clé, puis avec les suivantes si l'erreur vient de la clé.
// `init(key)` construit la requête pour une clé donnée. Renvoie la dernière réponse obtenue.
export async function fetchWithGeminiKeys(url: string, init: (key: string) => RequestInit, env: Env = process.env): Promise<Response> {
  const keys = geminiKeys(env);
  if (keys.length === 0) throw new Error("Aucune clé Gemini configurée.");
  const start = cursor++ % keys.length; // répartition tour à tour entre les clés
  let last: Response | undefined;
  for (let i = 0; i < keys.length; i++) {
    const res = await fetch(url, init(keys[(start + i) % keys.length]));
    // 400 : seulement s'il s'agit d'une clé invalide (pas d'une requête mal formée, qui échouerait partout).
    const keyProblem = KEY_SPECIFIC.has(res.status) && (res.status !== 400 || /API_KEY_INVALID|API key not valid/i.test(await res.clone().text()));
    if (!keyProblem) return res;
    last = res;
  }
  return last!;
}
