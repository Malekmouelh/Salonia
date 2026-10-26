"use client";

import Link from "next/link";
import { STATUS_META, BLOCK_LABELS } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import { addDays, parseDayKey } from "@/lib/booking/time";
import type { StaffPlanning } from "@/lib/data/planning";
import type { PlanningHours } from "@/lib/team/planning";
import { TimeOffPeriod } from "./timeoff-period";

const KIND_LABEL = { LEAVE: "Congé", ABSENCE: "Absence exceptionnelle" } as const;
const arrow = <span className="inline-block text-white/40 rtl:-scale-x-100">→</span>;

// Plage d'heures : chaque heure est isolée en gauche-à-droite, la flèche suit le sens de la page (comme TimeOffPeriod).
function TimeRange({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-x-1.5">
      <bdi dir="ltr">{from}</bdi>
      {arrow}
      <bdi dir="ltr">{to}</bdi>
    </span>
  );
}

function HoursLine({ hours }: { hours: PlanningHours }) {
  const { t } = useI18n();
  if (hours.mode === "off") return <span>{t("Repos")}</span>;
  if (hours.mode === "range") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        {t("Horaires :")} <TimeRange from={hours.open!} to={hours.close!} />
      </span>
    );
  }
  if (hours.center === "closed") return <span>{t("Centre fermé")}</span>;
  if (hours.center) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        {t("Comme le centre :")} <TimeRange from={hours.center.open} to={hours.center.close} />
      </span>
    );
  }
  return <span>{t("Comme le centre")}</span>;
}

// F4 — Planning hebdomadaire (lundi → dimanche, heure de Tunis), en LECTURE SEULE : aucun bouton de modification, de report
// ou d'annulation. Les horaires, absences et pauses sont informatifs (ils ne bloquent pas encore les créneaux).
export function PlanningView({ planning }: { planning: StaffPlanning }) {
  const { t, lang } = useI18n();
  const { staff } = planning;
  const staffQuery = staff.isSelf ? "" : `&staff=${staff.id}`;
  const weekHref = (week: string) => `/dashboard/planning?week=${week}${staffQuery}`;
  const monday = parseDayKey(planning.weekStart)!;
  const sunday = addDays(monday, 6);
  const dayLabel = (d: Date) => fmtDay(d, lang, { day: "numeric", month: "short", year: "numeric" });
  const weekParts = { dates: [dayLabel(monday), dayLabel(sunday)] as [string, string], times: null };
  const navClass = "rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white";
  const multiCenter = planning.centers.length > 1;

  return (
    <div className="mt-6 space-y-5">
      <div className="animate-fade-up">
        {!staff.isSelf && (
          <Link href="/dashboard/equipe" className="mb-3 inline-flex items-center gap-1.5 text-sm text-white/55 transition hover:text-white">
            <span className="inline-block rtl:-scale-x-100">←</span> {t("Équipe")}
          </Link>
        )}
        <h1 className="font-display text-4xl text-white">
          {staff.isSelf ? (
            <span className="text-gradient italic">{t("Mon planning")}</span>
          ) : (
            <>
              <span>{t("Planning")}</span> <span className="text-gradient italic">{staff.firstName} {staff.lastName}</span>
            </>
          )}
        </h1>
        {staff.jobTitle && <p className="mt-1 text-white/55">{staff.jobTitle}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up [animation-delay:0.05s]">
        <div className="flex items-center gap-2">
          <Link href={weekHref(planning.prevWeek)} aria-label={t("Semaine précédente")} className={navClass}>
            <span className="inline-block rtl:-scale-x-100">←</span>
          </Link>
          <p className="min-w-0 px-1 text-sm text-white"><TimeOffPeriod parts={weekParts} /></p>
          <Link href={weekHref(planning.nextWeek)} aria-label={t("Semaine suivante")} className={navClass}>
            <span className="inline-block rtl:-scale-x-100">→</span>
          </Link>
        </div>
        {planning.weekStart !== planning.currentWeek && (
          <Link href={weekHref(planning.currentWeek)} className={navClass}>{t("Cette semaine")}</Link>
        )}
      </div>

      <p className="text-sm text-white/55">
        {planning.bookingCount === 0 ? t("Aucun rendez-vous cette semaine.") : `${planning.bookingCount} ${t("rendez-vous cette semaine")}`}
        {" · "}
        <Link href={`/dashboard/calendar?view=week&date=${planning.weekStart}${staffQuery}`} className="text-rose-gold hover:text-champagne">
          {t("Ouvrir dans le calendrier")}
        </Link>
      </p>

      <ul className="stagger space-y-3">
        {planning.days.map((day) => {
          const date = parseDayKey(day.key)!;
          const isToday = day.key === planning.today;
          return (
            <li key={day.key} className={`glass rounded-[1.75rem] p-5 ${isToday ? "ring-1 ring-rose-gold/50" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="flex items-center gap-2 font-display text-xl capitalize text-white">
                  {fmtDay(date, lang)}
                  {isToday && <span className="rounded-full bg-gradient-to-r from-blush to-champagne px-2.5 py-0.5 font-sans text-[11px] font-semibold normal-case text-plum-950">{t("Aujourd'hui")}</span>}
                </h2>
                <p className="text-xs text-white/50"><HoursLine hours={day.hours} /></p>
              </div>

              {(day.timeOff.length > 0 || day.blocks.length > 0) && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {day.timeOff.map((o) => (
                    <li key={o.id} className={`inline-flex flex-wrap items-center gap-x-1.5 rounded-full px-2.5 py-0.5 text-[11px] ${o.kind === "LEAVE" ? "bg-sky-400/15 text-sky-200" : "bg-amber-400/15 text-amber-200"}`}>
                      {t(KIND_LABEL[o.kind])}
                      {!o.allDay && <TimeRange from={fmtTime(o.start, lang)} to={fmtTime(o.end, lang)} />}
                    </li>
                  ))}
                  {day.blocks.map((b) => (
                    <li key={b.id} className="inline-flex flex-wrap items-center gap-x-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white/70">
                      {t(BLOCK_LABELS[b.kind])}
                      {b.kind !== "CLOSURE" && <TimeRange from={fmtTime(b.start, lang)} to={fmtTime(b.end, lang)} />}
                      {(b.wholeCenter || multiCenter) && <span className="text-white/45">· {b.center}</span>}
                    </li>
                  ))}
                </ul>
              )}

              {day.bookings.length === 0 ? (
                <p className="mt-3 text-sm text-white/40">{t("Aucun rendez-vous ce jour.")}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {day.bookings.map((b) => (
                    <li key={b.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border px-3.5 py-2.5 ${STATUS_META[b.status].card}`}>
                      <span className="w-28 shrink-0 text-sm text-champagne"><TimeRange from={fmtTime(b.start, lang)} to={fmtTime(b.end, lang)} /></span>
                      <div className="min-w-[9rem] flex-1">
                        <p className="break-words text-sm font-medium text-white">{b.customer}</p>
                        <p className="break-words text-xs text-white/50">
                          {b.services}
                          {multiCenter && b.center ? ` · ${b.center}` : ""}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${STATUS_META[b.status].chip}`}>{t(STATUS_META[b.status].label)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-white/45">{t("Les horaires, absences et pauses affichés sont informatifs : ils ne bloquent pas encore les créneaux de réservation.")}</p>
    </div>
  );
}
