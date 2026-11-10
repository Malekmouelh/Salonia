"use client";

import { useEffect, useState } from "react";
import { forecastCenterLoadAction } from "@/app/actions/team";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import type { DayStatus } from "@/lib/team/forecast";
import type { ForecastResult } from "@/lib/team/forecast-service";

const CELL: Record<DayStatus, string> = {
  closed: "bg-white/[0.03] text-white/25",
  uncovered: "bg-red-500/40 text-white",
  overloaded: "bg-red-400/35 text-white",
  busy: "bg-amber-400/30 text-white",
  ok: "bg-emerald-400/20 text-white/80",
  low: "bg-sky-400/20 text-white/80",
};
const LEGEND: [DayStatus, string][] = [["overloaded", "Surchargé"], ["busy", "Chargé"], ["ok", "Normal"], ["low", "Creux"], ["uncovered", "Sans praticien"], ["closed", "Fermé"]];
const KIND_LABEL = { hours: "Horaires", leave: "Congés", staffing: "Équipe", promotion: "Promotion" } as const;

// F4 — Prévision de charge d'un centre sur 4 semaines : calendrier coloré et pistes proposées par l'IA (Gemini).
// Lecture seule : l'IA propose, le gérant décide. Monté seulement quand il est ouvert.
export function ForecastModal({ centers, defaultCenterId, onClose }: { centers: { id: string; name: string }[]; defaultCenterId: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [centerId, setCenterId] = useState(defaultCenterId ?? centers[0]?.id ?? "");
  const [data, setData] = useState<Extract<ForecastResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    forecastCenterLoadAction({ centerId }, lang)
      .then((r) => {
        if (!alive) return;
        if (r.ok) setData(r);
        else setError(r.message);
      })
      .catch(() => alive && setError("Impossible d'analyser la charge. Réessayez."));
    return () => {
      alive = false;
    };
  }, [centerId, lang]);

  const pick = (id: string) => {
    setData(null);
    setError(null);
    setCenterId(id);
  };
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
  const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-TN" : "fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <Modal open onClose={onClose} title={t("Prévision de charge")} wide>
      <div className="space-y-5">
        {centers.length > 1 && (
          <select aria-label={t("Choisir un centre")} value={centerId} onChange={(e) => pick(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white outline-none">
            {centers.map((c) => <option key={c.id} value={c.id} className="bg-plum-900">{c.name}</option>)}
          </select>
        )}
        {!data && !error && <p role="status" className="py-10 text-center text-sm text-white/60">{t("Analyse en cours…")}</p>}
        {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{t(error)}</p>}
        {data && (
          <>
            <p className="text-sm text-white/80">{data.advice.summary}</p>
            <p className="text-[11px] text-white/45">
              {t(data.advice.source === "ai" ? "Proposé par l'IA (Gemini)" : "Calculé sans IA")} · {t("Charge moyenne des 28 jours passés")} : <span dir="ltr">{pct(data.forecast.referenceAvgRate)}</span>
            </p>

            <div className="space-y-1.5" dir="ltr">
              {data.forecast.weeks.map((w) => (
                <div key={w.start} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[10px] text-white/40">{shortDate(w.start)}</span>
                  <div className="grid flex-1 grid-cols-7 gap-1">
                    {Array.from({ length: 7 }, (_, i) => {
                      const date = new Date(new Date(`${w.start}T12:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10);
                      const d = data.forecast.days.find((x) => x.date === date);
                      return (
                        <div key={date} title={d ? `${shortDate(date)} · ${pct(d.rate)}` : shortDate(date)} className={`grid h-9 place-items-center rounded-md text-[10px] ${d ? CELL[d.status] : "opacity-0"}`}>
                          {d && d.status !== "closed" ? pct(d.rate).replace(" %", "") : ""}
                        </div>
                      );
                    })}
                  </div>
                  <span className="w-12 shrink-0 text-end text-[10px] text-white/50">{pct(w.avgRate)}</span>
                </div>
              ))}
            </div>
            <ul className="flex flex-wrap gap-2 text-[11px] text-white/60">
              {LEGEND.map(([s, label]) => (
                <li key={s} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${CELL[s].split(" ")[0]}`} />{t(label)}</li>
              ))}
            </ul>

            {data.advice.recommendations.length > 0 && (
              <ul className="space-y-2">
                {data.advice.recommendations.map((r, i) => (
                  <li key={i} className="rounded-2xl border border-champagne/25 bg-champagne/5 p-3">
                    <p className="text-sm text-white"><span className="me-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-champagne">{t(KIND_LABEL[r.kind])}</span>{r.title}</p>
                    <p className="mt-1 text-xs text-white/70">{r.detail}</p>
                    {r.dates.length > 0 && <p className="mt-1 text-[11px] text-white/45" dir="ltr">{r.dates.map(shortDate).join(" · ")}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-white/40">{t("Prévision indicative : l'IA propose, vous décidez. Horaires d'ouverture du centre ; les horaires individuels ne sont pas pris en compte. Seuls des chiffres anonymes sont envoyés.")}</p>
          </>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Fermer")}</button>
        </div>
      </div>
    </Modal>
  );
}
