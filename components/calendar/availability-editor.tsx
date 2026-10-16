"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBlock, saveOpeningHours } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Toast } from "@/components/ui/modal";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import { BLOCK_LABELS } from "./status";

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

type Block = { id: string; kind: "BREAK" | "CLOSURE" | "BLOCK"; start: string; end: string; reason: string | null; staff: string | null };

// F3.2 — Horaires d'ouverture par jour et liste des pauses / fermetures à venir.
export function AvailabilityEditor({
  centers,
  center,
  blocks,
}: {
  centers: { id: string; name: string }[];
  center: { id: string; name: string; openingHours: Record<string, string | null> };
  blocks: Block[];
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [hours, setHours] = useState(() =>
    Object.fromEntries(
      DAYS.map((d) => {
        const [open, close] = (center.openingHours[d] ?? "09:00-19:00").split("-");
        return [d, { enabled: Boolean(center.openingHours[d]), open, close }];
      }),
    ),
  );

  const save = () =>
    startTransition(async () => {
      const payload = Object.fromEntries(DAYS.map((d) => [d, hours[d].enabled ? `${hours[d].open}-${hours[d].close}` : null]));
      const r = await saveOpeningHours(center.id, payload);
      setToast({ tone: r.error ? "error" : "success", text: r.error ?? r.message ?? "" });
      router.refresh();
    });

  const copyMonday = () => setHours((h) => Object.fromEntries(DAYS.map((d) => [d, d === "dimanche" ? h[d] : { ...h.lundi }])));

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <section className="glass glow-border rounded-[2rem] p-6 animate-fade-up">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {centers.length > 1 ? (
            <select
              value={center.id}
              onChange={(e) => router.push(`/dashboard/availability?center=${e.target.value}`)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
              aria-label={t("Centre")}
            >
              {centers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <p className="font-medium text-white">{center.name}</p>
          )}
          <button type="button" onClick={copyMonday} className="text-xs text-rose-gold hover:text-champagne">
            {t("Appliquer les horaires du lundi à toute la semaine")}
          </button>
        </div>

        <ul className="space-y-2">
          {DAYS.map((d) => {
            const h = hours[d];
            return (
              <li key={d} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 transition ${h.enabled ? "border-white/10 bg-white/[0.04]" : "border-white/5 opacity-60"}`}>
                <label className="flex w-36 items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={h.enabled}
                    onClick={() => setHours({ ...hours, [d]: { ...h, enabled: !h.enabled } })}
                    className={`relative h-6 w-11 rounded-full transition ${h.enabled ? "bg-gradient-to-r from-blush to-champagne" : "bg-white/15"}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${h.enabled ? "start-[22px]" : "start-0.5"}`} />
                  </button>
                  <span className="text-sm capitalize text-white">{t(d)}</span>
                </label>
                {h.enabled ? (
                  <div className="flex items-center gap-2" dir="ltr">
                    <input type="time" step={900} value={h.open} onChange={(e) => setHours({ ...hours, [d]: { ...h, open: e.target.value } })} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white outline-none focus:border-rose-gold/60" />
                    <span className="text-white/40">→</span>
                    <input type="time" step={900} value={h.close} onChange={(e) => setHours({ ...hours, [d]: { ...h, close: e.target.value } })} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white outline-none focus:border-rose-gold/60" />
                  </div>
                ) : (
                  <span className="text-sm text-white/40">{t("Fermé")}</span>
                )}
              </li>
            );
          })}
        </ul>
        <button type="button" disabled={pending} onClick={save} className="btn-shine mt-5 w-full rounded-2xl py-3 text-sm font-semibold text-plum-950 disabled:opacity-60">
          {pending ? t("Un instant…") : t("Enregistrer les horaires")}
        </button>
      </section>

      <section className="glass rounded-[2rem] p-6 animate-fade-up [animation-delay:0.1s]">
        <h2 className="font-display text-2xl text-white">{t("Pauses et fermetures à venir")}</h2>
        <p className="mt-1 text-sm text-white/50">{t("Ajoutez-en depuis le calendrier avec « Bloquer du temps ».")}</p>
        <ul className="mt-4 space-y-2">
          {blocks.length === 0 && <li className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-white/40">{t("Aucune indisponibilité prévue.")}</li>}
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${b.kind === "CLOSURE" ? "bg-red-400/15 text-red-200" : b.kind === "BREAK" ? "bg-sky-400/15 text-sky-200" : "bg-[#c9a0dc]/15 text-[#e6d0f0]"}`}>
                {t(BLOCK_LABELS[b.kind])}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm capitalize text-white">
                  {fmtDay(b.start, lang, { weekday: "short", day: "numeric", month: "short" })}
                  {b.kind !== "CLOSURE" && <span dir="ltr"> · {fmtTime(b.start, lang)}–{fmtTime(b.end, lang)}</span>}
                </p>
                <p className="truncate text-xs text-white/45">
                  {b.staff ?? t("Tout le centre")}
                  {b.reason && ` · ${b.reason}`}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("Supprimer")}
                onClick={() =>
                  startTransition(async () => {
                    const r = await deleteBlock(b.id);
                    setToast({ tone: r.error ? "error" : "success", text: r.error ?? "Créneau libéré." });
                    router.refresh();
                  })
                }
                className="text-white/40 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {toast && (
        <Toast tone={toast.tone} onDone={() => setToast(null)}>
          {t(toast.text)}
        </Toast>
      )}
    </div>
  );
}
