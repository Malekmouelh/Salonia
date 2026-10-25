"use client";

import { useEffect, useId, useState, useTransition } from "react";
import {
  createStaffTimeOffAction,
  deleteStaffTimeOffAction,
  listStaffTimeOffAction,
  updateStaffTimeOffAction,
  type ListStaffTimeOffActionResult,
} from "@/app/actions/team";
import { useI18n } from "@/components/i18n/i18n-provider";
import { EditIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { dayKey } from "@/lib/booking/time";
import { TIMEOFF_KINDS, type TimeOffKind } from "@/lib/enums";
import type { StaffTimeOffView } from "@/lib/team/service";
import { MAX_TIMEOFF_REASON, timeOffToForm, type TimeOffMode } from "@/lib/team/timeoff";
import { timeOffPeriodParts, timeOffPeriodText } from "@/lib/team/timeoff-period";
import { TimeOffPeriod } from "./timeoff-period";

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none transition focus:border-rose-gold/60 focus:bg-white/[0.08]";
const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/45";

const KIND_LABEL: Record<TimeOffKind, string> = { LEAVE: "Congé", ABSENCE: "Absence exceptionnelle" };
const MODE_LABEL: Record<TimeOffMode, string> = { days: "Journée(s) complète(s)", range: "Plage horaire" };

type FormValues = { id: string | null; kind: TimeOffKind; mode: TimeOffMode; startDay: string; endDay: string; from: string; to: string; reason: string };
type Errors = Record<string, string[] | undefined>;

const emptyForm = (): FormValues => {
  const today = dayKey(new Date());
  return { id: null, kind: "LEAVE", mode: "days", startDay: today, endDay: today, from: "09:00", to: "13:00", reason: "" };
};
const formFrom = (entry: StaffTimeOffView): FormValues => {
  const f = timeOffToForm({ start: new Date(entry.start), end: new Date(entry.end), allDay: entry.allDay });
  return { id: entry.id, kind: entry.kind, mode: f.mode, startDay: f.startDay, endDay: f.endDay, from: f.from || "09:00", to: f.to || "13:00", reason: entry.reason ?? "" };
};

// F4 — Congés et absences d'un employé : liste (à venir d'abord, puis passées), création, modification, suppression.
// ENREGISTREMENT SEUL : ces absences ne bloquent pas encore les créneaux de réservation. Le motif n'apparaît qu'ici.
// Monté seulement quand il est ouvert : la liste est rechargée, et le formulaire repart à zéro, à chaque ouverture.
export function TimeOffModal({
  member,
  onClose,
  onChanged,
}: {
  member: { id: string; firstName: string; lastName: string };
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<StaffTimeOffView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const apply = (r: ListStaffTimeOffActionResult) => {
    if (r.ok) {
      setItems(r.items);
      setLoadError(null);
    } else {
      setLoadError(r.message ?? "Impossible de charger les absences. Réessayez.");
    }
  };
  const reload = async () => apply(await listStaffTimeOffAction(member.id));

  useEffect(() => {
    let cancelled = false;
    listStaffTimeOffAction(member.id).then((r) => {
      if (!cancelled) apply(r);
    });
    return () => {
      cancelled = true;
    };
    // La liste ne se recharge ici que pour un autre employé ; les rechargements suivants passent par reload().
  }, [member.id]);

  // Instant de référence figé à l'ouverture : sépare les absences à venir ou en cours des absences passées.
  const [now] = useState(() => Date.now());
  const upcoming = (items ?? []).filter((i) => new Date(i.end).getTime() > now);
  const past = (items ?? []).filter((i) => new Date(i.end).getTime() <= now);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const openForm = (values: FormValues) => {
    setForm(values);
    setErrors({});
    setMessage(null);
    setConfirmId(null);
  };

  // Nombre de rendez-vous concernés : ils ne sont jamais modifiés ni annulés.
  const withBookingsNote = (text: string, affected: number) =>
    affected > 0 ? `${t(text)} ${affected} ${t("rendez-vous existant(s) concerné(s), non modifié(s).")}` : t(text);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const reason = form.reason.trim();
    // Seuls les champs du mode choisi sont envoyés : les heures n'ont pas de sens pour des journées complètes.
    const payload =
      form.mode === "days"
        ? { kind: form.kind, mode: form.mode, startDay: form.startDay, endDay: form.endDay, reason }
        : { kind: form.kind, mode: form.mode, startDay: form.startDay, from: form.from, to: form.to, reason };
    startTransition(async () => {
      const r = form.id ? await updateStaffTimeOffAction(form.id, payload) : await createStaffTimeOffAction(member.id, payload);
      if (r.ok) {
        const unchanged = "changed" in r && !r.changed;
        onChanged(unchanged ? t(r.message ?? "Aucune modification.") : withBookingsNote(r.message ?? "Absence enregistrée.", r.timeOff.affectedBookings));
        setForm(null);
        setErrors({});
        setMessage(null);
        await reload();
      } else {
        setErrors(r.errors ?? {});
        setMessage(r.message ?? null);
      }
    });
  };

  const remove = (id: string) =>
    startTransition(async () => {
      const r = await deleteStaffTimeOffAction(id);
      if (r.ok) {
        onChanged(t(r.message ?? "Absence supprimée."));
        setConfirmId(null);
        setMessage(null);
        await reload();
      } else {
        setMessage(r.message ?? "Impossible de supprimer l'absence. Réessayez.");
      }
    });

  // Étiquette texte de la période (accessibilité des boutons) ; l'affichage visuel passe par <TimeOffPeriod>.
  const periodLabel = (i: StaffTimeOffView) => timeOffPeriodText(timeOffPeriodParts(i, lang));

  const fieldError = (key: string) =>
    errors[key]?.[0] ? (
      <p id={`${uid}-${key}-error`} role="alert" className="mt-1 text-xs text-red-300">
        {t(errors[key]![0])}
      </p>
    ) : null;
  const describe = (key: string) => (errors[key]?.[0] ? { "aria-invalid": true, "aria-describedby": `${uid}-${key}-error` } : {});

  const renderItem = (i: StaffTimeOffView, isPast: boolean) => (
    <li key={i.id} className={`rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 ${isPast ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm text-white">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${i.kind === "LEAVE" ? "bg-sky-400/15 text-sky-200" : "bg-amber-400/15 text-amber-200"}`}>{t(KIND_LABEL[i.kind])}</span>
            <TimeOffPeriod parts={timeOffPeriodParts(i, lang)} />
          </p>
          {i.reason && <p className="mt-1.5 break-words text-xs text-white/60">{i.reason}</p>}
          {i.affectedBookings > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-200">
              {i.affectedBookings} {t("rendez-vous concerné(s)")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => openForm(formFrom(i))} disabled={pending} aria-label={`${t("Modifier")} · ${periodLabel(i)}`} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-50">
            <EditIcon width={14} height={14} />
          </button>
          <button type="button" onClick={() => setConfirmId(i.id)} disabled={pending} aria-label={`${t("Supprimer")} · ${periodLabel(i)}`} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:border-red-300/40 hover:bg-red-400/10 hover:text-red-200 disabled:opacity-50">
            <TrashIcon width={14} height={14} />
          </button>
        </div>
      </div>
      {confirmId === i.id && (
        <div role="alertdialog" aria-label={t("Supprimer cette absence ?")} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-100">{t("Supprimer cette absence ?")}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmId(null)} disabled={pending} className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/5">{t("Annuler")}</button>
            <button type="button" onClick={() => remove(i.id)} disabled={pending} className="rounded-lg bg-red-400/80 px-3 py-1 text-xs font-semibold text-plum-950 hover:bg-red-300 disabled:cursor-wait disabled:opacity-70">
              {pending ? t("Un instant…") : t("Supprimer")}
            </button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <Modal open onClose={onClose} wide title={`${t("Absences")} · ${member.firstName} ${member.lastName}`}>
      <div className="space-y-4">
        {message && (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t(message)}
          </p>
        )}

        {form ? (
          <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="font-display text-lg text-white">{form.id ? t("Modifier l'absence") : t("Nouvelle absence")}</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelClass}>{t("Type")}</span>
                <select className={fieldClass} value={form.kind} onChange={(e) => set("kind", e.target.value as TimeOffKind)} {...describe("kind")}>
                  {TIMEOFF_KINDS.map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
                </select>
                {fieldError("kind")}
              </label>
              <label>
                <span className={labelClass}>{t("Durée")}</span>
                <select className={fieldClass} value={form.mode} onChange={(e) => set("mode", e.target.value as TimeOffMode)} {...describe("mode")}>
                  {(Object.keys(MODE_LABEL) as TimeOffMode[]).map((m) => <option key={m} value={m}>{t(MODE_LABEL[m])}</option>)}
                </select>
                {fieldError("mode")}
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelClass}>{form.mode === "days" ? t("Du") : t("Date")}</span>
                <input type="date" dir="ltr" className={fieldClass} value={form.startDay} onChange={(e) => set("startDay", e.target.value)} {...describe("startDay")} />
                {fieldError("startDay")}
              </label>
              {form.mode === "days" ? (
                <label>
                  <span className={labelClass}>{t("Au (inclus)")}</span>
                  <input type="date" dir="ltr" className={fieldClass} value={form.endDay} onChange={(e) => set("endDay", e.target.value)} {...describe("endDay")} />
                  {fieldError("endDay")}
                </label>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className={labelClass}>{t("Début")}</span>
                    <input type="time" step={900} dir="ltr" className={fieldClass} value={form.from} onChange={(e) => set("from", e.target.value)} {...describe("from")} />
                    {fieldError("from")}
                  </label>
                  <label>
                    <span className={labelClass}>{t("Fin")}</span>
                    <input type="time" step={900} dir="ltr" className={fieldClass} value={form.to} onChange={(e) => set("to", e.target.value)} {...describe("to")} />
                    {fieldError("to")}
                  </label>
                </div>
              )}
            </div>
            {form.mode === "range" && fieldError("endDay")}

            <label className="block">
              <span className={labelClass}>{t("Motif (facultatif)")}</span>
              <input className={fieldClass} value={form.reason} maxLength={MAX_TIMEOFF_REASON + 20} onChange={(e) => set("reason", e.target.value)} autoComplete="off" {...describe("reason")} />
              <span className="mt-1 flex justify-between gap-3 text-xs text-white/40">
                <span>{t("Visible seulement ici, jamais dans la liste de l'équipe ni dans le journal.")}</span>
                <span dir="ltr">{form.reason.trim().length}/{MAX_TIMEOFF_REASON}</span>
              </span>
              {fieldError("reason")}
            </label>

            <div className="space-y-1 text-xs text-white/45">
              <p>{t("Les rendez-vous déjà pris ne sont ni modifiés ni annulés.")}</p>
              <p>{t("Un horaire ne peut pas passer minuit.")}</p>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} disabled={pending} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Annuler")}</button>
              <button type="submit" disabled={pending} className="btn-shine rounded-xl px-5 py-2.5 text-sm font-semibold text-plum-950 disabled:cursor-wait disabled:opacity-70">
                {pending ? t("Un instant…") : t("Enregistrer")}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={() => openForm(emptyForm())} disabled={items === null} className="btn-shine flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-plum-950 disabled:opacity-60">
              <PlusIcon width={16} height={16} /> {t("Ajouter une absence")}
            </button>
          </div>
        )}

        <div aria-live="polite">
          {loadError ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
              <p>{t(loadError)}</p>
              <button type="button" onClick={() => void reload()} className="mt-2 text-xs text-rose-gold hover:text-champagne">{t("Réessayer")}</button>
            </div>
          ) : items === null ? (
            <p className="py-6 text-center text-sm text-white/45">{t("Chargement…")}</p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/45">{t("Aucune absence enregistrée pour cet employé.")}</p>
          ) : (
            <div className="space-y-4">
              {upcoming.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-white/45">{t("À venir et en cours")}</h3>
                  <ul className="space-y-2">{upcoming.map((i) => renderItem(i, false))}</ul>
                </section>
              )}
              {past.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-white/45">{t("Passées")}</h3>
                  <ul className="space-y-2">{past.map((i) => renderItem(i, true))}</ul>
                </section>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-white/45">{t("Pour le moment, les absences sont enregistrées mais n'affectent pas encore les créneaux de réservation.")}</p>
      </div>
    </Modal>
  );
}
