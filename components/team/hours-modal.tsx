"use client";

import { useId, useState, useTransition } from "react";
import { saveStaffHoursAction } from "@/app/actions/team";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import { WORKING_DAYS, centerWeek, parseStoredHours, serializeHours, type StoredWorkingHours, type WeekHours, type WorkingDay } from "@/lib/team/hours";

const fieldClass =
  "rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white outline-none transition focus:border-rose-gold/60 focus:bg-white/[0.08]";

type Mode = "center" | "off" | "range";
type DayState = { mode: Mode; open: string; close: string };
const DEFAULT_RANGE = { open: "09:00", close: "17:00" };

// F4 — Horaires de travail individuels d'un employé : trois états par jour (comme le centre, repos, plage horaire).
// Monté seulement quand il est ouvert : l'état d'édition repart des horaires enregistrés à chaque ouverture.
export function HoursModal({
  member,
  onClose,
  onSaved,
}: {
  member: { id: string; firstName: string; lastName: string; workingHours: StoredWorkingHours | null };
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<Record<WorkingDay, DayState>>(() => {
    const week = parseStoredHours(member.workingHours);
    return Object.fromEntries(
      WORKING_DAYS.map((d) => {
        const h = week[d];
        return [d, h.mode === "range" ? { mode: "range", open: h.open, close: h.close } : { mode: h.mode, ...DEFAULT_RANGE }];
      }),
    ) as Record<WorkingDay, DayState>;
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);

  const setDay = (day: WorkingDay, patch: Partial<DayState>) => setDays((s) => ({ ...s, [day]: { ...s[day], ...patch } }));
  const resetAll = () => setDays((s) => Object.fromEntries(WORKING_DAYS.map((d) => [d, { ...s[d], mode: "center" }])) as Record<WorkingDay, DayState>);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const week: WeekHours = centerWeek();
    for (const d of WORKING_DAYS) {
      const s = days[d];
      week[d] = s.mode === "range" ? { mode: "range", open: s.open, close: s.close } : { mode: s.mode };
    }
    startTransition(async () => {
      const r = await saveStaffHoursAction(member.id, serializeHours(week));
      if (r.ok) {
        onSaved(r.message ?? "Horaires enregistrés.");
        onClose();
      } else {
        setErrors(r.errors ?? {});
        setMessage(r.message ?? (r.errors?.workingHours?.[0] ?? null));
      }
    });
  };

  return (
    <Modal open onClose={onClose} title={`${t("Horaires de travail")} · ${member.firstName} ${member.lastName}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {message && (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t(message)}
          </p>
        )}

        <ul className="space-y-2">
          {WORKING_DAYS.map((d) => {
            const s = days[d];
            const error = errors[`workingHours.${d}`]?.[0];
            return (
              <li key={d} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label htmlFor={`${uid}-${d}`} className="w-24 shrink-0 text-sm capitalize text-white">{t(d)}</label>
                  <select
                    id={`${uid}-${d}`}
                    value={s.mode}
                    onChange={(e) => setDay(d, { mode: e.target.value as Mode })}
                    className={`${fieldClass} min-w-[10rem] flex-1`}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${uid}-${d}-error` : undefined}
                  >
                    <option value="center">{t("Comme le centre")}</option>
                    <option value="off">{t("Repos")}</option>
                    <option value="range">{t("Plage horaire")}</option>
                  </select>
                </div>
                {s.mode === "range" && (
                  <div className="mt-2 flex items-center gap-2" dir="ltr">
                    <input type="time" step={900} aria-label={`${t(d)} · ${t("Début")}`} value={s.open} onChange={(e) => setDay(d, { open: e.target.value })} className={fieldClass} />
                    <span className="text-white/40">→</span>
                    <input type="time" step={900} aria-label={`${t(d)} · ${t("Fin")}`} value={s.close} onChange={(e) => setDay(d, { close: e.target.value })} className={fieldClass} />
                  </div>
                )}
                {error && (
                  <p id={`${uid}-${d}-error`} role="alert" className="mt-1.5 text-xs text-red-300">{t(error)}</p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="space-y-1 text-xs text-white/45">
          <p>{t("Un horaire ne peut pas passer minuit.")}</p>
          <p>{t("Pour le moment, ces horaires sont enregistrés mais n'affectent pas encore les créneaux de réservation.")}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" onClick={resetAll} className="text-xs text-rose-gold hover:text-champagne">{t("Tout comme le centre")}</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Annuler")}</button>
            <button type="submit" disabled={pending} className="btn-shine rounded-xl px-5 py-2.5 text-sm font-semibold text-plum-950 disabled:cursor-wait disabled:opacity-70">
              {pending ? t("Un instant…") : t("Enregistrer")}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
