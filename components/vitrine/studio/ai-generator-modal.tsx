"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/i18n/i18n-provider";
import { CheckIcon, PaletteIcon, SparkleIcon, WandIcon } from "@/components/ui/icons";
import { COLOR_PRESETS, FONT_OPTIONS } from "@/lib/vitrine/schemas";
import type {
  GeneratedStudioTemplate,
  STUDIO_ASPECT_RATIOS,
  STUDIO_FONTS,
  STUDIO_TONES,
  STUDIO_TYPES,
} from "@/lib/vitrine/studio-ai-schema";

type StudioType = (typeof STUDIO_TYPES)[number];
type StudioTone = (typeof STUDIO_TONES)[number];
type AspectRatio = (typeof STUDIO_ASPECT_RATIOS)[number];

interface AIGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  salonName: string;
  initialBgPhoto?: string;
  initialPrimaryColor?: string;
  initialSecondaryColor?: string;
  initialFontFamily?: string;
  onApply: (template: GeneratedStudioTemplate) => void;
}

// Suggestions d'arrière-plans prédéfinis pour salons de beauté et spas
const PRESET_BACKGROUNDS = [
  {
    id: "dark_gold",
    label: "Noir & Marbre Doré",
    url: "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1512290900672-1f48d6174a6f?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "rose_silk",
    label: "Boudoir Rose Satiné",
    url: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "zen_spa",
    label: "Spa Bambou & Galets",
    url: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=160&q=60",
  },
  {
    id: "luxury_salon",
    label: "Salon Chic & Lumière Tamisée",
    url: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80",
    thumb: "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=160&q=60",
  },
];

const PRESET_PROMPTS = [
  {
    label: "🍸 Soirée VIP & Champagne",
    prompt:
      "Soirée d'inauguration privée avec coupe de champagne, cocktail et -20% sur les forfaits d'exception, ambiance or et noire.",
    type: "invitation" as StudioType,
    tone: "luxe" as StudioTone,
    aspectRatio: "story" as AspectRatio,
  },
  {
    label: "✨ Offre Flash Réduction",
    prompt:
      "Offre spéciale rentrée beauté avec -30% sur tous les soins visages et forfaits coloration ce week-end.",
    type: "poster" as StudioType,
    tone: "moderne" as StudioTone,
    aspectRatio: "square" as AspectRatio,
  },
  {
    label: "🌿 Journée Spa & Zen",
    prompt:
      "Journée portes ouvertes bien-être avec diagnostic de peau offert et massage découverte dans notre espace relaxation.",
    type: "poster" as StudioType,
    tone: "minimaliste" as StudioTone,
    aspectRatio: "square" as AspectRatio,
  },
  {
    label: "👑 Beauté Mariée & Henné",
    prompt:
      "Invitation exclusive pour futures mariées : essayage coiffure, mise en beauté orientale et soins d'exception.",
    type: "invitation" as StudioType,
    tone: "oriental" as StudioTone,
    aspectRatio: "story" as AspectRatio,
  },
];

const QUICK_TAGS = [
  "🏷️ -20% sur les soins",
  "🥂 Coupe de champagne offerte",
  "🧖 Diagnostic de peau offert",
  "👑 Soirée VIP Exclusive",
  "🌸 Forfait Mariée d'Exception",
  "✨ Grande Réouverture",
];

