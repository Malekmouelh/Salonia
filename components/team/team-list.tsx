"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import { CalendarIcon, ClockIcon, PinIcon, PlusIcon, UserIcon } from "@/components/ui/icons";
import { Toast } from "@/components/ui/modal";
import type { TeamRoster } from "@/lib/data/team";
import { WORKING_DAYS } from "@/lib/team/hours";
import type { TimeOffSummary } from "@/lib/team/timeoff";
import { HoursModal } from "./hours-modal";
import { StaffModal } from "./staff-modal";
import { TimeOffModal } from "./timeoff-modal";

const MAX_SKILLS_SHOWN = 6;

// F4 — Liste de l'équipe (lecture seule) : une carte par membre du personnel.
export function TeamList({ roster, skillSuggestions }: { roster: TeamRoster; skillSuggestions: string[] }) {
  const { t } = useI18n();
  const { centers, selectedCenterId, members } = roster;
  const [adding, setAdding] = useState(false);
  const [editingHoursId, setEditingHoursId] = useState<string | null>(null);
  const editingHours = members.find((m) => m.id === editingHoursId) ?? null;
  const [editingTimeOffId, setEditingTimeOffId] = useState<string | null>(null);
  const editingTimeOff = members.find((m) => m.id === editingTimeOffId) ?? null;
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="mt-6 space-y-4">
      {centers.length > 0 && (
        <div className="flex justify-end animate-fade-up">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-shine flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950"
          >
            <PlusIcon width={16} height={16} /> {t("Ajouter un membre")}
          </button>
        </div>
      )}
      {adding && (
        <StaffModal
          centers={centers}
          defaultCenterId={selectedCenterId}
          suggestions={skillSuggestions}
          onClose={() => setAdding(false)}
          onCreated={setToast}
        />
      )}
      {editingHours && <HoursModal member={editingHours} onClose={() => setEditingHoursId(null)} onSaved={setToast} />}
      {editingTimeOff && <TimeOffModal member={editingTimeOff} onClose={() => setEditingTimeOffId(null)} onChanged={setToast} />}
      {toast && <Toast tone="success" onDone={() => setToast(null)}>{t(toast)}</Toast>}
      {centers.length > 1 && (
        <nav aria-label={t("Choisir un centre")} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] animate-fade-up [animation-delay:0.05s]">
          <div className="inline-flex gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1.5">
            {[{ id: null as string | null, name: t("Tous les centres") }, ...centers].map((c) => {
              const active = c.id === selectedCenterId;
              return (
                <Link
                  key={c.id ?? "all"}
                  href={c.id ? `/dashboard/equipe?center=${c.id}` : "/dashboard/equipe"}
                  scroll={false}
                  replace
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition-all duration-300 ${
                    active
                      ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {c.id && <PinIcon width={15} height={15} />}
                  {c.name}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {members.length === 0 ? (
        <p className="glass rounded-[2rem] p-10 text-center text-white/50">{t("Aucun membre du personnel pour l'instant.")}</p>
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <article key={m.id} className="glass rounded-3xl p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blush/80 to-champagne/80 text-sm font-semibold text-plum-950">
                  {`${m.firstName[0] ?? ""}${m.lastName[0] ?? ""}`.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate font-medium text-white">{m.firstName} {m.lastName}</h2>
                  <p className={`truncate text-xs ${m.jobTitle ? "text-white/55" : "text-white/35"}`}>{m.jobTitle ?? t("Poste non renseigné")}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">{t("Compétences")}</p>
                {m.skills.length === 0 ? (
                  <p className="text-xs text-white/35">{t("Aucune compétence renseignée")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {m.skills.slice(0, MAX_SKILLS_SHOWN).map((s) => (
                      <li key={s} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white/80">{s}</li>
                    ))}
                    {m.skills.length > MAX_SKILLS_SHOWN && (
                      <li className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] text-white/50" dir="ltr">+{m.skills.length - MAX_SKILLS_SHOWN}</li>
                    )}
                  </ul>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/55">
                {m.centers.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5"><PinIcon width={13} height={13} />{c.name}</span>
                ))}
                {m.hasCustomHours && (
                  <span className="flex items-center gap-1.5 text-champagne"><ClockIcon width={13} height={13} />{t("Horaires personnalisés")}</span>
                )}
              </div>

              {m.workingHours && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {WORKING_DAYS.filter((d) => d in m.workingHours!).map((d) => (
                    <li key={d} className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] text-white/65">
                      <span className="capitalize">{t(d)}</span> · <span dir="ltr">{m.workingHours![d] ?? t("Repos")}</span>
                    </li>
                  ))}
                </ul>
              )}

              <TimeOffLines current={m.timeOff.current} next={m.timeOff.next} />

              <div className="mt-4 border-t border-white/10 pt-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingHoursId(m.id)}
                    disabled={!m.canEditHours}
                    className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-white/70"
                  >
                    <ClockIcon width={13} height={13} /> {t("Horaires")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTimeOffId(m.id)}
                    disabled={!m.canEditHours}
                    className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-white/70"
                  >
                    <CalendarIcon width={13} height={13} /> {t("Absences")}
                  </button>
                  <Link
                    href={`/dashboard/planning?staff=${m.id}`}
                    className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
                  >
                    <UserIcon width={13} height={13} /> {t("Planning")}
                  </Link>
                </div>
                {!m.canEditHours && (
                  <p className="mt-1.5 text-[11px] text-white/45">{t("Ce membre travaille aussi dans un centre que vous ne gérez pas : seul le propriétaire peut modifier ses horaires et ses absences.")}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// Résumé en lecture seule des absences d'un employé : en cours, puis prochaine. Jamais de motif.
function TimeOffLines({ current, next }: { current: TimeOffSummary | null; next: TimeOffSummary | null }) {
  const { t, lang } = useI18n();
  if (!current && !next) return null;
  const day = (iso: string) => fmtDay(iso, lang, { day: "numeric", month: "short" });

  let currentText: string | null = null;
  if (current) {
    // La fin d'une journée complète est exclusive (minuit suivant) : on affiche le dernier jour inclus.
    const until = current.allDay ? day(new Date(new Date(current.end).getTime() - 1).toISOString()) : fmtTime(current.end, lang);
    const label =
      current.kind === "LEAVE"
        ? current.allDay ? "En congé jusqu'au" : "En congé jusqu'à"
        : current.allDay ? "Absent(e) jusqu'au" : "Absent(e) jusqu'à";
    currentText = `${t(label)} ${until}`;
  }
  let nextText: string | null = null;
  if (next) {
    const when = next.allDay ? day(next.start) : `${day(next.start)} · ${fmtTime(next.start, lang)}`;
    nextText = `${t(next.kind === "LEAVE" ? "Prochain congé :" : "Prochaine absence :")} ${when}`;
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {currentText && <li className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] text-amber-200">{currentText}</li>}
      {nextText && <li className="rounded-full bg-white/5 px-2.5 py-0.5 text-[11px] text-white/65">{nextText}</li>}
    </ul>
  );
}
