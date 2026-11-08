"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { PaletteIcon } from "@/components/ui/icons";
import { COLOR_PRESETS } from "@/lib/vitrine/schemas";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/** Normalise n'importe quel format de couleur vers #rrggbb. */
function normalizeToHex(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Hex court ou long
  const hex = s.startsWith("#") ? s : `#${s}`;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  // rgb(r, g, b)
  const rgbMatch = s.match(/(?:rgb\s*\(\s*)?(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?/i);
  if (rgbMatch) {
    const c = (n: string) => Math.min(255, Math.max(0, parseInt(n, 10)));
    const toHex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${toHex(c(rgbMatch[1]))}${toHex(c(rgbMatch[2]))}${toHex(c(rgbMatch[3]))}`;
  }

  return null;
}

/* ─── Sous-composant : un rôle de couleur (Primaire / Fond / Accent) ────── */

function ColorRole({
  label,
  color,
  setColor,
}: {
  label: string;
  color: string;
  setColor: (c: string) => void;
}) {
  const [textInput, setTextInput] = useState(color);
  const [isValid, setIsValid] = useState(true);

  const handleTextChange = (val: string) => {
    setTextInput(val);
    const hex = normalizeToHex(val);
    if (hex) {
      setColor(hex);
      setIsValid(true);
    } else {
      setIsValid(val.trim().length === 0);
    }
  };

  // Synchroniser quand la couleur change depuis l'extérieur (preset, picker)
  const handlePickerChange = (val: string) => {
    setColor(val);
    setTextInput(val);
    setIsValid(true);
  };

  // Synchronisation si la prop change depuis l'extérieur
  if (color !== textInput && normalizeToHex(textInput) !== color) {
    // On ne fait rien ici pour éviter des boucles, mais le picker reste synchronisé via `value={color}`
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Grande pastille cliquable avec color picker natif caché */}
      <div
        className="relative h-16 w-full cursor-pointer rounded-2xl border-2 border-white/20 shadow-lg transition-transform hover:scale-[1.03] active:scale-95 sm:h-20"
        style={{ backgroundColor: color }}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => handlePickerChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          title={label}
        />
      </div>

      {/* Libellé */}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
        {label}
      </span>

      {/* Champ texte hex éditable */}
      <input
        type="text"
        value={textInput}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={() => {
          // Au blur, resynchroniser avec la valeur effective
          setTextInput(color);
          setIsValid(true);
        }}
        placeholder="#RRGGBB"
        className={`w-full rounded-xl border px-2.5 py-1.5 text-center font-mono text-xs uppercase outline-none transition ${
          isValid
            ? "border-white/10 bg-white/5 text-white focus:border-rose-gold"
            : "border-red-400/50 bg-red-500/10 text-red-300"
        }`}
      />
    </div>
  );
}

/* ─── Composant principal ─────────────────────────────────────────────────── */

interface ColorPaletteManagerProps {
  primaryColor: string;
  setPrimaryColor: (c: string) => void;
  secondaryColor: string;
  setSecondaryColor: (c: string) => void;
  accentColor: string;
  setAccentColor: (c: string) => void;
}

export function ColorPaletteManager({
  primaryColor,
  setPrimaryColor,
  secondaryColor,
  setSecondaryColor,
  accentColor,
  setAccentColor,
}: ColorPaletteManagerProps) {
  const { t } = useI18n();

  const applyPreset = (preset: (typeof COLOR_PRESETS)[number]) => {
    setPrimaryColor(preset.primary);
    setSecondaryColor(preset.secondary);
    setAccentColor(preset.accent);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
      <h3 className="mb-5 flex items-center gap-2 font-display text-lg text-white">
        <PaletteIcon width={18} height={18} className="text-rose-gold" />
        {t("Palette de couleurs & Thème")}
      </h3>

      {/* ── Les 3 rôles de couleur ─────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <ColorRole
          label={t("Primaire")}
          color={primaryColor}
          setColor={setPrimaryColor}
        />
        <ColorRole
          label={t("Fond")}
          color={secondaryColor}
          setColor={setSecondaryColor}
        />
        <ColorRole
          label={t("Accent")}
          color={accentColor}
          setColor={setAccentColor}
        />
      </div>

      {/* ── Harmonies recommandées ─────────────────────────────────── */}
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
        {t("Harmonies recommandées")}
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {COLOR_PRESETS.map((p) => {
          const isActive = primaryColor === p.primary && secondaryColor === p.secondary && accentColor === p.accent;
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className={`flex items-center justify-between rounded-xl border p-2.5 text-start text-xs transition ${
                isActive
                  ? "border-rose-gold bg-rose-gold/15 text-white ring-1 ring-rose-gold/40"
                  : "border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/[0.08]"
              }`}
            >
              <span className="font-medium">{p.name}</span>
              <span className="flex items-center gap-1.5">
                <span className="h-4 w-4 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: p.primary }} />
                <span className="h-4 w-4 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: p.secondary }} />
                <span className="h-4 w-4 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: p.accent }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
