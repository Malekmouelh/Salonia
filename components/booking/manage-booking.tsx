"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { cancelByToken, getRescheduleSlots, rescheduleByToken } from "@/app/actions/public-booking";
import { STATUS_META } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { Slot } from "@/lib/booking/availability";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import { addDays, dayKey, startOfLocalDay, toLocal } from "@/lib/booking/time";
import type { ManagedBooking } from "@/lib/data/public-salon";

// F3.5 — Le client reporte ou annule lui-même depuis le lien reçu.
export function ManageBooking({ token, booking: b }: { token: string; booking: ManagedBooking }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [day, setDay] = useState(dayKey(new Date(b.start)));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(startOfLocalDay(new Date()), i)), []);
  const active = b.status === "CONFIRMED" || b.status === "PENDING";
  const past = new Date(b.start) < new Date();

  useEffect(() => {
    if (mode !== "reschedule") return;
    let cancelled = false;
    getRescheduleSlots(token, day).then((s) => !cancelled && setSlots(s));
    return () => {
      cancelled = true;
    };
  }, [mode, day, token]);

  const act = (fn: () => Promise<{ ok?: true; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      setMessage(r.ok ? { tone: "ok", text: success } : { tone: "error", text: r.error ?? "Erreur" });
      if (r.ok) {
        setMode("view");
        router.refresh();
      }
    });

  return (
    <div className="mt-6 space-y-5 animate-fade-up">
      <h1 className="font-display text-4xl text-white">
        {t("Bonjour")} <span className="text-gradient italic">{b.customerFirstName}</span>
      </h1>
      <div className="glass glow-border rounded-[2rem] p-6">
        <span className={`rounded-full px-3 py-1 text-xs ${STATUS_META[b.status].chip}`}>{t(STATUS_META[b.status].label)}</span>
        <p className="mt-4 text-xl capitalize text-white">{fmtDay(b.start, lang)}</p>
        <p className="text-white/70" dir="ltr">
          {fmtTime(b.start, lang)} – {fmtTime(b.end, lang)}
        </p>
        <p className="mt-3 text-sm text-white/70">{b.packName ?? b.services.join(" + ")}</p>
        <p className="text-sm text-white/50">{b.center.name}</p>
        <p className="mt-2 font-semibold text-white">{fmtMoney(b.totalTnd, lang)}</p>
      </div>

      {message && (
        <p className={`rounded-2xl border px-4 py-3 text-sm ${message.tone === "ok" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}>
          {t(message.text)}
        </p>
      )}

      {active && !past && mode === "view" && (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setMode("reschedule")} className="btn-shine rounded-2xl py-3.5 text-sm font-semibold text-plum-950">
            {t("Changer d'horaire")}
          </button>
          <button type="button" onClick={() => setMode("cancel")} className="rounded-2xl border border-red-400/30 py-3.5 text-sm text-red-200 hover:bg-red-500/10">
            {t("Annuler")}
          </button>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="glass rounded-[2rem] p-5">
          <p className="mb-3 text-sm text-white/70">{t("Choisissez un nouveau créneau")}</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {days.map((d) => (
              <button
                key={dayKey(d)}
                type="button"
                onClick={() => {
                  setDay(dayKey(d));
                  setSlots(null);
                }}
                className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 ${dayKey(d) === day ? "border-rose-gold bg-rose-gold/15" : "border-white/10"}`}
              >
                <span className="text-[10px] uppercase text-white/50">{fmtDay(d, lang, { weekday: "short" })}</span>
                <span className="font-display text-lg text-white">{toLocal(d).day}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {slots === null
              ? Array.from({ length: 8 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/5" />)
              : slots.length === 0
                ? <p className="col-span-4 text-sm text-white/50">{t("Plus aucun créneau ce jour-là.")}</p>
                : slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => rescheduleByToken(token, s.start), "Rendez-vous déplacé.")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] py-2 text-sm text-white hover:border-rose-gold/50"
                      dir="ltr"
                    >
                      {fmtTime(s.start, lang)}
                    </button>
                  ))}
          </div>
          <button type="button" onClick={() => setMode("view")} className="mt-4 text-sm text-white/50 hover:text-white">
            {t("Retour")}
          </button>
        </div>
      )}

      {mode === "cancel" && (
        <div className="glass rounded-[2rem] p-5">
          <p className="text-white">{t("Annuler le rendez-vous ?")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setMode("view")} className="rounded-2xl border border-white/10 py-3 text-sm text-white/70">
              {t("Retour")}
            </button>
            <button type="button" disabled={pending} onClick={() => act(() => cancelByToken(token), "Rendez-vous annulé.")} className="rounded-2xl bg-red-500/80 py-3 text-sm font-semibold text-white">
              {t("Confirmer l'annulation")}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/" className="rounded-2xl border border-white/10 py-3 text-center text-sm text-white/80 transition hover:border-white/25 hover:text-white">
          {t("Retour à l'accueil")}
        </Link>
        <Link href={`/reserver/${b.salon.slug}`} className="rounded-2xl border border-rose-gold/30 py-3 text-center text-sm text-rose-gold transition hover:border-rose-gold/60 hover:text-champagne">
          {t("Réserver un autre rendez-vous")}
        </Link>
      </div>
    </div>
  );
}
