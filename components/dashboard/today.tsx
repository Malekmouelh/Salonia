"use client";

import Link from "next/link";
import { useState } from "react";
import { STATUS_META } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { CalendarIcon, SparkleIcon } from "@/components/ui/icons";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { BookingStatus } from "@/lib/enums";

type Overview = {
  count: number;
  revenue: number;
  weekCount: number;
  onlineLast7: number;
  next: { id: string; start: string; customer: string; services: string; staff: string; center: string; status: BookingStatus }[];
};

// Module 3 sur le tableau de bord : agenda du jour et lien de réservation à partager.
export function TodayPanel({ overview, bookingUrl }: { overview: Overview; bookingUrl: string | null }) {
  const { t, lang } = useI18n();
  const [copied, setCopied] = useState(false);

  return (
    <section className="mt-10 grid gap-5 lg:grid-cols-3">
      <div className="glass rounded-[2rem] p-6 lg:col-span-2 animate-fade-up">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-2xl text-white">
            <CalendarIcon /> {t("Aujourd'hui")}
            <span className="text-base capitalize text-white/40">· {fmtDay(new Date(), lang, { weekday: "long", day: "numeric", month: "long" })}</span>
          </h2>
          <Link href="/dashboard/calendar?view=day" className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-rose-gold/40 hover:text-white">
            {t("Ouvrir le calendrier")}
          </Link>
        </div>
        {overview.next.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/45">{t("Plus aucun rendez-vous aujourd'hui.")}</p>
        ) : (
          <ul className="stagger space-y-2">
            {overview.next.map((b) => (
              <li key={b.id} className="flex items-center gap-4 rounded-2xl bg-white/[0.04] px-4 py-3">
                <span className="w-14 font-display text-lg text-champagne" dir="ltr">{fmtTime(b.start, lang)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{b.customer}</p>
                  <p className="truncate text-xs text-white/45">{b.services} · {b.staff}</p>
                </div>
                <span className={`hidden rounded-full px-2.5 py-0.5 text-[11px] sm:inline ${STATUS_META[b.status].chip}`}>{t(STATUS_META[b.status].label)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-5">
        <div className="glass grid grid-cols-2 gap-3 rounded-[2rem] p-5 animate-fade-up [animation-delay:0.05s]">
          <Mini label={t("RDV aujourd'hui")} value={String(overview.count)} />
          <Mini label={t("Prévu aujourd'hui")} value={fmtMoney(overview.revenue, lang)} />
          <Mini label={t("RDV sur 7 jours")} value={String(overview.weekCount)} />
          <Mini label={t("Réservés en ligne (7 j)")} value={String(overview.onlineLast7)} />
        </div>
        {bookingUrl && (
          <div className="glass glow-border rounded-[2rem] p-5 animate-fade-up [animation-delay:0.1s]">
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              <SparkleIcon width={16} height={16} className="text-champagne" /> {t("Votre page de réservation")}
            </p>
            <p className="mt-1 text-xs text-white/50">{t("À partager sur Instagram, WhatsApp ou Google Maps.")}</p>
            <div className="mt-3 flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-black/30 px-3 py-2 text-xs text-white/70" dir="ltr">{bookingUrl}</code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(bookingUrl).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
                className="rounded-xl bg-white/10 px-3 text-xs text-white hover:bg-white/15"
              >
                {copied ? t("Copié !") : t("Copier")}
              </button>
            </div>
            <a href={bookingUrl} target="_blank" rel="noreferrer" className="btn-shine mt-3 block rounded-xl py-2.5 text-center text-sm font-semibold text-plum-950">
              {t("Voir la page")}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3">
      <p className="font-display text-xl text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}

type MyBooking = { id: string; start: string; status: BookingStatus; services: string; center: string; totalTnd: number };

// Compte client : ses rendez-vous à venir et passés.
export function MyBookings({ bookings, bookingUrl }: { bookings: MyBooking[]; bookingUrl: string | null }) {
  const { t, lang } = useI18n();
  const now = new Date().toISOString();
  // À venir d'abord (du plus proche au plus lointain), puis l'historique (du plus récent au plus ancien).
  const ordered = [
    ...bookings.filter((b) => b.start > now).sort((a, b) => a.start.localeCompare(b.start)),
    ...bookings.filter((b) => b.start <= now),
  ];
  return (
    <section className="glass mt-10 rounded-[2rem] p-6 animate-fade-up">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-white">{t("Mes rendez-vous")}</h2>
        {bookingUrl && (
          <a href={bookingUrl} className="btn-shine rounded-xl px-4 py-2 text-sm font-semibold text-plum-950">
            {t("Réserver")}
          </a>
        )}
      </div>
      {bookings.length === 0 ? (
        <p className="text-sm text-white/50">{t("Aucun rendez-vous pour le moment.")}</p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((b) => (
            <li key={b.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ${b.start > now ? "bg-rose-gold/10" : "bg-white/[0.03]"}`}>
              <span className="w-44 text-sm capitalize text-white">
                {fmtDay(b.start, lang, { weekday: "short", day: "numeric", month: "short" })} · <span dir="ltr">{fmtTime(b.start, lang)}</span>
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/70">{b.services} · {b.center}</span>
              <span className="text-sm text-white">{fmtMoney(b.totalTnd, lang)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${STATUS_META[b.status].chip}`}>{t(STATUS_META[b.status].label)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
