"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtShortDay, fmtTime } from "@/lib/booking/format";
import { addDays, dayKey, hoursForDay, minutesToHhmm, toLocal } from "@/lib/booking/time";
import type { CalendarBlock, CalendarBooking, CalendarData } from "@/lib/booking/types";
import { BLOCK_LABELS, RISK_META, STATUS_META } from "./status";

const PX_PER_MIN = 1.15;

const subscribeMinute = (cb: () => void) => {
  const id = setInterval(cb, 15_000);
  return () => clearInterval(id);
};
const currentMinute = () => Math.floor(Date.now() / 60_000);

type Column = { key: string; day: Date; staffId: string | null; title: string; subtitle?: string; color?: string };
type Positioned<T> = T & { lane: number; lanes: number };

const localMinutes = (iso: string) => {
  const p = toLocal(new Date(iso));
  return p.hour * 60 + p.minute;
};

// Répartit les rendez-vous qui se chevauchent sur plusieurs « couloirs » côte à côte.
function layout<T extends { start: string; end: string }>(items: T[]): Positioned<T>[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const result: Positioned<T>[] = [];
  let group: Positioned<T>[] = [];
  let groupEnd = "";
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => (g.lanes = lanes));
    result.push(...group);
    group = [];
    groupEnd = "";
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.end > item.start).map((g) => g.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ ...item, lane, lanes: 1 });
    if (item.end > groupEnd) groupEnd = item.end;
  }
  if (group.length) flush();
  return result;
}

