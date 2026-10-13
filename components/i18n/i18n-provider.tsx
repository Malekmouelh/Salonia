"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AR } from "@/lib/i18n-ar";

export type Lang = "fr" | "ar";

// Le français est la langue source : chaque texte sert de clé pour sa traduction arabe.
// La langue choisie est gardée dans le navigateur (localStorage).
const STORAGE_KEY = "lang";
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "ar" ? "ar" : "fr";
  } catch {
    return "fr";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyToDocument(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export function setLang(lang: Lang) {
  const update = () => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
    applyToDocument(lang);
    flushSync(() => listeners.forEach((l) => l()));
  };
  // Transition animée entre les deux langues quand le navigateur la supporte.
  if (typeof document.startViewTransition === "function") document.startViewTransition(update);
  else update();
}

export function translate(lang: Lang, text: string) {
  return lang === "ar" ? (AR[text] ?? text) : text;
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, readLang, () => "fr" as Lang);
  const t = useCallback((text: string) => translate(lang, text), [lang]);
  return { lang, t, dir: lang === "ar" ? "rtl" : "ltr" };
}

// Pour traduire un texte depuis un Server Component : <T>Bonjour</T>
export function T({ children }: { children: string }) {
  const { t } = useI18n();
  return <>{t(children)}</>;
}

// Script exécuté avant le premier affichage : applique la direction RTL sans flash de mise en page.
export const LANG_BOOT_SCRIPT = `try{if(localStorage.getItem("${STORAGE_KEY}")==="ar"){document.documentElement.lang="ar";document.documentElement.dir="rtl"}}catch(e){}`;

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang } = useI18n();
  const options: { value: Lang; label: ReactNode }[] = [
    { value: "fr", label: "FR" },
    { value: "ar", label: "عربي" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Langue / اللغة"
      dir="ltr"
      className={`relative inline-grid grid-cols-2 rounded-full border border-white/10 bg-white/5 p-1 text-xs backdrop-blur ${className}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-gradient-to-r from-blush to-champagne shadow-[0_0_16px_rgb(232_180_160/0.5)] transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]"
        style={{ transform: lang === "ar" ? "translateX(100%)" : "none" }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={lang === o.value}
          onClick={() => lang !== o.value && setLang(o.value)}
          className={`relative z-10 min-w-12 rounded-full px-3 py-1.5 font-semibold transition-colors duration-300 ${
            lang === o.value ? "text-plum-950" : "text-white/60 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
