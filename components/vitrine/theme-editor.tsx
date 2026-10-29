"use client";

import { useActionState, useEffect, useState } from "react";
import { updateThemeAction } from "@/app/actions/vitrine";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, SubmitButton } from "@/components/ui/form";
import { CheckIcon, PaletteIcon, SparkleIcon, TrashIcon } from "@/components/ui/icons";
import { ImageUploader } from "@/components/ui/image-uploader";
import { Toast } from "@/components/ui/modal";
import {
  COLOR_PRESETS,
  FONT_OPTIONS,
  type ThemeConfig,
  type VitrineFont,
} from "@/lib/vitrine/schemas";

export function ThemeEditor({
  initialTheme,
  salonName,
  slug,
}: {
  initialTheme: ThemeConfig;
  salonName: string;
  slug: string;
}) {
  const { t } = useI18n();
  const [state, formAction, isPending] = useActionState(updateThemeAction, undefined);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Valeurs locales pour prévisualisation en temps réel
  const [logo, setLogo] = useState<string>(initialTheme.logo || "");
  const [banner, setBanner] = useState<string>(initialTheme.banner || "");
  const [primaryColor, setPrimaryColor] = useState<string>(initialTheme.primaryColor || "#e8b4a0");
  const [secondaryColor, setSecondaryColor] = useState<string>(initialTheme.secondaryColor || "#2a0f25");
  const [accentColor, setAccentColor] = useState<string>(initialTheme.accentColor || "#f3d9cf");
  const [fontFamily, setFontFamily] = useState<VitrineFont>(initialTheme.fontFamily || "playfair");
  const [colorMode, setColorMode] = useState<"dark" | "light" | "auto">(initialTheme.colorMode || "dark");
  const [tagline, setTagline] = useState<string>(initialTheme.tagline || "");
  const [description, setDescription] = useState<string>(initialTheme.description || "");

  const activeFont = FONT_OPTIONS.find((f) => f.value === fontFamily) || FONT_OPTIONS[0];

  // Quand la personnalisation est enregistrée avec succès : afficher le pop-up toast et réinitialiser
  useEffect(() => {
    if (state?.success) {
      setToastMessage(state.success);
      setLogo("");
      setBanner("");
      setPrimaryColor("#e8b4a0");
      setSecondaryColor("#2a0f25");
      setAccentColor("#f3d9cf");
      setFontFamily("playfair");
      setColorMode("dark");
      setTagline("");
      setDescription("");
    }
  }, [state?.success]);

  const handleClearAll = () => {
    setLogo("");
    setBanner("");
    setPrimaryColor("#e8b4a0");
    setSecondaryColor("#2a0f25");
    setAccentColor("#f3d9cf");
    setFontFamily("playfair");
    setColorMode("dark");
    setTagline("");
    setDescription("");
  };

  const applyPreset = (preset: (typeof COLOR_PRESETS)[number]) => {
    setPrimaryColor(preset.primary);
    setSecondaryColor(preset.secondary);
    setAccentColor(preset.accent);
  };

  return (
    <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
      {/* Formulaire de configuration */}
      <div className="lg:col-span-7">
        <form action={formAction} className="space-y-6">
          {state?.message && <Alert tone="error">{state.message}</Alert>}
          {state?.success && <Alert tone="success">{state.success}</Alert>}

          {/* Champs cachés pour le logo et la bannière encodés */}
          <input type="hidden" name="logo" value={logo} />
          <input type="hidden" name="banner" value={banner} />
          <input type="hidden" name="primaryColor" value={primaryColor} />
          <input type="hidden" name="secondaryColor" value={secondaryColor} />
          <input type="hidden" name="accentColor" value={accentColor} />
          <input type="hidden" name="fontFamily" value={fontFamily} />
          <input type="hidden" name="colorMode" value={colorMode} />

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 1 : Logo & Bannière                                 */}
          {/* ─────────────────────────────────────────────────────────── */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-white">
              <SparkleIcon width={18} height={18} className="text-rose-gold" />
              {t("Identité visuelle")}
            </h3>

            <div className="space-y-5">
              <ImageUploader
                label={t("Logo du salon")}
                hint={t("Format carré ou rond recommandé (PNG transparent, WebP)")}
                photos={logo ? [logo] : []}
                maxPhotos={1}
                onChange={(photos) => setLogo(photos[0] || "")}
              />

              <ImageUploader
                label={t("Bannière d'en-tête de la vitrine")}
                hint={t("Image panoramique haute résolution pour accueillir vos clientes")}
                photos={banner ? [banner] : []}
                maxPhotos={1}
                onChange={(photos) => setBanner(photos[0] || "")}
              />
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 2 : Typographie & Textes (HAUTE VISIBILITÉ)         */}
          {/* ─────────────────────────────────────────────────────────── */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg text-white">
                <SparkleIcon width={18} height={18} className="text-rose-gold" />
                {t("Typographie & Textes d'accueil")}
              </h3>
              <span className="rounded-full bg-rose-gold/15 border border-rose-gold/30 px-3 py-1 text-xs font-semibold text-rose-gold">
                {activeFont.label}
              </span>
            </div>

            {/* BANC D'ESSAI TYPOGRAPHIQUE EN DIRECT (In-Situ Tester) */}
            <div className="mb-6 overflow-hidden rounded-2xl border border-rose-gold/30 bg-black/40 p-5 shadow-2xl backdrop-blur">
              <div className="mb-2.5 flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-rose-gold">
                  {t("Aperçu direct de la police sélectionnée")}
                </span>
                <span className="text-[11px] text-white/50">
                  {activeFont.description}
                </span>
              </div>

              {/* Titre dynamique */}
              <div
                className="text-2xl sm:text-3xl font-bold tracking-tight transition-all duration-200"
                style={{ fontFamily: activeFont.cssFont, color: primaryColor }}
              >
                {salonName || "Salon Yasmine"}
              </div>

              {/* Slogan dynamique */}
              <p
                className="mt-1 text-sm text-white/80 italic transition-all duration-200"
                style={{ fontFamily: activeFont.cssFont }}
              >
                {tagline || t("L'art de sublimer votre beauté au quotidien")}
              </p>

              {/* Échantillons de titres de prestations */}
              <div
                className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3 text-xs opacity-75"
                style={{ fontFamily: activeFont.cssFont }}
              >
                <span className="font-semibold text-rose-gold">{t("Exemples")} :</span>
                <span className="rounded-lg bg-white/10 px-2 py-0.5">Balayage & Brushing</span>
                <span className="rounded-lg bg-white/10 px-2 py-0.5">Soin Visage Éclat</span>
                <span className="rounded-lg bg-white/10 px-2 py-0.5">Pack Mariée 160 TND</span>
              </div>
            </div>

            {/* Sélecteur de Polices sous forme de Cartes Comparatives */}
            <div className="mb-6 space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
                {t("Choisissez la police des titres")}
              </label>

              <div className="space-y-2.5">
                {FONT_OPTIONS.map((f) => {
                  const isSelected = fontFamily === f.value;
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
                        <span className="text-sm font-bold text-white group-hover:text-rose-gold transition-colors">
                          {f.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium text-white/70">
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

                      {/* Échantillon réel du nom du salon dans cette police */}
                      <div
                        className="mt-0.5 text-lg font-bold text-white/90"
                        style={{ fontFamily: f.cssFont }}
                      >
                        {salonName || "Salon Yasmine"} — Soins & Haute Beauté
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slogan & Description */}
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Slogan accrocheur")}
                </label>
                <input
                  name="tagline"
                  value={tagline}
                  maxLength={140}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="ex. L'art de sublimer votre beauté au quotidien"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-rose-gold"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Description de présentation")}
                </label>
                <textarea
                  name="description"
                  rows={3}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Présentez votre salon, votre expertise et votre ambiance..."
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-rose-gold"
                />
              </div>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 3 : Palette de couleurs & Thème                     */}
          {/* ─────────────────────────────────────────────────────────── */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <h3 className="mb-4 flex items-center gap-2 font-display text-lg text-white">
              <PaletteIcon width={18} height={18} className="text-rose-gold" />
              {t("Palette de couleurs & Thème")}
            </h3>

            {/* Préréglages recommandés */}
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
              {t("Harmonies recommandées")}
            </label>
            <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {COLOR_PRESETS.map((p) => {
                const isActive = primaryColor === p.primary && secondaryColor === p.secondary;
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`flex items-center justify-between rounded-xl border p-2.5 text-start text-xs transition ${
                      isActive
                        ? "border-rose-gold bg-rose-gold/15 text-white"
                        : "border-white/10 bg-white/5 text-white/80 hover:border-white/20"
                    }`}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-4 w-4 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: p.primary }} />
                      <span className="h-4 w-4 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: p.secondary }} />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sélecteurs individuels */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Couleur Primaire")}
                </label>
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent"
                  />
                  <span className="text-xs font-mono text-white/80">{primaryColor}</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Fond & Contraste")}
                </label>
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent"
                  />
                  <span className="text-xs font-mono text-white/80">{secondaryColor}</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Accents & Éclat")}
                </label>
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent"
                  />
                  <span className="text-xs font-mono text-white/80">{accentColor}</span>
                </div>
              </div>
            </div>

            {/* Mode Sombre / Clair */}
            <div className="mt-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
                {t("Ambiance générale")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "dark", label: "Sombre (Luxe)" },
                  { value: "light", label: "Clair (Épuré)" },
                  { value: "auto", label: "Automatique" },
                ].map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setColorMode(mode.value as any)}
                    className={`rounded-xl border py-2.5 text-center text-xs font-medium transition ${
                      colorMode === mode.value
                        ? "border-rose-gold bg-rose-gold/20 text-white"
                        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {t(mode.label)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 4 : Réseaux sociaux                                 */}
          {/* ─────────────────────────────────────────────────────────── */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <h3 className="mb-4 font-display text-lg text-white">
              {t("Réseaux sociaux & Contact direct")}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Instagram (@votrecompte)"
                name="instagram"
                defaultValue={initialTheme.instagram}
              />
              <Field
                label="Facebook (page ou lien)"
                name="facebook"
                defaultValue={initialTheme.facebook}
              />
              <Field
                label="TikTok (@votrecompte)"
                name="tiktok"
                defaultValue={initialTheme.tiktok}
              />
              <Field
                label="WhatsApp (+216...)"
                name="whatsapp"
                defaultValue={initialTheme.whatsapp}
              />
            </div>
          </div>

          {/* Boutons d'action */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <SubmitButton pending={isPending}>
                {t("Enregistrer la personnalisation")}
              </SubmitButton>
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/70 transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
              title={t("Réinitialiser tous les champs")}
            >
              <TrashIcon width={16} height={16} />
              <span className="hidden sm:inline">{t("Vider")}</span>
            </button>
          </div>
        </form>
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* Aperçu en temps réel (Live Preview Card STICKY)             */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:col-span-5">
        <div className="sticky top-6 rounded-3xl border border-white/15 bg-plum-950/95 p-5 backdrop-blur-xl shadow-2xl transition-all duration-300 z-20">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-gold">
              {t("Aperçu direct de votre vitrine")}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-rose-gold/20 px-2 py-0.5 text-[10px] font-semibold text-rose-gold">
                {activeFont.label}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] text-white/70">
                /{slug}
              </span>
            </div>
          </div>

          {/* Simulateur d'écran vitrine */}
          <div
            className="overflow-hidden rounded-2xl border shadow-2xl transition-all duration-300"
            style={{
              backgroundColor: secondaryColor,
              borderColor: `${primaryColor}40`,
              color: colorMode === "light" ? "#1a1a1a" : "#ffffff",
            }}
          >
            {/* Bannière de l'aperçu */}
            <div
              className="relative h-32 w-full bg-gradient-to-r from-plum-950 to-plum-900"
              style={{
                backgroundImage: banner ? `url(${banner})` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              {/* Logo flottant */}
              <div className="absolute -bottom-5 start-4">
                {logo ? (
                  <img
                    src={logo}
                    alt={salonName}
                    className="h-14 w-14 rounded-2xl border-2 object-cover shadow-lg"
                    style={{ borderColor: primaryColor }}
                  />
                ) : (
                  <div
                    className="grid h-14 w-14 place-items-center rounded-2xl border-2 font-bold text-white shadow-lg"
                    style={{ backgroundColor: primaryColor, borderColor: accentColor }}
                  >
                    {salonName.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Contenu textuel de l'aperçu */}
            <div className="p-4 pt-8">
              {/* Nom du salon avec la police choisie */}
              <h4
                className="text-2xl font-bold tracking-tight transition-all duration-200"
                style={{
                  color: primaryColor,
                  fontFamily: activeFont.cssFont,
                }}
              >
                {salonName}
              </h4>

              {/* Slogan avec la police choisie */}
              <p
                className="mt-1 text-xs opacity-80 transition-all duration-200"
                style={{ fontFamily: activeFont.cssFont }}
              >
                {tagline || t("L'art de sublimer votre beauté au quotidien")}
              </p>

              <p className="mt-3 line-clamp-2 text-[11px] opacity-60">
                {description || "Bienvenue dans notre espace de détente et de soins haut de gamme."}
              </p>

              {/* Échantillon de prestations avec la police choisie */}
              <div className="mt-4 pt-3 border-t border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className="font-semibold"
                    style={{ fontFamily: activeFont.cssFont, color: primaryColor }}
                  >
                    Brushing Glamour
                  </span>
                  <span className="font-bold opacity-90">25 TND</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span
                    className="font-semibold"
                    style={{ fontFamily: activeFont.cssFont, color: primaryColor }}
                  >
                    Soin Visage Éclat
                  </span>
                  <span className="font-bold opacity-90">70 TND</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <span
                  className="flex-1 rounded-xl py-2 text-center text-xs font-semibold text-plum-950 shadow-md"
                  style={{ backgroundColor: primaryColor }}
                >
                  {t("Prendre rendez-vous")}
                </span>
                <span
                  className="rounded-xl border px-3 py-2 text-xs opacity-70"
                  style={{ borderColor: `${primaryColor}60` }}
                >
                  {t("Partager")}
                </span>
              </div>
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-white/40">
            {t("Les modifications sont immédiatement répercutées sur votre vitrine publique.")}
          </p>
        </div>
      </div>

      {toastMessage && (
        <Toast tone="success" onDone={() => setToastMessage(null)}>
          {toastMessage}
        </Toast>
      )}
    </div>
  );
}
