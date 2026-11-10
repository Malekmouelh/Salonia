"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";

interface AmbientModeSelectorProps {
  colorMode: "dark" | "light" | "auto";
  setColorMode: (mode: "dark" | "light" | "auto") => void;
}

export function AmbientModeSelector({ colorMode, setColorMode }: AmbientModeSelectorProps) {
  const { t } = useI18n();
  const [systemIsDark, setSystemIsDark] = useState(true);

  // Écoute dynamique de prefers-color-scheme
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemIsDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const options: Array<{
    value: "dark" | "light" | "auto";
    label: string;
    subtitle: string;
    icon: string;
    previewBg: string;
    previewText: string;
  }> = [
    {
      value: "dark",
      label: "Sombre",
      subtitle: t("Luxe, intimiste"),
      icon: "🌙",
      previewBg: "#180916",
      previewText: "#ffffff",
    },
    {
      value: "light",
      label: "Clair",
      subtitle: t("Épuré, lumineux"),
      icon: "☀️",
      previewBg: "#fcfaf8",
      previewText: "#1a1a1a",
    },
    {
      value: "auto",
      label: "Automatique",
      subtitle: systemIsDark ? t("Système : Sombre") : t("Système : Clair"),
      icon: "🌓",
      previewBg: systemIsDark ? "#180916" : "#fcfaf8",
      previewText: systemIsDark ? "#ffffff" : "#1a1a1a",
    },
  ];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-lg text-white">
          <SparkleIcon width={18} height={18} className="text-rose-gold" />
          {t("Ambiance générale")}
        </h3>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
          {colorMode === "auto"
            ? `${t("Auto")} (${systemIsDark ? "🌙" : "☀️"})`
            : colorMode === "light"
              ? `☀️ ${t("Clair")}`
              : `🌙 ${t("Sombre")}`}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {options.map((opt) => {
          const isSelected = colorMode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setColorMode(opt.value)}
              className={`group relative flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all duration-200 ${
                isSelected
                  ? "border-rose-gold bg-rose-gold/15 shadow-lg shadow-rose-gold/10 ring-2 ring-rose-gold/40"
                  : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
              }`}
            >
              {/* Mini-aperçu du mode */}
              <div
                className="flex h-10 w-full items-center justify-center rounded-lg border border-white/10 text-[10px] font-bold transition-colors"
                style={{ backgroundColor: opt.previewBg, color: opt.previewText }}
              >
                Salon
              </div>

              <span className="text-lg">{opt.icon}</span>
              <span className="text-xs font-bold text-white transition-colors group-hover:text-rose-gold">
                {t(opt.label)}
              </span>
              <span className="text-[10px] text-white/50">{opt.subtitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
