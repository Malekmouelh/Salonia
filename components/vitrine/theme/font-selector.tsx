"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { CheckIcon, PlusIcon, SearchIcon, SparkleIcon, TrashIcon } from "@/components/ui/icons";
import { FONT_OPTIONS } from "@/lib/vitrine/schemas";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const CUSTOM_FONT_LINK_ID = "vitrine-custom-font-import";

/** Construit une URL Google Fonts sûre (sans axes de poids qui casseraient
 *  des polices comme Pinyon Script qui ne supportent qu'un seul poids). */
function buildGoogleFontsUrl(fontName: string): string {
  return `https://fonts.googleapis.com/css2?family=${fontName.trim().replace(/\s+/g, "+")}&display=swap`;
}

/** Injecte (ou met à jour) un <link> Google Fonts dans le <head>.
 *  Retourne une promesse qui résout au chargement / rejette en cas d'erreur. */
function injectFontStylesheet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let link = document.getElementById(CUSTOM_FONT_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = CUSTOM_FONT_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href === url) {
      resolve();
      return;
    }
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Impossible de charger la feuille de style."));
    link.href = url;
  });
}

/* ─── Props ───────────────────────────────────────────────────────────────── */

interface FontSelectorProps {
  fontFamily: string;
  setFontFamily: (font: string) => void;
  customFontUrl: string;
  setCustomFontUrl: (url: string) => void;
  salonName: string;
  tagline: string;
  primaryColor: string;
}

/* ─── Composant ───────────────────────────────────────────────────────────── */