const TONE_OPTIONS: { id: StudioTone; label: string; desc: string; dot: string; primary: string; secondary: string }[] = [
  {
    id: "luxe",
    label: "Luxe & Or Impérial",
    desc: "Noir velours & dorures champagne",
    dot: "bg-amber-400",
    primary: "#d4af37",
    secondary: "#121212",
  },
  {
    id: "moderne",
    label: "Moderne & Épuré",
    desc: "Reflets cyan contemporains",
    dot: "bg-sky-400",
    primary: "#38bdf8",
    secondary: "#0c1524",
  },
  {
    id: "minimaliste",
    label: "Minimaliste & Zen",
    desc: "Émeraude & blanc crème",
    dot: "bg-emerald-400",
    primary: "#10b981",
    secondary: "#052317",
  },
  {
    id: "fete",
    label: "Fête & Célébration",
    desc: "Chaud, pétillant & dynamique",
    dot: "bg-orange-400",
    primary: "#f59e0b",
    secondary: "#200926",
  },
  {
    id: "oriental",
    label: "Oriental & Ambre",
    desc: "Ambre chaud, ornemental & noble",
    dot: "bg-yellow-600",
    primary: "#d97706",
    secondary: "#281204",
  },
  {
    id: "romantique",
    label: "Romantique & Rose Gold",
    desc: "Rose gold doux & nuances poudrées",
    dot: "bg-pink-400",
    primary: "#e8b4a0",
    secondary: "#2a0f25",
  },
];

