"use client";

import { useEffect, useState } from "react";
import { analyzeStaffPerformanceAction } from "@/app/actions/team";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import type { PerformanceReport } from "@/lib/ai/team-performance";

const GRADE_TONE = { A: "text-emerald-300", B: "text-champagne", C: "text-amber-300", D: "text-red-300" } as const;

// F4 — Performance d'un employé : indicateurs des 30 derniers jours et note proposée par l'IA (Gemini).
// L'IA PROPOSE : rien n'est enregistré. Monté seulement quand il est ouvert : l'analyse part à l'ouverture.
export function PerformanceModal({ member, onClose }: { member: { id: string; firstName: string; lastName: string }; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    analyzeStaffPerformanceAction(member.id, lang)
      .then((r) => {
        if (!alive) return;
        if (r.ok) setReport(r.report);
        else setError(r.message);
      })
      .catch(() => alive && setError("Impossible d'analyser la performance. Réessayez."));
    return () => {
      alive = false;
    };
  }, [member.id, lang]);

  const ind = report?.indicators;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  const stats: [string, string][] = ind
    ? [
        ["Rendez-vous réalisés", String(ind.completed)],
        ["Annulés / absents", `${ind.cancelled} / ${ind.noShow}`],
        ["Chiffre d'affaires", `${ind.revenueTnd} TND`],
        ["Panier moyen", ind.avgTicketTnd === null ? "—" : `${ind.avgTicketTnd} TND`],
        ["Présence", pct(ind.presenceRate)],
        ["Occupation", pct(ind.occupancyRate)],
        ["Clients uniques", String(ind.uniqueClients)],
        ["Clients fidèles", pct(ind.returningClientsRate)],
      ]
    : [];

  return (
    <Modal open onClose={onClose} title={`${t("Performance")} · ${member.firstName} ${member.lastName}`} wide>
      {!report && !error && <p role="status" className="py-10 text-center text-sm text-white/60">{t("Analyse en cours…")}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{t(error)}</p>}
      {report && ind && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5">
              <span className="font-display text-3xl text-white" dir="ltr">{report.overall ?? "—"}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-white/45">{t("Note globale")} / 100</p>
              {report.grade && <p className={`font-display text-2xl ${GRADE_TONE[report.grade]}`}>{report.grade}</p>}
              <p className="text-[11px] text-white/45">
                {t(report.source === "ai" ? "Proposée par l'IA (Gemini)" : "Calculée sans IA")} · {ind.periodDays} {t("derniers jours")}
              </p>
            </div>
          </div>

          <p className="text-sm text-white/80">{report.summary}</p>

          <ul className="space-y-2">
            {report.criteria.map((c) => (
              <li key={c.key}>
                <div className="flex justify-between text-xs text-white/70">
                  <span>{t(c.label)} <span className="text-white/35" dir="ltr">({c.weight} %)</span></span>
                  <span dir="ltr">{c.score === null ? t("Non mesurable") : `${c.score}/100`}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-blush to-champagne" style={{ width: `${c.score ?? 0}%` }} />
                </div>
              </li>
            ))}
          </ul>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white/5 px-3 py-2">
                <dt className="text-[10px] uppercase tracking-wider text-white/40">{t(label)}</dt>
                <dd className="text-sm text-white" dir="ltr">{value}</dd>
              </div>
            ))}
          </dl>

          {report.strengths.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-white/45">{t("Points forts")}</p>
              <ul className="list-disc space-y-0.5 ps-5 text-sm text-white/75">{report.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {report.improvements.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-white/45">{t("Pistes d'amélioration")}</p>
              <ul className="list-disc space-y-0.5 ps-5 text-sm text-white/75">{report.improvements.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}

          <p className="text-[11px] text-white/40">
            {t("Évaluation indicative : l'IA propose, vous décidez. Seuls des chiffres anonymes sont envoyés (ni nom, ni client, ni motif d'absence).")}
          </p>
        </div>
      )}
      <div className="flex justify-end pt-4">
        <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Fermer")}</button>
      </div>
    </Modal>
  );
}
