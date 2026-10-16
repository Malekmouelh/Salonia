"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { CalendarIcon, CheckIcon } from "@/components/ui/icons";
import { fmtDay, fmtDuration, fmtMoney, fmtTime } from "@/lib/booking/format";
import type { PublicSalon } from "@/lib/data/public-salon";

// Écran de confirmation : récapitulatif, ajout à l'agenda (.ics) et lien de gestion.
export function BookingSuccess({
  salon,
  center,
  summary,
  start,
  manageUrl,
  staffName,
}: {
  salon: PublicSalon;
  center: PublicSalon["centers"][number];
  summary: { label: string; price: number; minutes: number };
  start: string;
  manageUrl: string;
  staffName: string;
}) {
  const { t, lang } = useI18n();
  const end = new Date(new Date(start).getTime() + summary.minutes * 60000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Salonia//Reservation//FR",
    "BEGIN:VEVENT",
    `UID:${stamp(new Date(start))}-${salon.slug}@salonia`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(start))}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${summary.label} — ${salon.name}`,
    `LOCATION:${center.name}`,
    `DESCRIPTION:Gérer ma réservation : ${manageUrl}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Rendez-vous dans 2 heures",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="relative mx-auto mt-4 grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 rounded-full bg-emerald-400/30" style={{ animation: "pulse-ring 1.8s ease-out infinite" }} />
        <span className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-emerald-500 text-plum-950 animate-fade-up">
          <CheckIcon width={44} height={44} />
        </span>
      </div>
      <h1 className="mt-6 font-display text-4xl text-white animate-fade-up [animation-delay:0.1s]">
        {t("C'est réservé")} <span className="text-gradient italic">!</span>
      </h1>
      <p className="mt-2 text-white/60 animate-fade-up [animation-delay:0.15s]">{t("Un message de confirmation vous a été envoyé.")}</p>

      <div className="glass glow-border mt-8 rounded-[2rem] p-6 text-start animate-fade-up [animation-delay:0.2s]">
        <p className="text-lg capitalize text-white">{fmtDay(start, lang)}</p>
        <p className="text-white/70" dir="ltr">
          {fmtTime(start, lang)} – {fmtTime(end, lang)}
        </p>
        <div className="mt-4 space-y-1 text-sm text-white/70">
          <p>{summary.label} · {fmtDuration(summary.minutes)}</p>
          <p>{center.name}{staffName && ` · ${t("avec")} ${staffName}`}</p>
          <p className="font-semibold text-white">{fmtMoney(summary.price, lang)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 animate-fade-up [animation-delay:0.25s]">
        <a
          href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`}
          download="rendez-vous-salonia.ics"
          className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3.5 text-sm text-white hover:bg-white/10"
        >
          <CalendarIcon width={18} height={18} /> {t("Ajouter à mon agenda")}
        </a>
        <a href={manageUrl} className="btn-shine flex items-center justify-center rounded-2xl py-3.5 text-sm font-semibold text-plum-950">
          {t("Gérer ma réservation")}
        </a>
      </div>
      <p className="mt-4 text-xs text-white/40">{t("Gardez ce lien : il permet d'annuler ou de reporter jusqu'à 2 h avant.")}</p>
      <Link href="/" className="mt-6 inline-block text-sm text-white/60 underline-offset-4 hover:text-white hover:underline">
        {t("Retour à l'accueil")}
      </Link>
    </div>
  );
}
