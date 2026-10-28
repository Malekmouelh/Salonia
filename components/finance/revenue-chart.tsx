"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/revenue-chart.tsx — LE GRAPHIQUE DU CHIFFRE D'AFFAIRES
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE : dessine un histogramme (diagramme en barres verticales), SANS bibliothèque de graphiques :
//   c'est du SVG écrit à la main. SVG = « Scalable Vector Graphics », un format d'image décrit par des
//   formes (rectangles, lignes, chemins, texte) qui restent nettes à toute taille.
//
// POURQUOI SANS BIBLIOTHÈQUE ? Pour garder un code léger, entièrement maîtrisé, et expliquable.
//
// SYSTÈME DE COORDONNÉES SVG : comme en PDF mais l'origine (0,0) est en HAUT à gauche et y augmente
//   vers le BAS. C'est pour cela que la fonction `y(valeur)` « inverse » la hauteur (une grande valeur
//   donne un petit y, donc une barre qui monte).
//
// ACCESSIBILITÉ : le graphique a une description (`aria-label`), et un tableau de données équivalent est
//   disponible sous « Voir les données » (pour les lecteurs d'écran et pour qui veut les chiffres exacts).
// ═══════════════════════════════════════════════════════════════════════════

import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtMoney } from "@/lib/booking/format";

// Histogramme du chiffre d'affaires (une seule série). Les jours prévus (IA) sont hachurés
// et légendés : la prévision se distingue par la texture, pas par une seconde couleur.
// (Choix volontaire : une texture hachurée reste lisible même pour les personnes daltoniennes.)

// Un point du graphique : clé (le jour), valeur en DT, et « prévu par l'IA ? ».
export type ChartPoint = { key: string; value: number; predicted?: boolean; label?: string };

// « Joli maximum » de l'axe vertical : arrondit au-dessus à une valeur ronde (100, 250, 500, 1000…)
// pour obtenir des graduations lisibles. Exemple : 1 830 → 2 000.
function niceMax(v: number) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v)); // puissance de 10 de même ordre (1 830 → 1 000)
  // Pas de graduation : le plus petit parmi 1, 2, 2,5, 5, 10 (× la puissance) qui donne ≤ 4 graduations.
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v / 4)! * pow;
  return Math.ceil(v / step) * step;
}

// Format court pour l'axe : 2 500 → « 2.5K ».
const compact = (v: number) => (v >= 1000 ? `${Math.round((v / 1000) * 10) / 10}K` : String(Math.round(v)));

