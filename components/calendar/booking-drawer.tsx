"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelBooking, rescheduleBooking, setBookingStatus, type ActionResult } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import { fmtDay, fmtDuration, fmtMoney, fmtTime } from "@/lib/booking/format";
import { reminderMessage, whatsappLink } from "@/lib/booking/messages";
import { dayKey, toLocal } from "@/lib/booking/time";
import type { CalendarBooking, CalendarData } from "@/lib/booking/types";
import type { BookingStatus } from "@/lib/enums";
import { RISK_META, STATUS_META, inputClass, labelClass } from "./status";

export function BookingDrawer({
  booking,
  data,
  salonName,
  onClose,
  onResult,
}: {
  booking: CalendarBooking | null;
  data: CalendarData;
  salonName: string;
  onClose: () => void;
  onResult: (r: ActionResult) => void;
}) {
  const { t, lang } = useI18n();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [reason, setReason] = useState("");
  const [newDay, setNewDay] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newStaff, setNewStaff] = useState("");

  if (!booking) return null;
  const b = booking;
  const staff = data.practitioners.find((p) => p.id === b.staffId);
  const isPast = new Date(b.end) < new Date();
  const duration = (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000;
  const local = toLocal(new Date(b.start));

  const run = (fn: () => Promise<ActionResult>, close = true) =>
    startTransition(async () => {
      const r = await fn();
      onResult(r);
      if (r.ok && close) onClose();
    });

  const setStatus = (s: BookingStatus) => run(() => setBookingStatus(b.id, s));
  const reminderLink = whatsappLink(
    b.customer.phone,
    reminderMessage({ firstName: b.customer.name.split(" ")[0], salon: salonName, center: data.center.name, start: new Date(b.start), services: b.packName ?? b.services.join(", ") }),
  );

  return (
    <Modal open onClose={onClose} side title={b.customer.name}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs ${STATUS_META[b.status].chip}`}>{t(STATUS_META[b.status].label)}</span>
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60">{t(b.source === "ONLINE" ? "Réservé en ligne" : b.source === "CHATBOT" ? "Réservé par le chatbot" : b.source === "WAITLIST" ? "Liste d'attente" : "Saisi par le salon")}</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-lg font-medium capitalize text-white">{fmtDay(b.start, lang)}</p>
          <p className="text-white/70" dir="ltr">
            {fmtTime(b.start, lang)} – {fmtTime(b.end, lang)} · {fmtDuration(duration)}
          </p>
          <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: staff?.color }} />
            {staff ? `${staff.firstName} ${staff.lastName}` : "—"}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-white">
            {b.packName && <li className="font-medium text-champagne">{b.packName}</li>}
            {b.services.map((s) => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-semibold text-white">{fmtMoney(b.totalTnd, lang)}</p>
          {b.notes && <p className="mt-2 rounded-xl bg-black/20 p-2 text-sm text-white/60">{b.notes}</p>}
        </div>

        {/* IA : risque d'absence */}
        {b.risk && (
          <div className="rounded-2xl border border-[#c9a0dc]/25 bg-[#c9a0dc]/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-[#e6d0f0]">{t("IA · Risque d'absence")}</p>
              <span className={`text-sm font-semibold ${RISK_META[b.risk.level].text}`}>{Math.round(b.risk.probability * 100)} %</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full ${RISK_META[b.risk.level].dot} transition-all duration-700`} style={{ width: `${Math.max(4, b.risk.probability * 100)}%` }} />
            </div>
            {b.risk.factors.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-white/60">
                {b.risk.factors.map((f) => (
                  <li key={f.label} className="flex items-center gap-2">
                    <span className={f.impact > 0 ? "text-red-300" : "text-emerald-300"}>{f.impact > 0 ? "▲" : "▼"}</span>
                    {t(f.label)}
                  </li>
                ))}
              </ul>
            )}
            {b.risk.level !== "low" && (
              <p className="mt-3 text-xs text-white/50">{t("Conseil : envoyez un rappel personnalisé ou demandez un acompte.")}</p>
            )}
          </div>
        )}

        {/* Client */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 p-4">
          <div>
            <p className="text-sm text-white">{b.customer.name}</p>
            <p className="text-xs text-white/50" dir="ltr">
              +216 {b.customer.phone}
            </p>
            {!b.customer.remindersConsent && <p className="mt-1 text-xs text-amber-300">{t("Rappels refusés")}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Link href={`/dashboard/clients/${b.customer.id}`} className="rounded-xl border border-white/10 px-3 py-2 text-center text-xs text-white/70 transition hover:border-rose-gold/40 hover:text-white">
              {t("Fiche client")}
            </Link>
            {/* Module 6 : encaissement, acompte ou lien de paiement depuis la caisse du centre. */}
            {b.status !== "CANCELLED" && (
              <Link
                href={`/dashboard/finances/caisse?center=${data.center.id}&day=${dayKey(new Date(b.start))}`}
                className="rounded-xl border border-white/10 px-3 py-2 text-center text-xs text-white/70 transition hover:border-rose-gold/40 hover:text-white"
              >
                {t("Encaisser")}
              </Link>
            )}
          </div>
        </div>

        {mode === "view" && (
          <div className="grid gap-2">
            {!isPast && (b.status === "CONFIRMED" || b.status === "PENDING") && (
              <a
                href={reminderLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#25d366]/15 py-3 text-sm font-medium text-[#7ef0a8] transition hover:bg-[#25d366]/25"
              >
                {t("Envoyer un rappel WhatsApp")}
                {b.reminderSentAt && <span className="text-xs text-white/40">· {t("rappel auto envoyé")}</span>}
              </a>
            )}
            <div className="grid grid-cols-2 gap-2">
              {b.status === "PENDING" && (
                <ActionButton onClick={() => setStatus("CONFIRMED")} disabled={pending} tone="ok">{t("Confirmer")}</ActionButton>
              )}
              {isPast && (b.status === "CONFIRMED" || b.status === "PENDING") && (
                <>
                  <ActionButton onClick={() => setStatus("COMPLETED")} disabled={pending} tone="ok">{t("Terminé")}</ActionButton>
                  <ActionButton onClick={() => setStatus("NO_SHOW")} disabled={pending} tone="danger">{t("Absent")}</ActionButton>
                </>
              )}
              {(b.status === "NO_SHOW" || b.status === "COMPLETED" || b.status === "CANCELLED") && (
                <ActionButton onClick={() => setStatus("CONFIRMED")} disabled={pending}>{t("Rétablir")}</ActionButton>
              )}
              {!isPast && b.status !== "CANCELLED" && (
                <>
                  <ActionButton
                    onClick={() => {
                      setNewDay(dayKey(new Date(b.start)));
                      setNewTime(`${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`);
                      setNewStaff(b.staffId);
                      setMode("reschedule");
                    }}
                  >
                    {t("Reporter")}
                  </ActionButton>
                  <ActionButton onClick={() => setMode("cancel")} tone="danger">{t("Annuler")}</ActionButton>
                </>
              )}
            </div>
          </div>
        )}

        {mode === "reschedule" && (
          <div className="space-y-3 rounded-2xl border border-white/10 p-4 animate-fade-up">
            <p className="text-sm font-medium text-white">{t("Reporter le rendez-vous")}</p>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={labelClass}>{t("Date")}</span>
                <input type="date" className={inputClass} value={newDay} onChange={(e) => setNewDay(e.target.value)} dir="ltr" />
              </label>
              <label>
                <span className={labelClass}>{t("Heure")}</span>
                <input type="time" step={900} className={inputClass} value={newTime} onChange={(e) => setNewTime(e.target.value)} dir="ltr" />
              </label>
            </div>
            {data.canManage && (
              <label className="block">
                <span className={labelClass}>{t("Praticien")}</span>
                <select className={inputClass} value={newStaff} onChange={(e) => setNewStaff(e.target.value)}>
                  {data.practitioners.map((p) => (
                    <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              <ActionButton onClick={() => setMode("view")}>{t("Retour")}</ActionButton>
              <ActionButton tone="ok" disabled={pending} onClick={() => run(() => rescheduleBooking({ bookingId: b.id, day: newDay, time: newTime, staffId: newStaff }))}>
                {pending ? t("Un instant…") : t("Déplacer")}
              </ActionButton>
            </div>
          </div>
        )}

        {mode === "cancel" && (
          <div className="space-y-3 rounded-2xl border border-red-400/20 bg-red-500/[0.05] p-4 animate-fade-up">
            <p className="text-sm font-medium text-white">{t("Annuler le rendez-vous ?")}</p>
            <input className={inputClass} placeholder={t("Motif (facultatif)")} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <ActionButton onClick={() => setMode("view")}>{t("Retour")}</ActionButton>
              <ActionButton tone="danger" disabled={pending} onClick={() => run(() => cancelBooking(b.id, reason))}>
                {pending ? t("Un instant…") : t("Confirmer l'annulation")}
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "ok" | "danger";
}) {
  const styles =
    tone === "ok"
      ? "bg-gradient-to-r from-blush to-champagne text-plum-950 font-semibold hover:shadow-[0_8px_24px_-8px_rgb(232_180_160/0.7)]"
      : tone === "danger"
        ? "border border-red-400/30 text-red-200 hover:bg-red-500/10"
        : "border border-white/10 text-white/80 hover:border-white/25 hover:text-white";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`flex-1 rounded-2xl px-4 py-2.5 text-sm transition disabled:opacity-60 ${styles}`}>
      {children}
    </button>
  );
}
