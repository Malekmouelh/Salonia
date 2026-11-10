// F4 — Affectation intelligente du praticien : classement PUR (aucun accès base), testable.
// Le service construit les candidats, l'IA (Gemini) peut réordonner et expliquer, mais seulement parmi les candidats
// ÉLIGIBLES (aucun conflit sur le créneau). Elle propose, l'utilisateur décide : rien n'est affecté automatiquement.
// Aucun lien avec le moteur de réservation : le contrôle de disponibilité de lib/booking/ reste seul juge à la création.

export const MAX_CANDIDATES = 8;
const WEEK_CAPACITY_MINUTES = 6 * 8 * 60; // lundi-samedi, 8 h par jour

export type Conflict = "none" | "booking" | "block" | "timeoff";

export type Candidate = {
  id: string;
  label: string; // « A », « B »… : seul identifiant envoyé à l'IA (jamais le nom)
  skillMatch: number | null; // part des compétences exigées possédées (0..1) ; null = aucune compétence exigée
  conflict: Conflict;
  loadMinutes: number; // minutes de rendez-vous des 7 prochains jours
  performance: number | null; // note de référence 0..100 des 30 derniers jours (sans IA) ; null = inconnue
};

export type RankedCandidate = Candidate & { score: number; eligible: boolean };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Part des compétences exigées que l'employé possède (insensible à la casse). null si rien n'est exigé.
export function skillMatch(required: readonly string[], owned: readonly string[]): number | null {
  const need = [...new Set(required.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (need.length === 0) return null;
  const have = new Set(owned.map((s) => s.trim().toLowerCase()));
  return Math.round((need.filter((s) => have.has(s)).length / need.length) * 100) / 100;
}

// Score 0-100 : compétences 40, charge de la semaine 30 (moins chargé = mieux), performance 30. Non éligible (conflit) : 0.
export function scoreCandidate(c: Candidate): number {
  if (c.conflict !== "none") return 0;
  const skills = (c.skillMatch ?? 1) * 40;
  const load = (1 - Math.min(1, c.loadMinutes / WEEK_CAPACITY_MINUTES)) * 30;
  const perf = ((c.performance ?? 60) / 100) * 30;
  return clamp(skills + load + perf);
}

// Classement de référence : éligibles d'abord, puis score décroissant, puis ordre d'origine (stable).
export function rankCandidates(candidates: readonly Candidate[]): RankedCandidate[] {
  return candidates
    .slice(0, MAX_CANDIDATES)
    .map((c, i) => ({ c: { ...c, score: scoreCandidate(c), eligible: c.conflict === "none" }, i }))
    .sort((a, b) => Number(b.c.eligible) - Number(a.c.eligible) || b.c.score - a.c.score || a.i - b.i)
    .map((x) => x.c);
}

// Chevauchement de deux plages [start, end[.
export function overlapsRange(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
