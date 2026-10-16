"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { sendRemindersNow, type ActionResult } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon } from "@/components/ui/icons";
import { Toast } from "@/components/ui/modal";
import { fmtDay, fmtMonth } from "@/lib/booking/format";
import { addDays, dayKey, parseDayKey } from "@/lib/booking/time";
import type { CalendarBlock, CalendarBooking, CalendarData, CalendarView, FillSuggestion, PackOption, ServiceOption } from "@/lib/booking/types";
import { AiPanel } from "./ai-panel";
import { BlockDetail, BlockForm } from "./block-form";
import { BookingDrawer } from "./booking-drawer";
import { BookingForm, type BookingDraft } from "./booking-form";
import { MonthGrid } from "./month-grid";
import { TimeGrid } from "./time-grid";

type WaitlistItem = { id: string; day: string; status: "WAITING" | "OFFERED"; customer: { id: string; name: string; phone: string }; service: string };

// F3.1 — Calendrier par centre et par praticien, vues jour / semaine / mois.
export function CalendarApp({
  data,
  services,
  packs,
  suggestions,
  waitlist,
  salonName,
}: {
  data: CalendarData;
  services: ServiceOption[];
  packs: PackOption[];
  suggestions: FillSuggestion[];
  waitlist: WaitlistItem[];
  salonName: string;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<CalendarBooking | null>(null);
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const [blockDay, setBlockDay] = useState<string | null>(null);
  const [block, setBlock] = useState<CalendarBlock | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const go = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      startNav(() => router.push(`/dashboard/calendar?${next.toString()}`, { scroll: false }));
    },
    [params, router],
  );

  const onResult = useCallback(
    (r: ActionResult) => {
      if (r.error) setToast({ tone: "error", text: r.error });
      else if (r.message) setToast({ tone: "success", text: r.message });
      if (r.link) window.open(r.link, "_blank", "noopener");
      router.refresh();
    },
    [router],
  );

  const ref = parseDayKey(data.date)!;
  const step = data.view === "day" ? 1 : data.view === "week" ? 7 : 0;
  const shift = (dir: -1 | 1) => {
    if (data.view === "month") {
      // Calcul sur l'année et le mois (le 1er du mois) : évite le saut de mois les 29, 30 et 31.
      const [y, m] = data.date.split("-").map(Number);
      const total = y * 12 + (m - 1) + dir;
      go({ date: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01` });
    } else go({ date: dayKey(addDays(ref, dir * step)) });
  };

  const title =
    data.view === "month"
      ? fmtMonth(ref, lang)
      : data.view === "day"
        ? fmtDay(ref, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : `${fmtDay(data.rangeStart, lang, { day: "numeric", month: "short" })} – ${fmtDay(addDays(new Date(data.rangeEnd), -1), lang, { day: "numeric", month: "short", year: "numeric" })}`;

  const active = data.bookings.filter((b) => b.status !== "CANCELLED");
  const revenue = active.reduce((n, b) => n + b.totalTnd, 0);

  return (
    <div className="mt-6 space-y-5">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            <button type="button" onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white" aria-label={t("Précédent")}>
              <ArrowLeftIcon width={18} height={18} className="rtl:-scale-x-100" />
            </button>
            <button type="button" onClick={() => go({ date: null })} className="rounded-xl px-3 py-1.5 text-sm text-white/80 hover:bg-white/10">
              {t("Aujourd'hui")}
            </button>
            <button type="button" onClick={() => shift(1)} className="grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white" aria-label={t("Suivant")}>
              <ArrowRightIcon width={18} height={18} className="rtl:-scale-x-100" />
            </button>
          </div>
          <h1 className="font-display text-2xl capitalize text-white sm:text-3xl">{title}</h1>
          {navigating && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            {(["day", "week", "month"] as CalendarView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => go({ view: v === "week" ? null : v })}
                className={`rounded-xl px-3 py-1.5 text-sm transition ${data.view === v ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950" : "text-white/60 hover:text-white"}`}
              >
                {t(v === "day" ? "Jour" : v === "week" ? "Semaine" : "Mois")}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDraft({ day: data.view === "day" ? data.date : dayKey(new Date()), time: "10:00", staffId: data.staffFilter })}
            className="btn-shine flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950"
          >
            <PlusIcon width={16} height={16} /> {t("Rendez-vous")}
          </button>
        </div>
      </div>

      {/* Centre, praticiens, actions */}
      <div className="flex flex-wrap items-center gap-2 animate-fade-up [animation-delay:0.05s]">
        {data.centers.length > 1 && (
          <select
            value={data.center.id}
            onChange={(e) => go({ center: e.target.value, staff: null })}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
            aria-label={t("Centre")}
          >
            {data.centers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {data.canManage && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => go({ staff: null })}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${!data.staffFilter ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-white/50 hover:text-white"}`}
            >
              {t("Toute l'équipe")}
            </button>
            {data.practitioners.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => go({ staff: data.staffFilter === p.id ? null : p.id })}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${data.staffFilter === p.id ? "border-white/40 bg-white/10 text-white" : "border-white/10 text-white/60 hover:text-white"}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.firstName}
              </button>
            ))}
          </div>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setBlockDay(data.view === "day" ? data.date : dayKey(new Date()))} className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:border-white/25 hover:text-white">
            {t("Bloquer du temps")}
          </button>
          {data.canManage && (
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => onResult(await sendRemindersNow(data.center.id)))}
              className="rounded-2xl border border-[#25d366]/30 bg-[#25d366]/10 px-3 py-2 text-xs text-[#7ef0a8] hover:bg-[#25d366]/20 disabled:opacity-60"
            >
              {pending ? t("Envoi…") : t("Envoyer les rappels (24 h)")}
            </button>
          )}
        </div>
      </div>

      {/* Résumé de la période */}
      <div className="flex flex-wrap gap-2 text-xs text-white/60 animate-fade-up [animation-delay:0.08s]">
        <span className="rounded-full bg-white/5 px-3 py-1">{active.length} {t("rendez-vous")}</span>
        <span className="rounded-full bg-white/5 px-3 py-1" dir="ltr">{Math.round(revenue)} {t("DT prévus")}</span>
        <span className="rounded-full bg-red-400/10 px-3 py-1 text-red-200">
          {data.bookings.filter((b) => b.risk?.level === "high").length} {t("à risque élevé")}
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="relative min-w-0 animate-fade-up [animation-delay:0.1s]">
          {/* Chargement pendant la navigation (requêtes vers Atlas) */}
          {navigating && (
            <div className="absolute inset-0 z-30 grid place-items-center rounded-[1.75rem] bg-plum-950/50 backdrop-blur-[2px] animate-fade-up">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-plum-950/90 px-5 py-3 text-sm text-white shadow-2xl">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />
                {t("Chargement du calendrier…")}
              </div>
            </div>
          )}
          {data.practitioners.length === 0 ? (
            <div className="glass rounded-[1.75rem] p-10 text-center text-white/60">{t("Aucun praticien dans ce centre pour l'instant (Module Équipe).")}</div>
          ) : data.view === "month" ? (
            <MonthGrid data={data} onDayClick={(day) => go({ view: "day", date: day })} onBookingClick={setSelected} />
          ) : (
            <TimeGrid data={data} onBookingClick={setSelected} onBlockClick={setBlock} onSlotClick={(day, time, staffId) => setDraft({ day, time, staffId })} />
          )}
        </div>
        <div className="animate-fade-up [animation-delay:0.15s]">
          <AiPanel data={data} suggestions={suggestions} waitlist={waitlist} onBookingClick={setSelected} onResult={onResult} />
        </div>
      </div>

      {selected && <BookingDrawer key={selected.id} booking={selected} data={data} salonName={salonName} onClose={() => setSelected(null)} onResult={onResult} />}
      {draft && <BookingForm key={`${draft.day}${draft.time}${draft.staffId}`} draft={draft} data={data} services={services} packs={packs} onClose={() => setDraft(null)} onResult={onResult} />}
      {blockDay && <BlockForm day={blockDay} data={data} onClose={() => setBlockDay(null)} onResult={onResult} />}
      {block && <BlockDetail block={block} data={data} onClose={() => setBlock(null)} onResult={onResult} />}
      {toast && (
        <Toast tone={toast.tone} onDone={() => setToast(null)}>
          {t(toast.text)}
        </Toast>
      )}
    </div>
  );
}