export function FontSelector({
  fontFamily,
  setFontFamily,
  customFontUrl,
  setCustomFontUrl,
  salonName,
  tagline,
  primaryColor,
}: FontSelectorProps) {
  const { t } = useI18n();
  const searchInputId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ── Charger la police personnalisée déjà sauvegardée au montage ──
  useEffect(() => {
    if (customFontUrl) injectFontStylesheet(customFontUrl).catch(() => {});
  }, [customFontUrl]);

  // ── Filtrage instantané des polices prédéfinies ──
  const filteredFonts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return FONT_OPTIONS;
    return FONT_OPTIONS.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q) ||
        ("category" in f && (f as any).category?.toLowerCase().includes(q)),
    );
  }, [searchQuery]);

  // ── Résolution de la police active ──
  const activeFontOption = FONT_OPTIONS.find(
    (f) => f.value.toLowerCase() === fontFamily?.toLowerCase(),
  );
  const activeCssFont = activeFontOption
    ? activeFontOption.cssFont
    : `'${fontFamily}', system-ui, sans-serif`;
  const activeLabel = activeFontOption ? activeFontOption.label : fontFamily;
  const activeDesc = activeFontOption ? activeFontOption.description : t("Police importée");

  // ── Import d'une police externe (Google Fonts) ──
  const handleImportFont = async () => {
    setImportError(null);
    setImportSuccess(null);
    const input = customInput.trim();

    if (!input) {
      setImportError(t("Saisissez un nom de police Google Fonts ou une URL."));
      return;
    }

    let fontName = "";
    let fontUrl = "";

    if (input.includes("http") || input.includes("@import")) {
      // L'utilisateur a collé une URL complète ou un @import
      const urlMatch = input.match(/https?:\/\/[^\s'")]+/);
      if (!urlMatch) {
        setImportError(t("URL invalide. Collez une URL Google Fonts complète."));
        return;
      }
      fontUrl = urlMatch[0];
      const familyMatch = fontUrl.match(/family=([^:&]+)/);
      fontName = familyMatch
        ? decodeURIComponent(familyMatch[1].replace(/\+/g, " "))
        : input;
    } else {
      // L'utilisateur a tapé un nom de police (ex: "Pinyon Script")
      fontName = input;
      fontUrl = buildGoogleFontsUrl(fontName);
    }

    setIsImporting(true);
    try {
      await injectFontStylesheet(fontUrl);
      setFontFamily(fontName);
      setCustomFontUrl(fontUrl);
      setImportSuccess(`✓ « ${fontName} »`);
      setCustomInput("");
    } catch {
      setImportError(t("Police introuvable sur Google Fonts. Vérifiez l'orthographe exacte."));
    } finally {
      setIsImporting(false);
    }
  };

  const handleResetCustom = () => {
    setFontFamily("playfair");
    setCustomFontUrl("");
    setImportSuccess(null);
    setImportError(null);
    setCustomInput("");
    const el = document.getElementById(CUSTOM_FONT_LINK_ID);
    if (el) el.remove();
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
      {/* En-tête */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg text-white">
          <SparkleIcon width={18} height={18} className="text-rose-gold" />
          {t("Typographie & Textes d'accueil")}
        </h3>
        <span className="rounded-full border border-rose-gold/30 bg-rose-gold/15 px-3 py-1 text-xs font-semibold text-rose-gold">
          {activeLabel}
        </span>
      </div>

      {/* ── Banc d'essai typographique in-situ ──────────────────────── */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-rose-gold/30 bg-black/40 p-5 shadow-2xl backdrop-blur">
        <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-gold">
            {t("Aperçu direct de la police active")}
          </span>
          <span className="text-[11px] text-white/50">{activeDesc}</span>
        </div>
        <div
          className="text-2xl font-bold tracking-tight transition-all duration-200 sm:text-3xl"
          style={{ fontFamily: activeCssFont, color: primaryColor }}
        >
          {salonName || "Salon Yasmine"}
        </div>
        <p
          className="mt-1 text-sm italic text-white/80 transition-all duration-200"
          style={{ fontFamily: activeCssFont }}
        >
          {tagline || t("L'art de sublimer votre beauté au quotidien")}
        </p>
        <div
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3 text-xs opacity-75"
          style={{ fontFamily: activeCssFont }}
        >
          <span className="font-semibold text-rose-gold">{t("Exemples")} :</span>
          <span className="rounded-lg bg-white/10 px-2 py-0.5">Balayage & Brushing</span>
          <span className="rounded-lg bg-white/10 px-2 py-0.5">Soin Visage Éclat</span>
          <span className="rounded-lg bg-white/10 px-2 py-0.5">Pack Mariée 160 TND</span>
        </div>
      </div>

      {/* ── Recherche ───────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor={searchInputId} className="text-xs font-semibold uppercase tracking-wider text-white/70">
            {t("Rechercher une typographie")}
          </label>
          <span className="text-[11px] text-white/40">
            {filteredFonts.length} / {FONT_OPTIONS.length}
          </span>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 start-3.5 flex items-center text-white/40">
            <SearchIcon width={16} height={16} />
          </div>
          <input
            id={searchInputId}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("Filtrer par nom (Inter, Cairo, Serif…)")}
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pe-10 ps-10 text-sm text-white placeholder-white/30 outline-none transition focus:border-rose-gold focus:bg-white/[0.08]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 end-3 flex items-center text-xs text-white/40 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Liste des polices prédéfinies ───────────────────────────── */}
      <div className="mb-6 max-h-72 space-y-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {filteredFonts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-white/40">
            {t("Aucune police trouvée.")} {t("Essayez de l'importer ci-dessous !")}
          </div>
        ) : (
          filteredFonts.map((f) => {
            const isSelected = fontFamily.toLowerCase() === f.value.toLowerCase();
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFontFamily(f.value)}
                className={`group relative flex w-full flex-col gap-1.5 rounded-2xl border p-3.5 text-start transition-all duration-200 ${
                  isSelected
                    ? "border-rose-gold bg-rose-gold/15 shadow-lg shadow-rose-gold/10 ring-2 ring-rose-gold/40"
                    : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white transition-colors group-hover:text-rose-gold">
                      {f.label}
                    </span>
                    {"category" in f && (
                      <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/60">
                        {(f as any).category}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70 sm:inline">
                      {f.description}
                    </span>
                    {isSelected ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-gold text-plum-950 shadow-sm">
                        <CheckIcon width={12} height={12} />
                      </span>
                    ) : (
                      <span className="h-5 w-5 rounded-full border border-white/20" />
                    )}
                  </div>
                </div>
                <div className="mt-0.5 text-base font-semibold text-white/90" style={{ fontFamily: f.cssFont }}>
                  {salonName || "Salon Yasmine"} — Soins & Haute Beauté
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ── Import externe (Google Fonts) ───────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-gold">
            <PlusIcon width={14} height={14} />
            {t("Importer une police Google Fonts")}
          </label>
          {customFontUrl && (
            <button
              type="button"
              onClick={handleResetCustom}
              className="flex items-center gap-1 text-[11px] text-red-300/80 hover:text-red-200"
            >
              <TrashIcon width={12} height={12} />
              {t("Réinitialiser")}
            </button>
          )}
        </div>

        <p className="mb-3 text-[11px] text-white/50">
          {t("Tapez le nom exact de la police (ex: Pinyon Script, Cinzel, Great Vibes) ou collez une URL Google Fonts.")}
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={customInput}
            onChange={(e) => {
              setCustomInput(e.target.value);
              setImportError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleImportFont();
              }
            }}
            placeholder="ex. Pinyon Script"
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-rose-gold"
          />
          <button
            type="button"
            onClick={handleImportFont}
            disabled={isImporting}
            className="rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-gold hover:text-plum-950 disabled:opacity-50"
          >
            {isImporting ? t("Chargement…") : t("Charger & Appliquer")}
          </button>
        </div>

        {importError && (
          <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
            {importError}
          </p>
        )}
        {importSuccess && (
          <p className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs text-emerald-300">
            {importSuccess}
          </p>
        )}
      </div>
    </div>
  );
}
