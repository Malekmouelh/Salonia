"use client";

import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtMoney } from "@/lib/booking/format";

// Histogramme du chiffre d'affaires (une seule série). Les jours prévus (IA) sont hachurés
// et légendés : la prévision se distingue par la texture, pas par une seconde couleur.

export type ChartPoint = { key: string; value: number; predicted?: boolean; label?: string };

function niceMax(v: number) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v / 4)! * pow;
  return Math.ceil(v / step) * step;
}

const compact = (v: number) => (v >= 1000 ? `${Math.round((v / 1000) * 10) / 10}K` : String(Math.round(v)));

export function RevenueChart({ points, height = 220, caption }: { points: ChartPoint[]; height?: number; caption: string }) {
  const { t, lang } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hasForecast = points.some((p) => p.predicted);
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const W = 720;
  const pad = { top: 12, right: 8, bottom: 26, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => pad.top + innerH - (Math.max(v, 0) / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(points.length / 8);
  const label = (p: ChartPoint) => p.label ?? fmtDay(p.key, lang, { day: "numeric", month: "short" });
  const active = hover !== null ? points[hover] : null;

  return (
    <figure>
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
        <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={caption} onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#e8b4a0" fillOpacity="0.18" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#e8b4a0" strokeWidth="2" strokeOpacity="0.75" />
            </pattern>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke="white" strokeOpacity="0.07" />
              <text x={pad.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="white" fillOpacity="0.45" className="tabular-nums">
                {compact(v)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = pad.left + i * slot + (slot - barW) / 2;
            const top = y(p.value);
            const h = pad.top + innerH - top;
            const r = Math.min(4, barW / 2, h);
            // Coins arrondis au bout de la barre, carrés sur la ligne de base.
            const d = h <= 0 ? "" : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
            return (
              <g key={p.key}>
                {d && <path d={d} fill={p.predicted ? `url(#${hatch})` : "#e8b4a0"} opacity={hover === null || hover === i ? 1 : 0.55} />}
                <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.45">
                    {label(p)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
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
      <figcaption className="sr-only">{caption}</figcaption>
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
