"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/ui/icons";

// Titre du calendrier cliquable : choix direct d'un mois (avant ou après), année par année.
export function MonthPicker({ title, date, onSelect }: { title: string; date: string; onSelect: (day: string) => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(date.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);
  const current = date.slice(0, 7); // YYYY-MM affiché
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthName = (m: number) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-TN" : "fr-FR", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m, 1)));

  // Fermeture au clic à l'extérieur ou avec Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setYear(Number(date.slice(0, 4)));
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group flex items-center gap-2 rounded-2xl px-2 py-1 transition hover:bg-white/[0.06]"
      >
        <h1 className="font-display text-2xl capitalize text-white sm:text-3xl">{title}</h1>
        <svg className={`text-white/50 transition group-hover:text-champagne ${open ? "rotate-180" : ""}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label={t("Choisir un mois")} className="absolute start-0 top-full z-50 mt-2 w-72 rounded-3xl border border-white/15 bg-plum-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl animate-fade-up">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setYear((y) => y - 1)} aria-label={t("Année précédente")} className="grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white">
              <ArrowLeftIcon width={16} height={16} className="rtl:-scale-x-100" />
            </button>
            <span className="font-display text-xl text-white">{year}</span>
            <button type="button" onClick={() => setYear((y) => y + 1)} aria-label={t("Année suivante")} className="grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white">
              <ArrowRightIcon width={16} height={16} className="rtl:-scale-x-100" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, m) => {
              const key = `${year}-${String(m + 1).padStart(2, "0")}`;
              const selected = key === current;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(`${key}-01`);
                  }}
                  className={`relative rounded-xl py-2.5 text-sm capitalize transition ${
                    selected
                      ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950"
                      : "text-white/75 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {monthName(m)}
                  {key === thisMonth && !selected && <span className="absolute end-2 top-1.5 h-1.5 w-1.5 rounded-full bg-champagne" aria-hidden />}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSelect(`${thisMonth}-01`);
            }}
            className="mt-3 w-full rounded-xl border border-white/10 py-2 text-xs text-white/70 transition hover:border-rose-gold/40 hover:text-white"
          >
            {t("Revenir au mois en cours")}
          </button>
        </div>
      )}
    </div>
  );
}
