"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";
import { FONT_OPTIONS } from "@/lib/vitrine/schemas";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const PREVIEW_FONT_LINK_ID = "vitrine-preview-font-import";

function buildGoogleFontsUrl(fontName: string): string {
  return `https://fonts.googleapis.com/css2?family=${fontName.trim().replace(/\s+/g, "+")}&display=swap`;
}

/* ─── Props ───────────────────────────────────────────────────────────────── */

interface LivePreviewProps {
  salonName: string;
  slug: string;
  logo: string;
  banner: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  customFontUrl: string;
  colorMode: "dark" | "light" | "auto";
  tagline: string;
  description: string;
}

/* ─── Composant ───────────────────────────────────────────────────────────── */

export function LivePreview({
  salonName,
  slug,
  logo,
  banner,
  primaryColor,
  secondaryColor,
  accentColor,
  fontFamily,
  customFontUrl,
  colorMode,
  tagline,
  description,
}: LivePreviewProps) {
  const { t } = useI18n();
  const [systemIsDark, setSystemIsDark] = useState(true);

  // ── Écoute prefers-color-scheme pour le mode Auto ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemIsDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Résolution de la police ──
  const activeFontOption = FONT_OPTIONS.find(
    (f) =>
      f.value.toLowerCase() === fontFamily?.toLowerCase() ||
      f.label.toLowerCase() === fontFamily?.toLowerCase(),
  );
  const activeCssFont = activeFontOption
    ? activeFontOption.cssFont
    : `'${fontFamily}', system-ui, sans-serif`;
  const activeFontLabel = activeFontOption ? activeFontOption.label : fontFamily;

  // ── Injection du stylesheet pour les polices custom ──
  const builtinFontKeys = [
    "playfair",
    "cormorant",
    "outfit",
    "inter",
    "tajawal",
    "cairo",
    "amiri",
    "roboto",
    "poppins",
    "montserrat",
  ];
  const fontImportUrl =
    customFontUrl ||
    (!activeFontOption && fontFamily && !builtinFontKeys.includes(fontFamily.toLowerCase())
      ? buildGoogleFontsUrl(fontFamily)
      : null);

  useEffect(() => {
    if (!fontImportUrl) return;
    let link = document.getElementById(PREVIEW_FONT_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = PREVIEW_FONT_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = fontImportUrl;
  }, [fontImportUrl]);

  // ── Résolution du mode effectif (dark ou light) ──
  const isDark = colorMode === "auto" ? systemIsDark : colorMode === "dark";

  // ── Couleurs dérivées selon le mode ──
  const bg = isDark ? secondaryColor : "#fcfaf8";
  const textColor = isDark ? "#ffffff" : "#1a1a1a";
  const subtextColor = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)";
  const cardBg = isDark ? "rgba(255,255,255,0.04)" : "#ffffff";
  const cardBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
  const dividerColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)";

  return (
    <aside className="sticky top-6 z-20 flex max-h-[calc(100dvh-3rem)] flex-col overflow-y-auto rounded-3xl border border-white/15 bg-plum-950/95 p-5 shadow-2xl backdrop-blur-xl transition-all duration-300 [scrollbar-width:thin]">
      {/* ── En-tête du panneau avec indicateurs de couleurs ────────── */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-gold">
            {t("Aperçu direct")}
          </span>
          {/* Trio de pastilles montrant en direct Primaire, Fond, Accent */}
          <div className="ms-1 flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full border border-white/30 shadow-sm"
              style={{ backgroundColor: primaryColor }}
              title="Primaire"
            />
            <span
              className="h-2.5 w-2.5 rounded-full border border-white/30 shadow-sm"
              style={{ backgroundColor: secondaryColor }}
              title="Fond"
            />
            <span
              className="h-2.5 w-2.5 rounded-full border border-white/30 shadow-sm ring-1 ring-white/50"
              style={{ backgroundColor: accentColor }}
              title="Accent"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-rose-gold/30 bg-rose-gold/20 px-2 py-0.5 text-[10px] font-semibold text-rose-gold">
            {activeFontLabel}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isDark
                ? "border border-purple-500/30 bg-purple-900/40 text-purple-200"
                : "border border-amber-400/30 bg-amber-400/20 text-amber-200"
            }`}
          >
            {isDark ? "🌙" : "☀️"}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
            /{slug}
          </span>
        </div>
      </div>

      {/* ── Simulateur de la vitrine ──────────────────────────────── */}
      <div
        className="overflow-hidden rounded-2xl border shadow-2xl transition-all duration-300"
        style={{
          backgroundColor: bg,
          borderColor: `${primaryColor}40`,
          color: textColor,
        }}
      >
        {/* Liseré supérieur haute couture aux couleurs de la marque (Primaire -> Accent) */}
        <div
          className="h-1 w-full"
          style={{
            background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})`,
          }}
        />

        {/* Bannière */}
        <div
          className="relative h-32 w-full transition-all duration-300"
          style={{
            background: banner
              ? `url(${banner}) center / cover`
              : `linear-gradient(135deg, ${secondaryColor} 0%, ${primaryColor}40 50%, ${accentColor}60 100%)`,
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

          {/* Logo avec double anneau Primaire + Accent */}
          <div className="absolute -bottom-5 start-4">
            {logo ? (
              <img
                src={logo}
                alt={salonName}
                className="h-14 w-14 rounded-2xl border-2 object-cover shadow-xl transition-all duration-300"
                style={{
                  borderColor: primaryColor,
                  boxShadow: `0 0 0 2px ${accentColor}, 0 8px 24px -4px ${accentColor}60`,
                }}
              />
            ) : (
              <div
                className="grid h-14 w-14 place-items-center rounded-2xl border-2 text-lg font-bold shadow-xl transition-all duration-300"
                style={{
                  backgroundColor: primaryColor,
                  borderColor: accentColor,
                  color: isDark ? "#ffffff" : "#1a1a1a",
                  boxShadow: `0 0 0 2px ${accentColor}, 0 8px 24px -4px ${accentColor}60`,
                }}
              >
                {salonName.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>

          {/* Badge Salonia Élite rehaussé par l'accentColor */}
          <div
            className="absolute end-3 top-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold backdrop-blur transition-all duration-300"
            style={{
              border: `1px solid ${accentColor}60`,
              color: accentColor,
            }}
          >
            <SparkleIcon width={12} height={12} style={{ color: accentColor }} />
            <span>Salonia Élite</span>
          </div>
        </div>

        {/* Contenu textuel et prestations */}
        <div className="space-y-4 p-4 pt-8">
          {/* Nom du salon & Slogan */}
          <div>
            <h4
              className="text-2xl font-bold tracking-tight transition-all duration-200"
              style={{ color: primaryColor, fontFamily: activeCssFont }}
            >
              {salonName || "Salon Yasmine"}
            </h4>

            <p
              className="mt-1 text-xs italic transition-all duration-200"
              style={{ color: subtextColor, fontFamily: activeCssFont }}
            >
              {tagline || t("L'art de sublimer votre beauté au quotidien")}
            </p>

            {/* Note & Badges d'évaluation sublimés par l'accentColor */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              <div
                className="flex items-center gap-1 font-bold transition-colors duration-200"
                style={{ color: accentColor }}
              >
                <span>★ 4.9</span>
              </div>
              <span className="text-[11px]" style={{ color: subtextColor }}>
                (128 avis clientes)
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors duration-200"
                style={{
                  backgroundColor: `${accentColor}20`,
                  color: accentColor,
                  border: `1px solid ${accentColor}40`,
                }}
              >
                Recommandé
              </span>
            </div>
          </div>

          <p className="line-clamp-2 text-[11px] leading-relaxed" style={{ color: subtextColor }}>
            {description || t("Bienvenue dans notre espace de détente et de soins haut de gamme.")}
          </p>

          {/* Prestations avec étiquettes d'accent */}
          <div className="space-y-2 border-t pt-3" style={{ borderColor: dividerColor }}>
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: primaryColor }}
              >
                {t("Prestations phares")}
              </span>
              <span
                className="text-[9px] font-medium"
                style={{ color: accentColor }}
              >
                ✦ Soins signatures
              </span>
            </div>

            {[
              {
                name: "Brushing Glamour & Soin",
                duration: "45 min",
                price: "35 TND",
                badge: "Populaire",
              },
              {
                name: "Soin Visage Hydratant Éclat",
                duration: "60 min",
                price: "75 TND",
                badge: "Coup de cœur",
              },
            ].map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between rounded-xl border p-2.5 transition"
                style={{ backgroundColor: cardBg, borderColor: cardBorder }}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="block text-xs font-semibold"
                      style={{ fontFamily: activeCssFont, color: primaryColor }}
                    >
                      {s.name}
                    </span>
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: `${accentColor}20`,
                        color: accentColor,
                        border: `1px solid ${accentColor}35`,
                      }}
                    >
                      {s.badge}
                    </span>
                  </div>
                  <span className="text-[10px]" style={{ color: subtextColor }}>
                    {s.duration}
                  </span>
                </div>
                {/* Prix illuminé par l'accentColor */}
                <span
                  className="rounded-lg px-2.5 py-1 font-mono text-xs font-bold transition-colors duration-200"
                  style={{
                    backgroundColor: `${accentColor}20`,
                    color: accentColor,
                    border: `1px solid ${accentColor}40`,
                  }}
                >
                  {s.price}
                </span>
              </div>
            ))}
          </div>

          {/* Boutons d'action */}
          <div className="flex gap-2 pt-2">
            <span
              className="flex-1 rounded-xl py-2.5 text-center text-xs font-bold shadow-md transition hover:brightness-105"
              style={{
                backgroundColor: primaryColor,
                color: isDark ? "#1a0a14" : "#ffffff",
              }}
            >
              {t("Prendre rendez-vous")}
            </span>
            <span
              className="rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors duration-200"
              style={{
                borderColor: `${accentColor}80`,
                color: accentColor,
                backgroundColor: `${accentColor}12`,
              }}
            >
              {t("Partager")}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-white/40">
        {t("Modifications appliquées en temps réel.")}
      </p>
    </aside>
  );
}
