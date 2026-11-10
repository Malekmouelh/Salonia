"use client";

import { useActionState, useEffect, useState } from "react";
import { updateThemeAction } from "@/app/actions/vitrine";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, SubmitButton } from "@/components/ui/form";
import { SparkleIcon, TrashIcon } from "@/components/ui/icons";
import { ImageUploader } from "@/components/ui/image-uploader";
import { Toast } from "@/components/ui/modal";
import type { ThemeConfig } from "@/lib/vitrine/schemas";
import { AmbientModeSelector } from "./theme/ambient-mode-selector";
import { ColorPaletteManager } from "./theme/color-palette-manager";
import { FontSelector } from "./theme/font-selector";
import { LivePreview } from "./theme/live-preview";

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

  // Valeurs locales pour prévisualisation en temps réel synchronisée
  const [logo, setLogo] = useState<string>(initialTheme.logo || "");
  const [banner, setBanner] = useState<string>(initialTheme.banner || "");
  const [primaryColor, setPrimaryColor] = useState<string>(initialTheme.primaryColor || "#e8b4a0");
  const [secondaryColor, setSecondaryColor] = useState<string>(initialTheme.secondaryColor || "#2a0f25");
  const [accentColor, setAccentColor] = useState<string>(initialTheme.accentColor || "#f3d9cf");
  const [fontFamily, setFontFamily] = useState<string>(initialTheme.fontFamily || "playfair");
  const [customFontUrl, setCustomFontUrl] = useState<string>(
    (initialTheme as any).customFontUrl || "",
  );
  const [colorMode, setColorMode] = useState<"dark" | "light" | "auto">(
    initialTheme.colorMode || "dark",
  );
  const [tagline, setTagline] = useState<string>(initialTheme.tagline || "");
  const [description, setDescription] = useState<string>(initialTheme.description || "");

  // Notification de succès lors de l'enregistrement sans écraser les paramètres saisis
  useEffect(() => {
    if (state?.success) {
      setToastMessage(state.success);
    }
  }, [state?.success]);

  const handleClearAll = () => {
    if (!confirm(t("Voulez-vous réinitialiser tous les paramètres du thème aux valeurs par défaut ?"))) {
      return;
    }
    setLogo("");
    setBanner("");
    setPrimaryColor("#e8b4a0");
    setSecondaryColor("#2a0f25");
    setAccentColor("#f3d9cf");
    setFontFamily("playfair");
    setCustomFontUrl("");
    setColorMode("dark");
    setTagline("");
    setDescription("");
  };

  return (
    <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-12">
      {/* ─────────────────────────────────────────────────────────── */}
      {/* Colonne Gauche : Formulaire de configuration des options    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:col-span-7">
        <form action={formAction} className="space-y-6">
          {state?.message && <Alert tone="error">{state.message}</Alert>}
          {state?.success && <Alert tone="success">{state.success}</Alert>}

          {/* Champs cachés transmis avec le formulaire */}
          <input type="hidden" name="logo" value={logo} />
          <input type="hidden" name="banner" value={banner} />
          <input type="hidden" name="primaryColor" value={primaryColor} />
          <input type="hidden" name="secondaryColor" value={secondaryColor} />
          <input type="hidden" name="accentColor" value={accentColor} />
          <input type="hidden" name="fontFamily" value={fontFamily} />
          <input type="hidden" name="customFontUrl" value={customFontUrl} />
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
                cropAspectRatio={1}
                cropTitle={t("Cadrer le logo du salon (1:1)")}
                onChange={(photos) => setLogo(photos[0] || "")}
              />

              <ImageUploader
                label={t("Bannière d'en-tête de la vitrine")}
                hint={t("Image panoramique haute résolution pour accueillir vos clientes")}
                photos={banner ? [banner] : []}
                maxPhotos={1}
                cropAspectRatio={16 / 6}
                cropTitle={t("Cadrer la bannière d'en-tête (panoramique)")}
                onChange={(photos) => setBanner(photos[0] || "")}
              />
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 2 : Typographie & Textes d'accueil                  */}
          {/* ─────────────────────────────────────────────────────────── */}
          <FontSelector
            fontFamily={fontFamily}
            setFontFamily={setFontFamily}
            customFontUrl={customFontUrl}
            setCustomFontUrl={setCustomFontUrl}
            salonName={salonName}
            tagline={tagline}
            primaryColor={primaryColor}
          />

          {/* Slogan & Description */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur space-y-4">
            <h3 className="flex items-center gap-2 font-display text-base text-white">
              <SparkleIcon width={16} height={16} className="text-rose-gold" />
              {t("Textes de présentation")}
            </h3>

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
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition focus:border-rose-gold"
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
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition focus:border-rose-gold"
              />
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 3 : Palette de couleurs & Références Hex/RGB        */}
          {/* ─────────────────────────────────────────────────────────── */}
          <ColorPaletteManager
            primaryColor={primaryColor}
            setPrimaryColor={setPrimaryColor}
            secondaryColor={secondaryColor}
            setSecondaryColor={setSecondaryColor}
            accentColor={accentColor}
            setAccentColor={setAccentColor}
          />

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 4 : Ambiance Générale (Clair / Sombre / Auto)       */}
          {/* ─────────────────────────────────────────────────────────── */}
          <AmbientModeSelector
            colorMode={colorMode}
            setColorMode={setColorMode}
          />

          {/* ─────────────────────────────────────────────────────────── */}
          {/* Section 5 : Réseaux sociaux & Contact direct                */}
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

          {/* Boutons d'action du formulaire */}
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
      {/* Colonne Droite : Aperçu direct "Sticky" (Synchronisé)       */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:col-span-5">
        <LivePreview
          salonName={salonName}
          slug={slug}
          logo={logo}
          banner={banner}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          fontFamily={fontFamily}
          customFontUrl={customFontUrl}
          colorMode={colorMode}
          tagline={tagline}
          description={description}
        />
      </div>

      {toastMessage && (
        <Toast tone="success" onDone={() => setToastMessage(null)}>
          {toastMessage}
        </Toast>
      )}
    </div>
  );
}