export function AIGeneratorModal({
  open,
  onClose,
  salonName,
  initialBgPhoto = "",
  initialPrimaryColor = "#e8b4a0",
  initialSecondaryColor = "#2a0f25",
  initialFontFamily = "playfair",
  onApply,
}: AIGeneratorModalProps) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"compose" | "preview">("compose");

  // Champs de saisie & configuration
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<StudioType>("poster");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("story");
  const [tone, setTone] = useState<StudioTone>("luxe");
  const [bgPhoto, setBgPhoto] = useState<string>(initialBgPhoto);
  const [customColorsActive, setCustomColorsActive] = useState(false);
  const [primaryColor, setPrimaryColor] = useState<string>(initialPrimaryColor);
  const [secondaryColor, setSecondaryColor] = useState<string>(initialSecondaryColor);

  // État de chargement & résultat généré
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedResult, setGeneratedResult] = useState<GeneratedStudioTemplate | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Synchroniser avec les props initiales à l'ouverture
  useEffect(() => {
    if (open) {
      if (initialBgPhoto && !bgPhoto) setBgPhoto(initialBgPhoto);
      if (initialPrimaryColor) setPrimaryColor(initialPrimaryColor);
      if (initialSecondaryColor) setSecondaryColor(initialSecondaryColor);
    }
  }, [open, initialBgPhoto, initialPrimaryColor, initialSecondaryColor]);

  // Fermeture par la touche Échap
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isLoading, onClose]);

  if (!mounted || !open) return null;

  // Gestion du téléversement d'image d'arrière-plan locale
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError(t("Veuillez sélectionner un fichier image valide (JPG, PNG, WebP)."));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError(t("L'image ne doit pas dépasser 5 Mo."));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setBgPhoto(dataUrl);
      if (generatedResult) {
        setGeneratedResult({ ...generatedResult, bgPhoto: dataUrl });
      }
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleApplyTag = (tag: string) => {
    const cleanTag = tag.replace(/^[^\s]+\s*/, ""); // retire l'émoji
    setPrompt((prev) => (prev ? `${prev.trim()} - ${cleanTag}` : cleanTag));
  };

  const handleApplyPresetTheme = (pColor: string, sColor: string) => {
    setPrimaryColor(pColor);
    setSecondaryColor(sColor);
    setCustomColorsActive(true);
    if (generatedResult) {
      setGeneratedResult({
        ...generatedResult,
        colorPalette: {
          ...generatedResult.colorPalette,
          primary: pColor,
          secondary: sColor,
        },
      });
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError(t("Veuillez décrire votre affiche ou événement (au moins 3 caractères)."));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/studio/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          type,
          tone,
          salonName,
          aspectRatio,
          preferredPrimaryColor: customColorsActive ? primaryColor : undefined,
          preferredSecondaryColor: customColorsActive ? secondaryColor : undefined,
          bgPhoto: bgPhoto || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || t("Erreur lors de la génération du modèle."));
      }

      const tpl: GeneratedStudioTemplate = {
        ...data.template,
        bgPhoto: bgPhoto || data.template.bgPhoto || "",
        colorPalette: {
          ...data.template.colorPalette,
          primary: customColorsActive ? primaryColor : data.template.colorPalette.primary,
          secondary: customColorsActive ? secondaryColor : data.template.colorPalette.secondary,
        },
      };

      setGeneratedResult(tpl);
      setPrimaryColor(tpl.colorPalette.primary);
      setSecondaryColor(tpl.colorPalette.secondary);
      setActiveTab("preview");
    } catch (err: any) {
      console.error("Génération IA en échec :", err);
      setError(
        err.message ||
          t("Impossible de contacter le service de génération. Veuillez réessayer.")
      );
    } finally {
      setIsLoading(false);
    }
  };

  const applyPreset = (preset: (typeof PRESET_PROMPTS)[number]) => {
    setPrompt(preset.prompt);
    setType(preset.type);
    setTone(preset.tone);
    setAspectRatio(preset.aspectRatio);
    setError(null);
  };

  const handleApplyToStudio = () => {
    if (!generatedResult) return;
    onApply({
      ...generatedResult,
      bgPhoto: bgPhoto || generatedResult.bgPhoto || "",
      colorPalette: {
        ...generatedResult.colorPalette,
        primary: primaryColor,
        secondary: secondaryColor,
      },
    });
    onClose();
  };

  const curPrimary = primaryColor;
  const curSecondary = secondaryColor;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-fade-up"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex w-full max-w-3xl max-h-[92vh] flex-col rounded-3xl border border-rose-gold/30 bg-plum-950 shadow-2xl text-start overflow-hidden">
        {/* ── En-tête avec onglets de navigation ── */}
        <div className="shrink-0 flex items-center justify-between border-b border-white/10 px-5 pt-5 pb-4 bg-plum-950">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-gold to-blush text-plum-950 shadow-lg">
              <SparkleIcon width={22} height={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  {t("Studio IA · Concepteur d'Affiches & Invitations")}
                </h3>
                <span className="rounded-full bg-rose-gold/20 px-2 py-0.5 text-[10px] font-semibold text-rose-gold border border-rose-gold/30">
                  Génération Intelligente
                </span>
              </div>
              <p className="text-xs text-white/50">
                {t("Composez en un instant textes, palette de luxe, typographie et photo d'ambiance.")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {/* ── Onglets étape 1 (Création) vs étape 2 (Aperçu) ── */}
        <div className="shrink-0 flex border-b border-white/10 bg-white/[0.02] px-5">
          <button
            type="button"
            onClick={() => setActiveTab("compose")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === "compose"
                ? "border-rose-gold text-white"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            <WandIcon width={14} height={14} />
            <span>{t("1. Brief, Style & Arrière-plan")}</span>
          </button>

          <button
            type="button"
            onClick={() => generatedResult && setActiveTab("preview")}
            disabled={!generatedResult}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition ${
              activeTab === "preview"
                ? "border-rose-gold text-white"
                : generatedResult
                ? "border-transparent text-white/60 hover:text-white"
                : "border-transparent text-white/20 cursor-not-allowed"
            }`}
          >
            <SparkleIcon width={14} height={14} />
            <span>{t("2. Aperçu & Retouches")}</span>
            {generatedResult && (
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] text-emerald-300">
                ✓
              </span>
            )}
          </button>
        </div>

        {/* ── Corps scrollable ── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-5 [scrollbar-width:thin]">
          {activeTab === "compose" ? (
            <>
              {/* Idées en 1 clic */}
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-rose-gold">
                  💡 {t("Idées prêtes à l'emploi (cliquez pour pré-remplir)")}
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {PRESET_PROMPTS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="rounded-2xl border border-white/10 bg-white/5 p-2.5 text-start text-[11px] text-white/80 transition hover:border-rose-gold hover:bg-rose-gold/10 hover:text-white"
                    >
                      <div className="font-semibold text-white">{p.label}</div>
                      <div className="mt-1 line-clamp-1 text-[10px] text-white/50">
                        {p.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Champ Description & Mots-clés rapides */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-semibold text-white/80">
                    {t("Description de votre événement ou de l'affiche")}
                  </label>
                  <span className="text-[10px] text-white/40">{prompt.length}/1000</span>
                </div>
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isLoading}
                  placeholder={t(
                    "ex. Soirée d'inauguration VIP de notre nouveau salon avec champagne, soins du visage offerts et -20% sur les forfaits, ambiance dorée et luxueuse..."
                  )}
                  className="w-full rounded-2xl border border-white/15 bg-white/5 p-3.5 text-xs text-white placeholder-white/30 outline-none transition focus:border-rose-gold [scrollbar-width:thin] focus:ring-1 focus:ring-rose-gold/50"
                />

                {/* Tags rapides */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-white/40">{t("Insérer :")}</span>
                  {QUICK_TAGS.map((tag, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleApplyTag(tag)}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70 hover:border-rose-gold/60 hover:text-white transition"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ligne 1 : Type & Format & Ambiance */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* Type : Affiche vs Invitation */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/80">
                    {t("Type de visuel")}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setType("poster")}
                      className={`flex flex-col items-center justify-center rounded-2xl border p-2 text-xs transition ${
                        type === "poster"
                          ? "border-rose-gold bg-rose-gold/20 text-white font-bold shadow-md"
                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <span className="text-base">📢</span>
                      <span className="mt-1 text-[11px]">{t("Affiche")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setType("invitation")}
                      className={`flex flex-col items-center justify-center rounded-2xl border p-2 text-xs transition ${
                        type === "invitation"
                          ? "border-rose-gold bg-rose-gold/20 text-white font-bold shadow-md"
                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <span className="text-base">💌</span>
                      <span className="mt-1 text-[11px]">{t("Invitation")}</span>
                    </button>
                  </div>
                </div>

                {/* Format de diffusion */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/80">
                    {t("Format")}
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: "story" as AspectRatio, label: "Story", sub: "9:16" },
                      { id: "square" as AspectRatio, label: "Carré", sub: "1:1" },
                      { id: "landscape" as AspectRatio, label: "Bannière", sub: "16:9" },
                    ].map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setAspectRatio(fmt.id)}
                        className={`flex flex-col items-center justify-center rounded-2xl border py-2 text-xs transition ${
                          aspectRatio === fmt.id
                            ? "border-rose-gold bg-rose-gold/20 text-white font-bold shadow-md"
                            : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <span className="text-[11px] font-semibold">{fmt.label}</span>
                        <span className="text-[9px] text-white/40">{fmt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ambiance & Style */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/80">
                    {t("Ambiance & Ton")}
                  </label>
                  <div className="relative">
                    <select
                      value={tone}
                      onChange={(e) => {
                        const newTone = e.target.value as StudioTone;
                        setTone(newTone);
                        const match = TONE_OPTIONS.find((t) => t.id === newTone);
                        if (match && !customColorsActive) {
                          setPrimaryColor(match.primary);
                          setSecondaryColor(match.secondary);
                        }
                      }}
                      className="w-full appearance-none rounded-2xl border border-white/15 bg-plum-900 px-3.5 py-3 text-xs text-white outline-none transition focus:border-rose-gold cursor-pointer"
                    >
                      {TONE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id} className="bg-plum-950 text-white">
                          {opt.label} — {opt.desc}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/50 text-xs">
                      ▼
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Photo d'arrière-plan (Nouveau) ── */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🖼️</span>
                    <div>
                      <span className="text-xs font-semibold text-white">
                        {t("Photo d'arrière-plan (optionnel)")}
                      </span>
                      <p className="text-[10px] text-white/50">
                        {t("Téléversez votre photo ou sélectionnez un fond esthétique préconfiguré")}
                      </p>
                    </div>
                  </div>

                  {bgPhoto && (
                    <button
                      type="button"
                      onClick={() => setBgPhoto("")}
                      className="text-[11px] text-rose-gold hover:underline"
                    >
                      {t("Retirer la photo")}
                    </button>
                  )}
                </div>

                {/* Galerie de sélection rapide de fonds */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {/* Bouton Téléverser / Importer */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 p-3 text-center cursor-pointer hover:border-rose-gold transition group"
                  >
                    <span className="text-base group-hover:scale-110 transition">📤</span>
                    <span className="mt-1 text-[10px] font-semibold text-white/70 group-hover:text-white">
                      {t("Parcourir...")}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </div>

                  {/* Galerie prédéfinie */}
                  {PRESET_BACKGROUNDS.map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => setBgPhoto(bg.url)}
                      className={`relative flex flex-col overflow-hidden rounded-xl border transition ${
                        bgPhoto === bg.url
                          ? "border-rose-gold ring-2 ring-rose-gold/50"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <img
                        src={bg.thumb}
                        alt={bg.label}
                        className="h-14 w-full object-cover brightness-75"
                      />
                      <div className="bg-plum-950/90 p-1 text-center">
                        <span className="block truncate text-[9px] font-medium text-white/80">
                          {bg.label}
                        </span>
                      </div>
                      {bgPhoto === bg.url && (
                        <div className="absolute top-1 right-1 rounded-full bg-rose-gold p-0.5 text-plum-950">
                          <CheckIcon width={10} height={10} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {/* Aperçu miniature de l'image actuellement sélectionnée */}
                {bgPhoto && (
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2">
                    <img
                      src={bgPhoto}
                      alt="Fond actif"
                      className="h-10 w-16 rounded-lg object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        {t("Photo d'arrière-plan prête")}
                      </p>
                      <p className="text-[10px] text-white/50">
                        {t("Sera intégrée avec fondu satiné luxueux")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBgPhoto("")}
                      className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/60 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* ── Personnalisation des Couleurs (Demandé) ── */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PaletteIcon width={16} height={16} className="text-rose-gold" />
                    <div>
                      <span className="text-xs font-semibold text-white">
                        {t("Palette de couleurs de l'affiche")}
                      </span>
                      <p className="text-[10px] text-white/50">
                        {t("L'IA suggère une harmonie parfaite, vous pouvez aussi la personnaliser")}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCustomColorsActive(!customColorsActive)}
                    className="text-[11px] font-semibold text-rose-gold hover:underline"
                  >
                    {customColorsActive
                      ? t("Mode automatique IA")
                      : t("Personnaliser manuellement")}
                  </button>
                </div>

                {/* Presets rapides de couleurs de prestige */}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplyPresetTheme(preset.primary, preset.secondary)}
                      className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[10px] transition ${
                        primaryColor === preset.primary && secondaryColor === preset.secondary
                          ? "border-rose-gold bg-rose-gold/15 text-white"
                          : "border-white/10 bg-white/5 text-white/70 hover:border-white/20"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: preset.primary }}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: preset.secondary }}
                      />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>

                {/* Sélecteurs de couleur directs si activés */}
                {customColorsActive && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                    <div>
                      <label className="mb-1 block text-[10px] text-white/60">
                        {t("Couleur ornementale & titres (Hex)")}
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1.5">
                        <input
                          type="color"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0"
                        />
                        <input
                          type="text"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="w-full bg-transparent text-xs font-mono text-white outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[10px] text-white/60">
                        {t("Fond dégradé sombre (Hex)")}
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1.5">
                        <input
                          type="color"
                          value={secondaryColor}
                          onChange={(e) => setSecondaryColor(e.target.value)}
                          className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0"
                        />
                        <input
                          type="text"
                          value={secondaryColor}
                          onChange={(e) => setSecondaryColor(e.target.value)}
                          className="w-full bg-transparent text-xs font-mono text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ── Onglet 2 : Aperçu en Direct & Retouche Fine ── */
            generatedResult && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                {/* Visual Preview Card (Miniature de l'affiche) */}
                <div className="md:col-span-5 flex flex-col items-center">
                  <div
                    className="relative w-full rounded-2xl overflow-hidden shadow-2xl border border-white/20 flex flex-col justify-between p-4 text-center transition-all duration-300"
                    style={{
                      aspectRatio:
                        generatedResult.aspectRatio === "story"
                          ? "9/16"
                          : generatedResult.aspectRatio === "landscape"
                          ? "16/9"
                          : "1/1",
                      maxHeight: "360px",
                      background: `radial-gradient(circle at 50% 35%, #36102f 0%, ${curSecondary} 55%, #0c020a 100%)`,
                    }}
                  >
                    {/* Arrière-plan photo en surimpression */}
                    {bgPhoto && (
                      <div
                        className="absolute inset-0 bg-cover bg-center opacity-30 pointer-events-none mix-blend-screen"
                        style={{ backgroundImage: `url(${bgPhoto})` }}
                      />
                    )}

                    {/* Cadre ornemental fin */}
                    <div
                      className="absolute inset-2 rounded-xl border pointer-events-none"
                      style={{ borderColor: `${curPrimary}40` }}
                    />

                    {/* En-tête miniature */}
                    <div className="relative z-10 pt-2">
                      <p
                        className="text-[9px] uppercase tracking-widest font-bold"
                        style={{ color: curPrimary }}
                      >
                        ✦ MAISON DE BEAUTÉ ✦
                      </p>
                      <p className="text-[11px] font-bold text-white tracking-wide mt-0.5">
                        {salonName.toUpperCase()}
                      </p>
                    </div>

                    {/* Contenu central */}
                    <div className="relative z-10 my-auto py-2">
                      {generatedResult.discount && (
                        <div className="inline-block mb-1.5">
                          <span
                            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold shadow"
                            style={{
                              backgroundColor: curPrimary,
                              color: curSecondary,
                            }}
                          >
                            {generatedResult.discount}
                          </span>
                        </div>
                      )}
                      <h4
                        className="text-sm font-bold text-white leading-tight px-2"
                        style={{
                          fontFamily:
                            generatedResult.fontFamily === "playfair"
                              ? "'Playfair Display', serif"
                              : generatedResult.fontFamily === "cormorant"
                              ? "'Cormorant Garamond', serif"
                              : "system-ui",
                        }}
                      >
                        {generatedResult.title}
                      </h4>
                      {generatedResult.subtitle && (
                        <p className="mt-1 text-[10px] text-white/70 italic px-2 line-clamp-2">
                          {generatedResult.subtitle}
                        </p>
                      )}
                    </div>

                    {/* Pied miniature avec QR code */}
                    <div className="relative z-10 pb-1">
                      <div className="mx-auto h-12 w-12 rounded-lg bg-white p-1 flex items-center justify-center shadow">
                        <div className="grid grid-cols-4 grid-rows-4 gap-0.5 w-full h-full">
                          {Array.from({ length: 16 }).map((_, i) => (
                            <div
                              key={i}
                              className={`rounded-xs ${
                                (i * 7) % 3 === 0 ? "bg-plum-950" : "bg-transparent"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="mt-1 text-[8px] text-white/60">
                        {generatedResult.date || t("Scannez pour réserver")}
                      </p>
                    </div>
                  </div>

                  <p className="mt-2 text-[10px] text-white/40">
                    Format {generatedResult.aspectRatio} · {generatedResult.fontFamily}
                  </p>
                </div>

                {/* Formulaire de retouches directes */}
                <div className="md:col-span-7 space-y-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-white/70">
                      {t("Titre accrocheur")}
                    </label>
                    <input
                      type="text"
                      value={generatedResult.title}
                      onChange={(e) =>
                        setGeneratedResult({ ...generatedResult, title: e.target.value })
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-white/70">
                      {t("Sous-titre explicatif")}
                    </label>
                    <input
                      type="text"
                      value={generatedResult.subtitle}
                      onChange={(e) =>
                        setGeneratedResult({ ...generatedResult, subtitle: e.target.value })
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-white/70">
                        {t("Badge / Remise")}
                      </label>
                      <input
                        type="text"
                        value={generatedResult.discount}
                        onChange={(e) =>
                          setGeneratedResult({ ...generatedResult, discount: e.target.value })
                        }
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-white/70">
                        {t("Date / Horaires")}
                      </label>
                      <input
                        type="text"
                        value={generatedResult.date}
                        onChange={(e) =>
                          setGeneratedResult({ ...generatedResult, date: e.target.value })
                        }
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                      />
                    </div>
                  </div>

                  {/* Choix Typographie */}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-white/70">
                      {t("Typographie des titres")}
                    </label>
                    <select
                      value={generatedResult.fontFamily}
                      onChange={(e) =>
                        setGeneratedResult({
                          ...generatedResult,
                          fontFamily: e.target.value as any,
                        })
                      }
                      className="w-full rounded-xl border border-white/10 bg-plum-900 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold cursor-pointer"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value} className="bg-plum-950 text-white">
                          {f.label} ({f.category})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Ajustement direct des couleurs */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="mb-1 block text-[10px] text-white/60">
                        {t("Couleur ornementale")}
                      </label>
                      <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 p-1">
                        <input
                          type="color"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0"
                        />
                        <input
                          type="text"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="w-full bg-transparent text-[11px] font-mono text-white outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[10px] text-white/60">
                        {t("Fond sombre")}
                      </label>
                      <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 p-1">
                        <input
                          type="color"
                          value={secondaryColor}
                          onChange={(e) => setSecondaryColor(e.target.value)}
                          className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0"
                        />
                        <input
                          type="text"
                          value={secondaryColor}
                          onChange={(e) => setSecondaryColor(e.target.value)}
                          className="w-full bg-transparent text-[11px] font-mono text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </div>

        {/* Message d'erreur éventuel */}
        {error && (
          <div className="mx-6 mb-2 rounded-xl border border-red-500/30 bg-red-950/60 p-3 text-xs text-red-200">
            ⚠️ {error}
          </div>
        )}

        {/* ── Pied d'action sticky (toujours visible) ── */}
        <div className="shrink-0 flex items-center justify-between border-t border-white/10 px-5 py-4 bg-plum-950">
          <div>
            {activeTab === "preview" && (
              <button
                type="button"
                onClick={() => setActiveTab("compose")}
                className="text-xs text-white/60 hover:text-white transition flex items-center gap-1"
              >
                ← {t("Modifier le brief")}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {t("Fermer")}
            </button>

            {activeTab === "compose" ? (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading || prompt.trim().length < 3}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blush via-rose-gold to-champagne px-5 py-2.5 text-xs font-bold text-plum-950 shadow-xl transition hover:brightness-105 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-plum-950 border-t-transparent" />
                    <span>{t("Génération en cours...")}</span>
                  </>
                ) : (
                  <>
                    <SparkleIcon width={14} height={14} />
                    <span>{t("Générer le modèle avec l'IA ✨")}</span>
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isLoading}
                  className="rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  {isLoading ? t("Génération...") : t("🔄 Régénérer")}
                </button>

                <button
                  type="button"
                  onClick={handleApplyToStudio}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blush via-rose-gold to-champagne px-5 py-2.5 text-xs font-bold text-plum-950 shadow-xl transition hover:brightness-105 active:scale-95 cursor-pointer"
                >
                  <CheckIcon width={14} height={14} />
                  <span>{t("Appliquer au studio ✨")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
