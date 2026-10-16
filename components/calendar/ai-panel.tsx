"use client";

import { useState, useTransition } from "react";
import { offerSlot, removeWaitlistEntry, type ActionResult } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";
import { fmtDay, fmtDuration, fmtTime } from "@/lib/booking/format";
import type { CalendarBooking, CalendarData, FillSuggestion } from "@/lib/booking/types";
import { RISK_META } from "./status";

type WaitlistItem = { id: string; day: string; status: "WAITING" | "OFFERED"; customer: { id: string; name: string; phone: string }; service: string };

export function AiPanel({
  data,
  suggestions,
  waitlist,
  onBookingClick,
  onResult,
}: {
  data: CalendarData;
  suggestions: FillSuggestion[];
  waitlist: WaitlistItem[];
  onBookingClick: (b: CalendarBooking) => void;
  onResult: (r: ActionResult) => void;
}) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"risk" | "fill" | "waitlist">("risk");
  const [pending, startTransition] = useTransition();

  const risky = data.bookings
    .filter((b) => b.risk && b.risk.level !== "low")
    .sort((a, b) => (b.risk!.probability - a.risk!.probability))
    .slice(0, 8);

  const offer = (customerId: string, start: string, waitlistId?: string) =>
    startTransition(async () => {
      const r = await offerSlot({ customerId, start, waitlistId, centerId: data.center.id });
      if (r.link) window.open(r.link, "_blank", "noopener");
      onResult(r.ok ? { ok: true, message: "Proposition prête dans WhatsApp." } : r);
    });

  const tabs = [
    { id: "risk", label: "Absences", count: risky.length },
    { id: "fill", label: "À remplir", count: suggestions.length },
    { id: "waitlist", label: "Attente", count: waitlist.length },
  ] as const;

  return (
    <aside className="glass glow-border rounded-[1.75rem] p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#c9a0dc] to-blush text-plum-950">
          <SparkleIcon width={20} height={20} />
        </span>
        <div>
          <p className="font-medium text-white">{t("Assistant du calendrier")}</p>
          <p className="text-xs text-white/45">
            {data.model.source === "trained"
              ? `${t("Modèle entraîné sur")} ${data.model.trainedOn} ${t("rendez-vous")}${data.model.accuracy !== null ? ` · AUC ${data.model.accuracy.toFixed(2)}` : ""}`
              : t("Modèle de départ (historique insuffisant)")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-black/20 p-1">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            className={`relative rounded-xl py-2 text-xs transition ${tab === x.id ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
          >
            {t(x.label)}
            {x.count > 0 && <span className="ms-1 rounded-full bg-rose-gold/25 px-1.5 text-[10px] text-rose-gold">{x.count}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pe-1">
        {tab === "risk" &&
          (risky.length === 0 ? (
            <Empty text={t("Aucun rendez-vous à risque sur cette période.")} />
          ) : (
            risky.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onBookingClick(b)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-start transition hover:border-white/25 animate-fade-up"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-white">{b.customer.name}</span>
                  <span className={`text-sm font-semibold ${RISK_META[b.risk!.level].text}`}>{Math.round(b.risk!.probability * 100)} %</span>
                </div>
                <p className="text-xs capitalize text-white/50">
                  {fmtDay(b.start, lang, { weekday: "short", day: "numeric", month: "short" })} · <span dir="ltr">{fmtTime(b.start, lang)}</span>
                </p>
                <p className="mt-1 truncate text-[11px] text-white/40">{b.risk!.factors.map((f) => t(f.label)).join(" · ")}</p>
              </button>
            ))
          ))}

        {tab === "fill" &&
          (suggestions.length === 0 ? (
            <Empty text={t("Calendrier bien rempli sur les 7 prochains jours.")} />
          ) : (
            suggestions.map((s, i) => (
              <div key={`${s.staffId}-${s.start}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 animate-fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
                <p className="text-sm capitalize text-white">
                  {fmtDay(s.start, lang, { weekday: "long", day: "numeric" })} · <span dir="ltr">{fmtTime(s.start, lang)}–{fmtTime(s.end, lang)}</span>
                </p>
                <p className="text-xs text-white/50">
                  {s.staffName} · {t("libre")} {fmtDuration(s.minutes)}
                </p>
                {s.candidates.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {s.candidates.slice(0, 3).map((c) => (
                      <li key={c.customerId} className="flex items-center justify-between gap-2 rounded-xl bg-black/20 px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-white">{c.name}</p>
                          <p className="truncate text-[10px] text-white/40">{t(c.reason)}</p>
                        </div>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => offer(c.customerId, s.start, c.waitlistId)}
                          className="shrink-0 rounded-lg bg-[#25d366]/15 px-2 py-1 text-[11px] text-[#7ef0a8] hover:bg-[#25d366]/25"
                        >
                          {t("Proposer")}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-white/40">{t("Astuce : partagez ce créneau en story Instagram.")}</p>
                )}
              </div>
            ))
          ))}

        {tab === "waitlist" &&
          (waitlist.length === 0 ? (
            <Empty text={t("Personne en liste d'attente.")} />
          ) : (
            waitlist.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{w.customer.name}</p>
                  <p className="truncate text-xs text-white/50">
                    <span className="capitalize">{fmtDay(`${w.day}T12:00:00Z`, lang, { weekday: "short", day: "numeric", month: "short" })}</span> · {w.service}
                  </p>
                  {w.status === "OFFERED" && <p className="text-[10px] text-amber-300">{t("Créneau proposé")}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => startTransition(async () => onResult(await removeWaitlistEntry(w.id)))}
                  className="shrink-0 text-xs text-white/40 hover:text-red-300"
                  aria-label={t("Retirer")}
                >
                  ✕
                </button>
              </div>
            ))
          ))}
      </div>
    </aside>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-white/40">{text}</p>;
}