export function RevenueChart({ points, height = 220, caption }: { points: ChartPoint[]; height?: number; caption: string }) {
  const { t, lang } = useI18n();
  // Barre actuellement survolée (index) ou null : sert à afficher l'infobulle.
  const [hover, setHover] = useState<number | null>(null);
  // Identifiant UNIQUE du motif hachuré. Deux graphiques sur la même page (CA + prévision) ne doivent pas
  // partager le même `id`, sinon ils se perturbent. `useId` en fournit un différent à chaque instance.
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hasForecast = points.some((p) => p.predicted);
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));

  // ── Géométrie du dessin ──
  const W = 720; // largeur logique du dessin (le SVG s'adapte ensuite à la largeur de l'écran)
  const pad = { top: 12, right: 8, bottom: 26, left: 40 }; // marges (à gauche : place pour l'axe, en bas : pour les dates)
  const innerW = W - pad.left - pad.right; // largeur de la zone de tracé
  const innerH = height - pad.top - pad.bottom; // hauteur de la zone de tracé
  const slot = innerW / Math.max(points.length, 1); // largeur allouée à chaque barre
  const barW = Math.min(24, Math.max(2, slot - 2)); // largeur d'une barre : 24 max, 2 min (fines = plus élégant)
  // Convertit une valeur en DT en coordonnée verticale (règle de trois : 0 → bas, max → haut).
  const y = (v: number) => pad.top + innerH - (Math.max(v, 0) / max) * innerH;
  const ticks = [0, max / 2, max]; // 3 graduations : 0, la moitié, le max
  const labelEvery = Math.ceil(points.length / 8); // on n'écrit qu'une date sur N pour éviter le chevauchement
  const label = (p: ChartPoint) => p.label ?? fmtDay(p.key, lang, { day: "numeric", month: "short" });
  const active = hover !== null ? points[hover] : null; // point survolé

  return (
    // <figure> : élément HTML sémantique pour une illustration.
    <figure>
      {/* Légende : affichée seulement s'il y a des jours prévus (distingue « encaissé » de « prévision IA »). */}
      {hasForecast && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-white/60">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-gold" /> {t("Encaissé")}</span>
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="2" fill={`url(#${hatch})`} stroke="#e8b4a0" strokeOpacity="0.6" /></svg>
            {t("Prévision IA")}
          </span>
        </div>
      )}
      <div className="relative">
        {/* Le dessin. `viewBox` définit le système de coordonnées interne ; `h-auto w-full` le rend « responsive ». */}
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={caption} onMouseLeave={() => setHover(null)}>
          {/* <defs> : ressources réutilisables. Ici le MOTIF HACHURÉ : un petit carré de 6 px avec un trait,
              tourné de 45°, répété pour remplir les barres « prévision ». */}
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#e8b4a0" fillOpacity="0.18" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#e8b4a0" strokeWidth="2" strokeOpacity="0.75" />
            </pattern>
          </defs>
          {/* Lignes de graduation horizontales + valeur de l'axe (0, moitié, max). */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke="white" strokeOpacity="0.07" />
              <text x={pad.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="white" fillOpacity="0.45" className="tabular-nums">
                {compact(v)}
              </text>
            </g>
          ))}
          {/* Une barre par point. */}
          {points.map((p, i) => {
            const x = pad.left + i * slot + (slot - barW) / 2; // abscisse (centrée dans son emplacement)
            const top = y(p.value); // ordonnée du sommet de la barre
            const h = pad.top + innerH - top; // hauteur de la barre
            const r = Math.min(4, barW / 2, h); // rayon d'arrondi des coins du haut (max 4 px)
            // Coins arrondis au bout de la barre, carrés sur la ligne de base.
            // La barre est un « chemin » SVG : M = déplacer le crayon, V/H = trait vertical/horizontal,
            // Q = courbe (le coin arrondi), Z = fermer la forme.
            const d = h <= 0 ? "" : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
            return (
              <g key={p.key}>
                {/* La barre : hachurée si prévue, pleine sinon. Quand une autre barre est survolée, celle-ci s'estompe (opacité 55 %). */}
                {d && <path d={d} fill={p.predicted ? `url(#${hatch})` : "#e8b4a0"} opacity={hover === null || hover === i ? 1 : 0.55} />}
                {/* Zone de survol INVISIBLE, plus large que la barre : facilite le survol des barres fines. */}
                <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
                {/* Date sous la barre (une sur `labelEvery`). */}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45">
                    {label(p)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {/* Infobulle : date + montant du jour survolé, positionnée en % de la largeur au-dessus de la barre. */}
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-plum-950/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: `${((pad.left + (hover + 0.5) * slot) / W) * 100}%` }}
          >
            <p className="text-white/55">{label(active)}</p>
            <p className="font-semibold text-white">
              {fmtMoney(active.value, lang)} {active.predicted && <span className="font-normal text-white/50">· {t("prévision")}</span>}
            </p>
          </div>
        )}
      </div>
      {/* Légende textuelle pour les lecteurs d'écran (`sr-only` = invisible à l'écran). */}
      <figcaption className="sr-only">{caption}</figcaption>
      {/* Alternative textuelle : le même contenu sous forme de tableau, repliable (<details>). */}
      <details className="mt-2 text-xs text-white/45">
        <summary className="cursor-pointer select-none hover:text-white/70">{t("Voir les données")}</summary>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-white/[0.03] p-2">
          <table className="w-full tabular-nums">
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-b border-white/5 last:border-0">
                  <td className="py-1 text-white/60">{label(p)}{p.predicted ? ` (${t("prévision")})` : ""}</td>
                  <td className="py-1 text-end text-white/80">{fmtMoney(p.value, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
