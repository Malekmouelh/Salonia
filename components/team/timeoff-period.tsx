import type { TimeOffPeriodParts } from "@/lib/team/timeoff-period";

// F4 — Affichage de la période d'une absence, sans direction imposée : chaque date est isolée dans un <bdi>
// (son sens suit sa propre langue), les heures sont isolées en gauche-à-droite, et la flèche est inversée en RTL
// (variante rtl:, comme les autres flèches du projet). L'ordre des éléments suit le sens de la page : en arabe la première
// date est à droite et la flèche pointe vers la gauche.
export function TimeOffPeriod({ parts }: { parts: TimeOffPeriodParts }) {
  const arrow = <span className="inline-block text-white/40 rtl:-scale-x-100">→</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <bdi>{parts.dates[0]}</bdi>
      {parts.dates[1] && (
        <>
          {arrow}
          <bdi>{parts.dates[1]}</bdi>
        </>
      )}
      {parts.times && (
        <>
          <span aria-hidden="true" className="text-white/40">·</span>
          <bdi dir="ltr">{parts.times[0]}</bdi>
          {arrow}
          <bdi dir="ltr">{parts.times[1]}</bdi>
        </>
      )}
    </span>
  );
}
