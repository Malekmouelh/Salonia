"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import { addDays, dayKey, hoursForDay, toLocal } from "@/lib/booking/time";
import type { CalendarBooking, CalendarData } from "@/lib/booking/types";

export function MonthGrid({ data, onDayClick, onBookingClick }: { data: CalendarData; onDayClick: (day: string) => void; onBookingClick: (b: CalendarBooking) => void }) {
  const { lang } = useI18n();
  const start = new Date(data.rangeStart);
  const end = new Date(data.rangeEnd);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const month = toLocal(new Date(`${data.date}T12:00:00Z`)).month;
  const todayKey = dayKey(new Date());
  const colorOf = new Map(data.practitioners.map((p) => [p.id, p.color]));

  const byDay = new Map<string, CalendarBooking[]>();
  for (const b of data.bookings) {
    if (b.status === "CANCELLED") continue;
    const k = dayKey(new Date(b.start));
    byDay.set(k, [...(byDay.get(k) ?? []), b]);
  }
  const max = Math.max(1, ...[...byDay.values()].map((l) => l.length));

  return (
    <div className="glass overflow-hidden rounded-[1.75rem] p-3">
      <div className="grid grid-cols-7 gap-1.5 pb-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="text-center text-xs uppercase tracking-wider text-white/40">
            {fmtDay(addDays(start, i), lang, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: days }, (_, i) => {
          const day = addDays(start, i);
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const outside = toLocal(day).month !== month;
          const closed = !hoursForDay(data.center.openingHours, day);
          const load = list.length / max;
          return (
            <div
              key={key}
              className={`group relative flex min-h-24 flex-col rounded-2xl border p-2 text-start transition sm:min-h-28 ${
                outside ? "border-transparent opacity-35" : "border-white/[0.06] hover:border-rose-gold/40"
              } ${key === todayKey ? "ring-1 ring-champagne/60" : ""}`}
              style={{ background: closed ? "rgb(255 255 255 / 0.015)" : `rgb(232 180 160 / ${0.04 + load * 0.16})` }}
            >
              <button type="button" onClick={() => onDayClick(key)} className="absolute inset-0 rounded-2xl" aria-label={fmtDay(day, lang)} />
              <div className="relative flex items-center justify-between">
                <span className={`text-sm font-medium ${key === todayKey ? "text-champagne" : "text-white/80"}`}>{toLocal(day).day}</span>
                {list.length > 0 && <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/70">{list.length}</span>}
              </div>
              <div className="relative mt-1 hidden space-y-1 sm:block">
                {list.slice(0, 3).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onBookingClick(b)}
                    className="flex w-full items-center gap-1.5 truncate rounded-md bg-black/20 px-1.5 py-0.5 text-start text-[10px] text-white/80 hover:bg-black/40"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorOf.get(b.staffId) }} />
                    <span dir="ltr">{fmtTime(b.start, lang)}</span>
                    <span className="truncate">{b.customer.name}</span>
                  </button>
                ))}
                {list.length > 3 && <p className="ps-1 text-[10px] text-white/40">+{list.length - 3}</p>}
              </div>
              {/* Mobile : pastilles */}
              <div className="relative mt-auto flex flex-wrap gap-0.5 sm:hidden">
                {list.slice(0, 6).map((b) => (
                  <span key={b.id} className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf.get(b.staffId) }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