export function TimeGrid({
  data,
  onSlotClick,
  onBookingClick,
  onBlockClick,
}: {
  data: CalendarData;
  onSlotClick: (day: string, time: string, staffId: string | null) => void;
  onBookingClick: (b: CalendarBooking) => void;
  onBlockClick: (b: CalendarBlock) => void;
}) {
  const { t, lang } = useI18n();
  // Minute courante (null au rendu serveur), mise à jour chaque minute pour la ligne « maintenant ».
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, () => null);
  const now = minute === null ? null : new Date(minute * 60_000);

  const staffColor = useMemo(() => new Map(data.practitioners.map((p) => [p.id, p.color])), [data.practitioners]);
  const staffName = useMemo(() => new Map(data.practitioners.map((p) => [p.id, p.firstName])), [data.practitioners]);

  const columns: Column[] = useMemo(() => {
    const start = new Date(data.rangeStart);
    if (data.view === "day") {
      const shown = data.staffFilter ? data.practitioners.filter((p) => p.id === data.staffFilter) : data.practitioners;
      return shown.map((p) => ({ key: p.id, day: start, staffId: p.id, title: p.firstName, subtitle: p.lastName, color: p.color }));
    }
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      return { key: dayKey(day), day, staffId: data.staffFilter, title: fmtShortDay(day, lang) };
    });
  }, [data, lang]);

  // Plage horaire affichée : de la plus tôt ouverture à la plus tardive fermeture (+ rendez-vous hors horaires).
  const [gridStart, gridEnd] = useMemo(() => {
    let min = 24 * 60;
    let max = 0;
    for (const c of columns) {
      const h = hoursForDay(data.center.openingHours, c.day);
      if (h) {
        min = Math.min(min, h.open);
        max = Math.max(max, h.close);
      }
    }
    for (const b of data.bookings) {
      min = Math.min(min, localMinutes(b.start));
      max = Math.max(max, localMinutes(b.end));
    }
    if (min >= max) [min, max] = [9 * 60, 19 * 60];
    return [Math.floor(min / 60) * 60, Math.ceil(max / 60) * 60];
  }, [columns, data]);

  const height = (gridEnd - gridStart) * PX_PER_MIN;
  const hours = Array.from({ length: (gridEnd - gridStart) / 60 + 1 }, (_, i) => gridStart + i * 60);

  function columnItems(c: Column) {
    const key = dayKey(c.day);
    const inColumn = (start: string, staffId: string | null) =>
      dayKey(new Date(start)) === key && (c.staffId === null || staffId === null || staffId === c.staffId);
    return {
      bookings: layout(data.bookings.filter((b) => inColumn(b.start, b.staffId))),
      blocks: data.blocks.filter((b) => {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        return bStart < addDays(c.day, 1) && bEnd > c.day && (c.staffId === null || b.staffId === null || b.staffId === c.staffId);
      }),
    };
  }

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>, c: Column) {
    if (e.target !== e.currentTarget) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minute = gridStart + Math.floor(y / PX_PER_MIN / 15) * 15;
    onSlotClick(dayKey(c.day), minutesToHhmm(minute), c.staffId);
  }

  const nowKey = now ? dayKey(now) : "";
  const nowMinute = now ? localMinutes(now.toISOString()) : -1;

  return (
    <div className="glass overflow-hidden rounded-[1.75rem]">
      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(columns.length * 130 + 64, 640) }}>
          {/* En-têtes de colonnes */}
          <div className="sticky top-0 z-20 flex border-b border-white/10 bg-plum-950/80 backdrop-blur">
            <div className="w-16 shrink-0" />
            {columns.map((c) => {
              const isToday = dayKey(c.day) === nowKey && data.view === "week";
              return (
                <div key={c.key} className="flex-1 border-s border-white/5 px-2 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    {c.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />}
                    <span className={`text-sm font-medium capitalize ${isToday ? "text-champagne" : "text-white"}`}>{c.title}</span>
                  </div>
                  {c.subtitle && <p className="text-xs text-white/40">{c.subtitle}</p>}
                  {isToday && <span className="mx-auto mt-1 block h-1 w-6 rounded-full bg-gradient-to-r from-blush to-champagne" />}
                </div>
              );
            })}
          </div>

          <div className="relative flex" style={{ height: height + 16, paddingTop: 10, paddingBottom: 6 }}>
            {/* Graduation horaire */}
            <div className="relative w-16 shrink-0" style={{ height }}>
              {hours.map((m) => (
                <span key={m} className="absolute end-2 -translate-y-1/2 text-[11px] tabular-nums text-white/35" style={{ top: (m - gridStart) * PX_PER_MIN }} dir="ltr">
                  {minutesToHhmm(m)}
                </span>
              ))}
            </div>

            {columns.map((c) => {
              const { bookings, blocks } = columnItems(c);
              const hoursOfDay = hoursForDay(data.center.openingHours, c.day);
              const isToday = dayKey(c.day) === nowKey;
              return (
                <div
                  key={c.key}
                  role="presentation"
                  onClick={(e) => handleColumnClick(e, c)}
                  className="group/col relative flex-1 cursor-copy border-s border-white/5 transition-colors hover:bg-white/[0.015]"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.05) 0, rgb(255 255 255 / 0.05) 1px, transparent 1px, transparent ${60 * PX_PER_MIN}px)`,
                  }}
                >
                  {/* Hors horaires d'ouverture : grisé */}
                  {!hoursOfDay ? (
                    <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.03)_0,rgb(255_255_255/0.03)_6px,transparent_6px,transparent_12px)]">
                      <span className="absolute inset-x-0 top-6 text-center text-xs text-white/30">{t("Fermé")}</span>
                    </div>
                  ) : (
                    <>
                      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/20" style={{ height: Math.max(0, (hoursOfDay.open - gridStart) * PX_PER_MIN) }} />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/20" style={{ height: Math.max(0, (gridEnd - hoursOfDay.close) * PX_PER_MIN) }} />
                    </>
                  )}

                  {blocks.map((b) => {
                    const startMin = Math.max(gridStart, dayKey(new Date(b.start)) === dayKey(c.day) ? localMinutes(b.start) : gridStart);
                    const endMin = Math.min(gridEnd, dayKey(new Date(b.end)) === dayKey(c.day) ? localMinutes(b.end) || gridEnd : gridEnd);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onBlockClick(b)}
                        className="absolute inset-x-1 z-[5] overflow-hidden rounded-lg border border-dashed border-white/20 bg-[repeating-linear-gradient(135deg,rgb(201_160_220/0.12)_0,rgb(201_160_220/0.12)_6px,transparent_6px,transparent_12px)] px-2 py-1 text-start text-[11px] text-white/60 transition hover:border-white/40"
                        style={{ top: (startMin - gridStart) * PX_PER_MIN, height: Math.max(18, (endMin - startMin) * PX_PER_MIN) }}
                      >
                        {t(BLOCK_LABELS[b.kind])}
                        {b.reason && ` · ${b.reason}`}
                      </button>
                    );
                  })}

                  {bookings.map((b) => {
                    const startMin = localMinutes(b.start);
                    const duration = (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000;
                    const color = staffColor.get(b.staffId) ?? "#e8b4a0";
                    const compact = duration * PX_PER_MIN < 44;
                    const width = 100 / b.lanes;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onBookingClick(b)}
                        aria-label={`${b.customer.name}, ${fmtTime(b.start, lang)}–${fmtTime(b.end, lang)}, ${b.packName ?? b.services.join(", ")}, ${t(STATUS_META[b.status].label)}`}
                        className={`group absolute z-10 overflow-hidden rounded-xl border px-2 py-1 text-start shadow-lg transition duration-200 hover:z-30 hover:scale-[1.02] hover:shadow-2xl focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-champagne animate-fade-up ${STATUS_META[b.status].card}`}
                        style={{
                          top: (startMin - gridStart) * PX_PER_MIN + 1,
                          height: Math.max(22, duration * PX_PER_MIN - 2),
                          insetInlineStart: `calc(${b.lane * width}% + 3px)`,
                          width: `calc(${width}% - 6px)`,
                          borderInlineStartWidth: 4,
                          borderInlineStartColor: color,
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          {b.risk && b.risk.level !== "low" && (
                            <span className={`h-2 w-2 shrink-0 rounded-full ${RISK_META[b.risk.level].dot} ${b.risk.level === "high" ? "animate-pulse" : ""}`} title={t(RISK_META[b.risk.level].label)} />
                          )}
                          <span className="truncate text-[12px] font-semibold text-white">{b.customer.name}</span>
                          {compact && <span className="ms-auto shrink-0 text-[10px] text-white/50" dir="ltr">{fmtTime(b.start, lang)}</span>}
                        </div>
                        {!compact && (
                          <>
                            <p className="truncate text-[11px] text-white/60">{b.packName ?? b.services.join(" + ")}</p>
                            <p className="mt-0.5 text-[10px] text-white/40" dir="ltr">
                              {fmtTime(b.start, lang)} – {fmtTime(b.end, lang)}
                              {data.view === "week" && !data.staffFilter && ` · ${staffName.get(b.staffId) ?? ""}`}
                            </p>
                          </>
                        )}
                      </button>
                    );
                  })}

                  {/* Ligne de l'heure actuelle */}
                  {isToday && nowMinute >= gridStart && nowMinute <= gridEnd && (
                    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMinute - gridStart) * PX_PER_MIN }}>
                      <div className="relative h-0.5 bg-gradient-to-r from-blush via-rose-gold to-champagne shadow-[0_0_12px_rgb(247_198_208/0.8)]">
                        <span className="absolute -start-1.5 -top-[5px] h-3 w-3 rounded-full bg-blush" />
                      </div>
                    </div>
                  )}
                  <span className="pointer-events-none absolute inset-x-2 top-2 hidden text-center text-[10px] text-white/0 group-hover/col:text-white/25 sm:block">
                    {t("Cliquer pour ajouter")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
