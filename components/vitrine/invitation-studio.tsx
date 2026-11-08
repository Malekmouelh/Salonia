"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ArrowRightIcon,
  CheckIcon,
  PaletteIcon,
  SparkleIcon,
  WandIcon,
} from "@/components/ui/icons";
import { Toast } from "@/components/ui/modal";
import { generateQrCodeMatrix } from "@/lib/vitrine/qrcode";
import { COLOR_PRESETS, FONT_OPTIONS } from "@/lib/vitrine/schemas";
import {
  STUDIO_BACKGROUND_PRESETS,
  type GeneratedStudioTemplate,
  type STUDIO_ASPECT_RATIOS,
  type STUDIO_FONTS,
  type STUDIO_TEMPLATES,
  type STUDIO_TONES,
  type STUDIO_TYPES,
} from "@/lib/vitrine/studio-ai-schema";

type AspectRatio = (typeof STUDIO_ASPECT_RATIOS)[number];
type StudioType = (typeof STUDIO_TYPES)[number];
type StudioTone = (typeof STUDIO_TONES)[number];
type PosterTemplate = (typeof STUDIO_TEMPLATES)[number];

// 8 arrière-plans haute définition pour salons, spas et galas
const PRESET_BACKGROUNDS = STUDIO_BACKGROUND_PRESETS;

const PRESET_PROMPTS = [
  {
    label: "Soirée VIP & Champagne",
    prompt:
      "Soirée d'inauguration privée avec coupe de champagne, cocktail et -20% sur les forfaits d'exception, ambiance or et noire.",
    type: "invitation" as StudioType,
    tone: "luxe" as StudioTone,
    aspectRatio: "story" as AspectRatio,
  },
  {
    label: "Offre Flash Réduction",
    prompt:
      "Offre spéciale rentrée beauté avec -30% sur tous les soins visages et forfaits coloration ce week-end.",
    type: "poster" as StudioType,
    tone: "moderne" as StudioTone,
    aspectRatio: "square" as AspectRatio,
  },
  {
    label: "Journée Spa & Zen",
    prompt:
      "Journée portes ouvertes bien-être avec diagnostic de peau offert et massage découverte dans notre espace relaxation.",
    type: "poster" as StudioType,
    tone: "minimaliste" as StudioTone,
    aspectRatio: "square" as AspectRatio,
  },
  {
    label: "Beauté Mariée & Henné",
    prompt:
      "Invitation exclusive pour futures mariées : essayage coiffure, mise en beauté orientale et soins d'exception.",
    type: "invitation" as StudioType,
    tone: "oriental" as StudioTone,
    aspectRatio: "story" as AspectRatio,
  },
];

const QUICK_TAGS = [
  "-20% sur forfaits",
  "Coupe de champagne offerte",
  "Diagnostic offert",
  "Soirée VIP",
  "Spécial Mariée",
  "Grande Réouverture",
];

const TONE_OPTIONS: { id: StudioTone; label: string; desc: string; dot: string; primary: string; secondary: string }[] = [
  {
    id: "luxe",
    label: "Luxe & Or Impérial",
    desc: "Noir velours & dorures",
    dot: "bg-amber-400",
    primary: "#d4af37",
    secondary: "#121212",
  },
  {
    id: "moderne",
    label: "Moderne & Épuré",
    desc: "Cyan contemporain",
    dot: "bg-sky-400",
    primary: "#38bdf8",
    secondary: "#0c1524",
  },
  {
    id: "minimaliste",
    label: "Minimaliste & Zen",
    desc: "Émeraude & blanc",
    dot: "bg-emerald-400",
    primary: "#10b981",
    secondary: "#052317",
  },
  {
    id: "fete",
    label: "Fête & Célébration",
    desc: "Pétillant & dynamique",
    dot: "bg-orange-400",
    primary: "#f59e0b",
    secondary: "#200926",
  },
  {
    id: "oriental",
    label: "Oriental & Ambre",
    desc: "Ambre chaud noble",
    dot: "bg-yellow-600",
    primary: "#d97706",
    secondary: "#281204",
  },
  {
    id: "romantique",
    label: "Romantique & Poudré",
    desc: "Rose gold poudré",
    dot: "bg-pink-400",
    primary: "#e8b4a0",
    secondary: "#2a0f25",
  },
];

export function InvitationStudio({
  salonName,
  salonSlug,
  primaryColor = "#e8b4a0",
  secondaryColor = "#2a0f25",
}: {
  salonName: string;
  salonSlug: string;
  primaryColor?: string;
  secondaryColor?: string;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // État de l'affiche rendu sur le canvas
  const [template, setTemplate] = useState<PosterTemplate>("vip_invitation");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("story");
  const [title, setTitle] = useState("Invitation Privée & Soins d'Exception");
  const [subtitle, setSubtitle] = useState("Diagnostic offert & Coupe de champagne pour chaque invitée");
  const [date, setDate] = useState("Ce Vendredi & Samedi à partir de 14h");
  const [location, setLocation] = useState(salonName);
  const [discount, setDiscount] = useState("INVITATION PRIVÉE");
  const [bgPhoto, setBgPhoto] = useState<string>(STUDIO_BACKGROUND_PRESETS[0].url);
  const [activePrimaryColor, setActivePrimaryColor] = useState(primaryColor);
  const [activeSecondaryColor, setActiveSecondaryColor] = useState(secondaryColor);
  const [fontFamily, setFontFamily] = useState<string>("playfair");

  // Options créatives de verrouillage (désactivées par défaut pour que l'IA explore librement)
  const [lockColors, setLockColors] = useState(false);
  const [lockBackground, setLockBackground] = useState(false);

  // État du Générateur IA (Directement intégré)
  const [prompt, setPrompt] = useState(
    "Soirée d'inauguration VIP avec coupe de champagne, cocktail et -20% sur les forfaits d'exception, ambiance or et noire."
  );
  const [aiType, setAiType] = useState<StudioType>("invitation");
  const [aiTone, setAiTone] = useState<StudioTone>("luxe");
  const [variationIndex, setVariationIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showFineTuning, setShowFineTuning] = useState(false);
  const [aiEngine, setAiEngine] = useState<"groq" | "gemini" | "openai" | "claude" | "offline" | null>(null);

  useEffect(() => {
    fetch("/api/studio/generate-template")
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data.activeEngine) {
          setAiEngine(data.activeEngine);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setActivePrimaryColor(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    setActiveSecondaryColor(secondaryColor);
  }, [secondaryColor]);

  const curPrimary = activePrimaryColor || primaryColor;
  const curSecondary = activeSecondaryColor || secondaryColor;

  const getSerifFont = (weight: string, size: number) => {
    switch (fontFamily) {
      case "cormorant":
        return `${weight} ${size}px 'Cormorant Garamond', Georgia, serif`;
      case "outfit":
        return `${weight} ${size}px 'Outfit', sans-serif`;
      case "inter":
        return `${weight} ${size}px 'Inter', sans-serif`;
      case "roboto":
        return `${weight} ${size}px 'Roboto', sans-serif`;
      case "poppins":
        return `${weight} ${size}px 'Poppins', sans-serif`;
      case "montserrat":
        return `${weight} ${size}px 'Montserrat', sans-serif`;
      case "cairo":
        return `${weight} ${size}px 'Cairo', sans-serif`;
      case "tajawal":
        return `${weight} ${size}px 'Tajawal', sans-serif`;
      case "amiri":
        return `${weight} ${size}px 'Amiri', Georgia, serif`;
      case "playfair":
      default:
        return `${weight} ${size}px 'Playfair Display', Georgia, serif`;
    }
  };

  // URL officielle Vercel pour le QR Code scannable de l'affiche
  const publicUrl = `https://salonia-tn.vercel.app/salon/${salonSlug}`;

  // Dimensions réelles en pixels selon le format de diffusion
  const getDims = (ratio: AspectRatio) => {
    switch (ratio) {
      case "story":
        return { w: 1080, h: 1920, previewH: 520, previewW: 292 };
      case "square":
        return { w: 1080, h: 1080, previewH: 380, previewW: 380 };
      case "landscape":
        return { w: 1200, h: 675, previewH: 260, previewW: 462 };
    }
  };

  // Rendu Canvas haute définition luxueux & équilibré
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = getDims(aspectRatio);
    canvas.width = w;
    canvas.height = h;

    const renderPoster = (bgImg?: HTMLImageElement) => {
      ctx.clearRect(0, 0, w, h);

      // Fond luxueux dégradé radial avec profondeur
      const radial = ctx.createRadialGradient(w / 2, h * 0.4, 80, w / 2, h * 0.45, w * 0.95);
      radial.addColorStop(0, "#36102f");
      radial.addColorStop(0.5, curSecondary || "#240a20");
      radial.addColorStop(1, "#0c020a");
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, w, h);

      // Si une photo de fond a été chargée, l'intégrer avec élégance
      if (bgImg) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        const imgRatio = bgImg.width / bgImg.height;
        const canRatio = w / h;
        let dw = w;
        let dh = h;
        let dx = 0;
        let dy = 0;
        if (imgRatio > canRatio) {
          dw = h * imgRatio;
          dx = (w - dw) / 2;
        } else {
          dh = w / imgRatio;
          dy = (h - dh) / 2;
        }
        ctx.drawImage(bgImg, dx, dy, dw, dh);

        // Voile satiné supplémentaire sur l'image
        const overlay = ctx.createLinearGradient(0, 0, 0, h);
        overlay.addColorStop(0, "rgba(20, 4, 18, 0.6)");
        overlay.addColorStop(0.5, "rgba(20, 4, 18, 0.4)");
        overlay.addColorStop(1, "rgba(10, 2, 9, 0.85)");
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      // Motifs géométriques fins et dorures
      ctx.save();
      ctx.strokeStyle = `${curPrimary}22`;
      ctx.lineWidth = 1;

      // Cadre ornemental double
      const margin = 32;
      ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);
      ctx.strokeStyle = `${curPrimary}35`;
      ctx.strokeRect(margin + 12, margin + 12, w - (margin + 12) * 2, h - (margin + 12) * 2);

      // Coins décoratifs
      const cornerSize = 28;
      const corners = [
        [margin + 12, margin + 12],
        [w - margin - 12, margin + 12],
        [margin + 12, h - margin - 12],
        [w - margin - 12, h - margin - 12],
      ];
      ctx.fillStyle = curPrimary;
      for (const [cx, cy] of corners) {
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Fonctions utilitaires de découpage de texte multi-lignes
      const wrapText = (text: string, maxWidth: number): string[] => {
        const words = text.split(" ");
        const lines: string[] = [];
        let currentLine = words[0] || "";

        for (let i = 1; i < words.length; i++) {
          const testLine = `${currentLine} ${words[i]}`;
          if (ctx.measureText(testLine).width < maxWidth) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = words[i];
          }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
      };

      const isInvitation = aiType === "invitation";

      if (aspectRatio === "story") {
        // ── FORMAT STORY (1080 x 1920) ──
        ctx.textAlign = "center";

        if (isInvitation) {
          // ── INVITATION STORY : ÉDITORIAL HAUTE COUTURE & CARTON VIP ──
          // Sceau / Monogramme Or
          ctx.strokeStyle = `${curPrimary}99`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(w / 2, 105, 26, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 20px serif";
          ctx.fillText("✦", w / 2, 112);

          // En-tête Invitation
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 18px 'Inter', sans-serif";
          ctx.fillText("✦   CARTE D'INVITATION PRIVÉE   ✦", w / 2, 160);

          ctx.font = getSerifFont("bold", 50);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(salonName.toUpperCase(), w / 2, 225);

          ctx.font = "italic 24px 'Cormorant Garamond', Georgia, serif";
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText("a le plaisir de vous convier à", w / 2, 270);

          // Conteneur Carte d'Invitation Frosted
          const cardX = 60;
          const cardY = 300;
          const cardW = w - 120;
          const cardH = 1250;

          ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
          ctx.strokeStyle = `${curPrimary}60`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(cardX, cardY, cardW, cardH, 32);
          ctx.fill();
          ctx.stroke();

          // Liseré intérieur doré
          ctx.strokeStyle = `${curPrimary}22`;
          ctx.lineWidth = 1;
          ctx.strokeRect(cardX + 12, cardY + 12, cardW - 24, cardH - 24);

          // Badge VIP Pass
          if (discount) {
            const badgeY = cardY + 65;
            ctx.fillStyle = curPrimary;
            ctx.beginPath();
            ctx.roundRect(w / 2 - 160, badgeY - 26, 320, 52, 26);
            ctx.fill();

            ctx.fillStyle = "#2a0f25";
            ctx.font = "bold 22px 'Inter', sans-serif";
            ctx.fillText(discount, w / 2, badgeY + 8);
          }

          // Titre principal de l'événement
          ctx.fillStyle = "#ffffff";
          ctx.font = getSerifFont("bold", 58);
          const titleLines = wrapText(title, cardW - 80);
          let curY = cardY + 160;
          for (const line of titleLines) {
            ctx.fillText(line, w / 2, curY);
            curY += 72;
          }

          // Sous-titre / Programme
          if (subtitle) {
            ctx.fillStyle = "#f3d9cf";
            ctx.font = "italic 28px 'Cormorant Garamond', Georgia, serif";
            const subLines = wrapText(subtitle, cardW - 100);
            curY += 10;
            for (const line of subLines) {
              ctx.fillText(line, w / 2, curY);
              curY += 42;
            }
          }

          // Ligne séparatrice avec losange
          curY += 30;
          const lineGrad = ctx.createLinearGradient(w / 2 - 160, 0, w / 2 + 160, 0);
          lineGrad.addColorStop(0, "rgba(232, 180, 160, 0)");
          lineGrad.addColorStop(0.5, curPrimary);
          lineGrad.addColorStop(1, "rgba(232, 180, 160, 0)");
          ctx.strokeStyle = lineGrad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(w / 2 - 160, curY);
          ctx.lineTo(w / 2 + 160, curY);
          ctx.stroke();

          // Cadre Gala Date & Lieu
          curY += 50;
          const galaBoxY = curY;
          const galaBoxH = 110;
          const galaBoxW = cardW - 120;
          const galaBoxX = (w - galaBoxW) / 2;

          ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
          ctx.strokeStyle = `${curPrimary}35`;
          ctx.beginPath();
          ctx.roundRect(galaBoxX, galaBoxY, galaBoxW, galaBoxH, 20);
          ctx.fill();
          ctx.stroke();

          if (date) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 28px 'Inter', sans-serif";
            ctx.fillText(date, w / 2, galaBoxY + 45);
          }
          if (location) {
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "24px 'Inter', sans-serif";
            ctx.fillText(location, w / 2, galaBoxY + 85);
          }

          // Bloc QR Code RSVP
          const qrDim = 280;
          const qrY = galaBoxY + galaBoxH + 50;
          const qrX = (w - qrDim) / 2;

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.roundRect(qrX - 18, qrY - 18, qrDim + 36, qrDim + 36, 28);
          ctx.fill();

          ctx.strokeStyle = `${curPrimary}88`;
          ctx.lineWidth = 2;
          ctx.stroke();

          const qrMatrix = generateQrCodeMatrix(publicUrl);
          const cellSize = qrDim / qrMatrix.length;
          ctx.fillStyle = "#2a0f25";
          for (let r = 0; r < qrMatrix.length; r++) {
            for (let c = 0; c < qrMatrix.length; c++) {
              if (qrMatrix[r][c]) {
                ctx.fillRect(qrX + c * cellSize, qrY + r * cellSize, cellSize, cellSize);
              }
            }
          }

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 24px 'Inter', sans-serif";
          ctx.fillText("Présentez ce QR Code pour confirmer votre présence", w / 2, qrY + qrDim + 45);

          ctx.fillStyle = curPrimary;
          ctx.font = "bold 20px 'Inter', sans-serif";
          ctx.fillText("Réponse souhaitée (RSVP)   •   salonia.tn", w / 2, h - 70);
        } else {
          // ── AFFICHE STORY : PROMOTION COMMERCIALE & FORT IMPACT ──
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 20px 'Inter', sans-serif";
          ctx.fillText("✦   MAISON DE BEAUTÉ   •   OFFRE EXCLUSIVE   ✦", w / 2, 130);

          ctx.font = getSerifFont("bold", 56);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(salonName.toUpperCase(), w / 2, 200);

          // Badge Promo Flamboyant
          if (discount) {
            const badgeY = 280;
            ctx.fillStyle = curPrimary;
            ctx.beginPath();
            ctx.roundRect(w / 2 - 180, badgeY - 32, 360, 64, 32);
            ctx.fill();

            ctx.fillStyle = "#2a0f25";
            ctx.font = "bold 30px 'Inter', sans-serif";
            ctx.fillText(discount, w / 2, badgeY + 10);
          }

          // Grand Titre Promo
          ctx.fillStyle = "#ffffff";
          ctx.font = getSerifFont("bold", 64);
          const titleLines = wrapText(title, w - 160);
          let curY = 410;
          for (const line of titleLines) {
            ctx.fillText(line, w / 2, curY);
            curY += 78;
          }

          // Sous-titre
          if (subtitle) {
            ctx.fillStyle = "#f3d9cf";
            ctx.font = "bold 28px 'Inter', sans-serif";
            const subLines = wrapText(subtitle, w - 200);
            curY += 15;
            for (const line of subLines) {
              ctx.fillText(line, w / 2, curY);
              curY += 46;
            }
          }

          // Boîte Offre & Validité
          curY += 30;
          const boxY = curY;
          const boxW = w - 240;
          const boxH = 120;
          const boxX = (w - boxW) / 2;

          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.strokeStyle = `${curPrimary}60`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxW, boxH, 24);
          ctx.fill();
          ctx.stroke();

          if (date) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 30px 'Inter', sans-serif";
            ctx.fillText(date, w / 2, boxY + 50);
          }
          if (location) {
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "26px 'Inter', sans-serif";
            ctx.fillText(location, w / 2, boxY + 92);
          }

          // QR Code Réservation en direct
          const qrDim = 320;
          const qrY = boxY + boxH + 60;
          const qrX = (w - qrDim) / 2;

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.roundRect(qrX - 22, qrY - 22, qrDim + 44, qrDim + 44, 32);
          ctx.fill();

          ctx.strokeStyle = curPrimary;
          ctx.lineWidth = 3;
          ctx.stroke();

          const qrMatrix = generateQrCodeMatrix(publicUrl);
          const cellSize = qrDim / qrMatrix.length;
          ctx.fillStyle = "#2a0f25";
          for (let r = 0; r < qrMatrix.length; r++) {
            for (let c = 0; c < qrMatrix.length; c++) {
              if (qrMatrix[r][c]) {
                ctx.fillRect(qrX + c * cellSize, qrY + r * cellSize, cellSize, cellSize);
              }
            }
          }

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 28px 'Inter', sans-serif";
          ctx.fillText("Scannez pour réserver votre créneau en ligne", w / 2, qrY + qrDim + 55);

          ctx.fillStyle = curPrimary;
          ctx.font = "bold 22px 'Inter', sans-serif";
          ctx.fillText("salonia.tn   •   Réservation en ligne instantanée", w / 2, h - 70);
        }
      } else if (aspectRatio === "square") {
        // ── FORMAT CARRÉ (1080 x 1080) ──
        ctx.textAlign = "center";

        if (isInvitation) {
          // ── INVITATION CARRÉ ──
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 18px 'Inter', sans-serif";
          ctx.fillText("✦   CARTE D'INVITATION PRIVÉE   ✦", w / 2, 85);

          ctx.font = getSerifFont("bold", 42);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(salonName.toUpperCase(), w / 2, 135);

          ctx.font = "italic 22px 'Cormorant Garamond', Georgia, serif";
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText("a le plaisir de vous inviter à", w / 2, 175);

          // Titre
          ctx.fillStyle = "#ffffff";
          ctx.font = getSerifFont("bold", 48);
          const titleLines = wrapText(title, w - 160);
          let curY = 235;
          for (const line of titleLines) {
            ctx.fillText(line, w / 2, curY);
            curY += 56;
          }

          // Sous-titre
          if (subtitle) {
            ctx.fillStyle = "#f3d9cf";
            ctx.font = "italic 24px 'Cormorant Garamond', Georgia, serif";
            const subLines = wrapText(subtitle, w - 200);
            for (const line of subLines) {
              ctx.fillText(line, w / 2, curY);
              curY += 34;
            }
          }

          const cardY = curY + 25;
          const cardH = 380;
          const cardW = w - 160;
          const cardX = 80;

          ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
          ctx.strokeStyle = `${curPrimary}60`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(cardX, cardY, cardW, cardH, 28);
          ctx.fill();
          ctx.stroke();

          ctx.textAlign = "left";
          if (discount) {
            ctx.fillStyle = curPrimary;
            ctx.beginPath();
            ctx.roundRect(cardX + 40, cardY + 40, 240, 52, 26);
            ctx.fill();
            ctx.fillStyle = "#2a0f25";
            ctx.font = "bold 24px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(discount, cardX + 160, cardY + 74);
            ctx.textAlign = "left";
          }

          if (date) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 28px 'Inter', sans-serif";
            ctx.fillText(date, cardX + 40, cardY + 150);
          }
          if (location) {
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "24px 'Inter', sans-serif";
            ctx.fillText(location, cardX + 40, cardY + 200);
          }

          ctx.fillStyle = "#cbd5e1";
          ctx.font = "18px 'Inter', sans-serif";
          ctx.fillText("Carton d'accès officiel RSVP", cardX + 40, cardY + 290);
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 22px 'Inter', sans-serif";
          ctx.fillText("salonia.tn", cardX + 40, cardY + 325);

          // QR Code
          const qrDim = 260;
          const qrX = cardX + cardW - qrDim - 40;
          const qrY = cardY + (cardH - qrDim) / 2;

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.roundRect(qrX - 16, qrY - 16, qrDim + 32, qrDim + 32, 20);
          ctx.fill();

          const qrMatrix = generateQrCodeMatrix(publicUrl);
          const cellSize = qrDim / qrMatrix.length;
          ctx.fillStyle = "#2a0f25";
          for (let r = 0; r < qrMatrix.length; r++) {
            for (let c = 0; c < qrMatrix.length; c++) {
              if (qrMatrix[r][c]) {
                ctx.fillRect(qrX + c * cellSize, qrY + r * cellSize, cellSize, cellSize);
              }
            }
          }
        } else {
          // ── AFFICHE CARRÉ : PROMO ──
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 18px 'Inter', sans-serif";
          ctx.fillText("✦   MAISON DE BEAUTÉ   •   OFFRE FLASH   ✦", w / 2, 85);

          ctx.font = getSerifFont("bold", 46);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(salonName.toUpperCase(), w / 2, 135);

          // Titre
          ctx.fillStyle = "#ffffff";
          ctx.font = getSerifFont("bold", 50);
          const titleLines = wrapText(title, w - 160);
          let curY = 210;
          for (const line of titleLines) {
            ctx.fillText(line, w / 2, curY);
            curY += 58;
          }

          // Sous-titre
          if (subtitle) {
            ctx.fillStyle = "#f3d9cf";
            ctx.font = "bold 26px 'Inter', sans-serif";
            const subLines = wrapText(subtitle, w - 200);
            for (const line of subLines) {
              ctx.fillText(line, w / 2, curY);
              curY += 36;
            }
          }

          const cardY = curY + 25;
          const cardH = 380;
          const cardW = w - 160;
          const cardX = 80;

          ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
          ctx.strokeStyle = `${curPrimary}70`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(cardX, cardY, cardW, cardH, 28);
          ctx.fill();
          ctx.stroke();

          ctx.textAlign = "left";
          if (discount) {
            ctx.fillStyle = curPrimary;
            ctx.beginPath();
            ctx.roundRect(cardX + 40, cardY + 40, 260, 56, 28);
            ctx.fill();
            ctx.fillStyle = "#2a0f25";
            ctx.font = "bold 28px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(discount, cardX + 170, cardY + 78);
            ctx.textAlign = "left";
          }

          if (date) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 28px 'Inter', sans-serif";
            ctx.fillText(date, cardX + 40, cardY + 150);
          }
          if (location) {
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "24px 'Inter', sans-serif";
            ctx.fillText(location, cardX + 40, cardY + 200);
          }

          ctx.fillStyle = "#cbd5e1";
          ctx.font = "18px 'Inter', sans-serif";
          ctx.fillText("Réservation en ligne instantanée", cardX + 40, cardY + 290);
          ctx.fillStyle = curPrimary;
          ctx.font = "bold 22px 'Inter', sans-serif";
          ctx.fillText("salonia.tn", cardX + 40, cardY + 325);

          // QR Code
          const qrDim = 260;
          const qrX = cardX + cardW - qrDim - 40;
          const qrY = cardY + (cardH - qrDim) / 2;

          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.roundRect(qrX - 16, qrY - 16, qrDim + 32, qrDim + 32, 20);
          ctx.fill();

          const qrMatrix = generateQrCodeMatrix(publicUrl);
          const cellSize = qrDim / qrMatrix.length;
          ctx.fillStyle = "#2a0f25";
          for (let r = 0; r < qrMatrix.length; r++) {
            for (let c = 0; c < qrMatrix.length; c++) {
              if (qrMatrix[r][c]) {
                ctx.fillRect(qrX + c * cellSize, qrY + r * cellSize, cellSize, cellSize);
              }
            }
          }
        }
      } else {
        // ── FORMAT PAYSAGE (1200 x 675) ──
        ctx.textAlign = "center";
        ctx.fillStyle = curPrimary;
        ctx.font = "bold 18px 'Inter', sans-serif";
        ctx.fillText(isInvitation ? "✦   CARTE D'INVITATION PRIVÉE   ✦" : "✦   MAISON DE BEAUTÉ   •   OFFRE FLASH   ✦", w / 2, 70);

        ctx.font = getSerifFont("bold", 40);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(salonName.toUpperCase(), w / 2, 115);

        const leftX = 100;
        const leftW = 680;
        ctx.textAlign = "left";

        ctx.fillStyle = "#ffffff";
        ctx.font = getSerifFont("bold", 44);
        const titleLines = wrapText(title, leftW);
        let curY = 195;
        for (const line of titleLines) {
          ctx.fillText(line, leftX, curY);
          curY += 50;
        }

        if (subtitle) {
          ctx.fillStyle = "#f3d9cf";
          ctx.font = isInvitation ? "italic 22px 'Cormorant Garamond', Georgia, serif" : "bold 22px 'Inter', sans-serif";
          const subLines = wrapText(subtitle, leftW);
          for (const line of subLines) {
            ctx.fillText(line, leftX, curY);
            curY += 30;
          }
        }

        curY += 20;
        if (discount) {
          ctx.fillStyle = curPrimary;
          ctx.beginPath();
          ctx.roundRect(leftX, curY, 220, 46, 23);
          ctx.fill();
          ctx.fillStyle = "#2a0f25";
          ctx.font = "bold 22px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(discount, leftX + 110, curY + 31);
          ctx.textAlign = "left";
          curY += 65;
        }

        if (date) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 24px 'Inter', sans-serif";
          ctx.fillText(date, leftX, curY);
          curY += 36;
        }
        if (location) {
          ctx.fillStyle = "#cbd5e1";
          ctx.font = "22px 'Inter', sans-serif";
          ctx.fillText(location, leftX, curY);
        }

        const qrDim = 230;
        const qrX = w - qrDim - 140;
        const qrY = 175;

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(qrX - 16, qrY - 16, qrDim + 32, qrDim + 32, 24);
        ctx.fill();

        const qrMatrix = generateQrCodeMatrix(publicUrl);
        const cellSize = qrDim / qrMatrix.length;
        ctx.fillStyle = "#2a0f25";
        for (let r = 0; r < qrMatrix.length; r++) {
          for (let c = 0; c < qrMatrix.length; c++) {
            if (qrMatrix[r][c]) {
              ctx.fillRect(qrX + c * cellSize, qrY + r * cellSize, cellSize, cellSize);
            }
          }
        }

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px 'Inter', sans-serif";
        ctx.fillText(isInvitation ? "Présentez ce QR Code RSVP" : "Scannez pour réserver", qrX + qrDim / 2, qrY + qrDim + 38);

        ctx.fillStyle = curPrimary;
        ctx.font = "bold 18px 'Inter', sans-serif";
        ctx.fillText("salonia.tn", qrX + qrDim / 2, qrY + qrDim + 68);
      }
    };

    if (bgPhoto) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => renderPoster(img);
      img.onerror = () => renderPoster();
      img.src = bgPhoto;
    } else {
      renderPoster();
    }
  }, [
    aspectRatio,
    title,
    subtitle,
    date,
    location,
    discount,
    bgPhoto,
    salonName,
    curPrimary,
    curSecondary,
    fontFamily,
    publicUrl,
    template,
    aiType,
  ]);

  // Téléchargement direct en haute définition
  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsExporting(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `affiche-${salonSlug}-${aspectRatio}.png`;
      a.click();
      setToastMessage(t("Affiche téléchargée avec succès (PNG Haute Définition) !"));
    } finally {
      setIsExporting(false);
    }
  };

  // ── Génération directe par l'Intelligence Artificielle ──
  const handleGenerateAI = async (
    customPrompt?: string,
    forcedVariation?: number,
    isRegeneration: boolean = false
  ) => {
    const nextIdx = forcedVariation !== undefined ? forcedVariation : variationIndex;
    const targetPrompt = (customPrompt || prompt).trim();
    if (!targetPrompt || targetPrompt.length < 3) {
      setToastMessage(t("Veuillez décrire votre affiche (au moins 3 caractères)."));
      return;
    }

    setIsGenerating(true);
    try {
      const res = await fetch("/api/studio/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: targetPrompt,
          type: aiType,
          tone: aiTone,
          salonName,
          aspectRatio,
          // Ne verrouiller les couleurs et le fond que si l'utilisateur l'a expressément demandé
          preferredPrimaryColor: (lockColors && !isRegeneration) ? activePrimaryColor : undefined,
          preferredSecondaryColor: (lockColors && !isRegeneration) ? activeSecondaryColor : undefined,
          bgPhoto: ((lockBackground || (bgPhoto && bgPhoto.startsWith("data:"))) && !isRegeneration) ? bgPhoto : undefined,
          variationIndex: nextIdx,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t("Erreur lors de la génération."));
      }

      const gen: GeneratedStudioTemplate = data.template;
      setTitle(gen.title);
      setSubtitle(gen.subtitle || "");
      setDate(gen.date || (aiType === "invitation" ? "Ce week-end dès 18h" : "Ce week-end"));
      if (gen.location) setLocation(gen.location);
      setDiscount(gen.discount || (aiType === "invitation" ? "INVITATION PRIVÉE" : "OFFRE SPÉCIALE"));
      if (gen.template) setTemplate(gen.template);
      if (gen.aspectRatio) setAspectRatio(gen.aspectRatio);
      if (gen.colorPalette?.primary && (!lockColors || isRegeneration)) {
        setActivePrimaryColor(gen.colorPalette.primary);
      }
      if (gen.colorPalette?.secondary && (!lockColors || isRegeneration)) {
        setActiveSecondaryColor(gen.colorPalette.secondary);
      }
      if (gen.fontFamily) setFontFamily(gen.fontFamily);
      if (gen.bgPhoto && (!lockBackground || isRegeneration || !bgPhoto)) {
        setBgPhoto(gen.bgPhoto);
      }

      const resolvedProvider = data.provider || gen.provider || "offline";
      setAiEngine(resolvedProvider);
      setVariationIndex(nextIdx);

      setToastMessage(
        isRegeneration
          ? t(`Suggestion #${nextIdx + 1} appliquée avec succès !`)
          : t("Affiche générée avec succès par l'IA !")
      );
    } catch (err: any) {
      console.error("Génération en échec :", err);
      setToastMessage(t(err.message || "Erreur de génération. Veuillez réessayer."));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyPreset = (preset: (typeof PRESET_PROMPTS)[number]) => {
    setPrompt(preset.prompt);
    setAiType(preset.type);
    setAiTone(preset.tone);
    setAspectRatio(preset.aspectRatio);
    handleGenerateAI(preset.prompt);
  };

  const handleApplyTag = (tag: string) => {
    const cleanTag = tag.replace(/^[^\s]+\s*/, "");
    setPrompt((prev) => (prev ? `${prev.trim()} - ${cleanTag}` : cleanTag));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setToastMessage(t("Seules les images sont acceptées."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToastMessage(t("Image trop volumineuse (max 5 Mo)."));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setBgPhoto(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const dims = getDims(aspectRatio);

  return (
    <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
      {/* ── Colonne Gauche : CONSOLE DE CRÉATION 100% IA ── */}
      <div className="space-y-6 lg:col-span-6 text-start">
        {/* En-tête Studio IA */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl text-white flex items-center gap-2">
              <SparkleIcon width={22} height={22} className="text-rose-gold" />
              {t("Studio d'Affiches & Invitations IA")}
            </h3>
            <span className="rounded-full bg-gradient-to-r from-rose-gold/20 to-blush/20 px-2.5 py-0.5 text-[10px] font-bold text-rose-gold border border-rose-gold/30">
              {t("100% IA Générative")}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/60 leading-relaxed">
            {t("Décrivez simplement votre offre ou événement. L'IA rédige les textes publicitaires, compose la mise en page, accorde les couleurs et intègre le QR code scannable.")}
          </p>
        </div>

        {/* ── Console Centrale de Génération IA ── */}
        <div className="rounded-3xl border border-rose-gold/30 bg-gradient-to-b from-rose-gold/10 via-white/[0.02] to-plum-950/60 p-5 backdrop-blur shadow-2xl space-y-4">
          {/* Idées en 1 clic */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-rose-gold flex items-center gap-1.5">
              <SparkleIcon width={13} height={13} className="text-rose-gold" />
              <span>{t("Idées d'affiches prêtes à générer en 1 clic :")}</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleApplyPreset(p)}
                  className="rounded-2xl border border-white/10 bg-white/5 p-2.5 text-start text-xs text-white/80 transition hover:border-rose-gold hover:bg-rose-gold/10 hover:text-white disabled:opacity-50 cursor-pointer"
                >
                  <div className="font-semibold text-white">{p.label}</div>
                  <div className="mt-0.5 line-clamp-1 text-[10px] text-white/50">{p.prompt}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Saisie de la demande (Prompt) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-white">
                {t("Votre description ou offre de salon")}
              </label>
              <span className="text-[10px] text-white/40">{prompt.length}/1000</span>
            </div>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
              placeholder={t(
                "ex. Soirée privée VIP inauguration de notre salon avec champagne, soins du visage offerts et -20% sur les forfaits d'exception, ambiance or et noire..."
              )}
              className="w-full rounded-2xl border border-white/15 bg-plum-900/40 p-3.5 text-xs text-white placeholder-white/30 outline-none transition focus:border-rose-gold [scrollbar-width:thin] focus:ring-1 focus:ring-rose-gold/50"
            />

            {/* Tags rapides */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-white/40">{t("Insérer :")}</span>
              {QUICK_TAGS.map((tag, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => handleApplyTag(tag)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/70 hover:border-rose-gold/60 hover:text-white transition disabled:opacity-40"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Grille de réglages de direction artistique */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {/* Type */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/70">
                {t("Type de visuel")}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setAiType("poster");
                    setTemplate("modern_promo");
                    if (
                      discount === "INVITATION PRIVÉE" ||
                      discount === "ENTRÉE PRIVILÈGE" ||
                      discount === "PASS VIP"
                    ) {
                      setDiscount("-20% PRIVILÈGE");
                    }
                    if (
                      title.toLowerCase().includes("inauguration") ||
                      title.toLowerCase().includes("invitation")
                    ) {
                      setTitle("Offre Privilège Soins & Beauté");
                      setSubtitle("Profitez d'un diagnostic personnalisé & soins d'exception offerts");
                    }
                  }}
                  className={`rounded-xl border py-2 text-center text-xs transition ${
                    aiType === "poster"
                      ? "border-rose-gold bg-rose-gold/20 text-white font-bold ring-2 ring-rose-gold/40 shadow-sm"
                      : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {t("Affiche (Promo)")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiType("invitation");
                    setTemplate("vip_invitation");
                    if (
                      discount === "-20% PRIVILÈGE" ||
                      discount === "-20% REMISE" ||
                      discount === "OFFRE SPÉCIALE"
                    ) {
                      setDiscount("INVITATION PRIVÉE");
                    }
                    if (
                      title === "Offre Privilège Soins & Beauté" ||
                      title.toLowerCase().includes("offre")
                    ) {
                      setTitle("Soirée d'inauguration VIP");
                      setSubtitle("Coupe de champagne & Rituels d'exception offerts");
                    }
                  }}
                  className={`rounded-xl border py-2 text-center text-xs transition ${
                    aiType === "invitation"
                      ? "border-rose-gold bg-rose-gold/20 text-white font-bold ring-2 ring-rose-gold/40 shadow-sm"
                      : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {t("Carte d'Invitation")}
                </button>
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/70">
                {t("Format")}
              </label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: "story" as AspectRatio, label: "Story", sub: "9:16" },
                  { id: "square" as AspectRatio, label: "Carré", sub: "1:1" },
                  { id: "landscape" as AspectRatio, label: "Paysage", sub: "16:9" },
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setAspectRatio(fmt.id)}
                    className={`rounded-xl border py-1.5 text-center text-xs transition ${
                      aspectRatio === fmt.id
                        ? "border-rose-gold bg-rose-gold/20 text-white font-bold"
                        : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-[11px] font-semibold">{fmt.label}</div>
                    <div className="text-[8px] text-white/40">{fmt.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Ambiance */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/70">
                {t("Ambiance & Ton")}
              </label>
              <div className="relative">
                <select
                  value={aiTone}
                  onChange={(e) => {
                    const newTone = e.target.value as StudioTone;
                    setAiTone(newTone);
                    const match = TONE_OPTIONS.find((t) => t.id === newTone);
                    if (match) {
                      setActivePrimaryColor(match.primary);
                      setActiveSecondaryColor(match.secondary);
                    }
                  }}
                  className="w-full appearance-none rounded-xl border border-white/15 bg-plum-900 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold cursor-pointer"
                >
                  {TONE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id} className="bg-plum-950 text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-[10px]">
                  ▼
                </div>
              </div>
            </div>
          </div>

          {/* Photo d'arrière-plan esthétique */}
          <div className="pt-2 border-t border-white/10">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
              <label className="text-[11px] font-semibold text-white/70 flex items-center gap-1.5">
                <span>{t("Arrière-plan haute définition :")}</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setLockBackground(!lockBackground)}
                  className={`text-[10px] px-2.5 py-0.5 rounded-full border transition cursor-pointer ${
                    lockBackground
                      ? "border-amber-400/60 bg-amber-400/20 text-amber-200"
                      : "border-white/10 bg-white/5 text-white/60 hover:text-white"
                  }`}
                  title={t("Si déverrouillé, l'IA choisit automatiquement l'image idéale à chaque génération")}
                >
                  {lockBackground ? t("Fond verrouillé") : t("Fond automatique")}
                </button>
                {bgPhoto && (
                  <button
                    type="button"
                    onClick={() => setBgPhoto("")}
                    className="text-[10px] text-rose-gold hover:underline cursor-pointer"
                  >
                    {t("Retirer")}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5 p-2 text-center cursor-pointer hover:border-rose-gold transition group"
              >
                <ArrowRightIcon width={14} height={14} className="-rotate-90 text-white/60 group-hover:text-rose-gold mb-1" />
                <span className="text-[9px] font-semibold text-white/70 group-hover:text-white">
                  {t("Téléverser...")}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>

              {PRESET_BACKGROUNDS.map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() => setBgPhoto(bg.url)}
                  className={`relative flex flex-col overflow-hidden rounded-xl border transition ${
                    bgPhoto === bg.url
                      ? "border-rose-gold ring-1 ring-rose-gold/50"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <img
                    src={bg.thumb}
                    alt={bg.label}
                    className="h-9 w-full object-cover brightness-75"
                  />
                  <div className="bg-plum-950/90 py-0.5 text-center">
                    <span className="block truncate text-[8px] text-white/70">{bg.label}</span>
                  </div>
                  {bgPhoto === bg.url && (
                    <div className="absolute top-1 right-1 rounded-full bg-rose-gold p-0.5 text-plum-950">
                      <CheckIcon width={8} height={8} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Option de créativité des couleurs */}
          <div className="flex items-center justify-between px-1 text-[11px] text-white/60">
            <span className="flex items-center gap-1">
              <span>{t("Palette chromatique :")}</span>
            </span>
            <button
              type="button"
              onClick={() => setLockColors(!lockColors)}
              className={`text-[10px] px-2.5 py-0.5 rounded-full border transition cursor-pointer ${
                lockColors
                  ? "border-amber-400/60 bg-amber-400/20 text-amber-200"
                  : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
              }`}
            >
              {lockColors ? t("Couleurs verrouillées") : t("Nouvelles couleurs automatiques")}
            </button>
          </div>

          {/* Bouton Principal de Génération IA */}
          <button
            type="button"
            disabled={isGenerating || prompt.trim().length < 3}
            onClick={() => handleGenerateAI()}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blush via-rose-gold to-champagne py-3.5 text-xs font-bold text-plum-950 shadow-xl transition hover:brightness-105 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isGenerating ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-plum-950 border-t-transparent" />
                <span>{t("Génération de l'affiche par l'IA en cours...")}</span>
              </>
            ) : (
              <>
                <SparkleIcon width={16} height={16} />
                <span>{t("Générer l'affiche complète avec l'IA")}</span>
              </>
            )}
          </button>
        </div>

        {/* ── Volet de Retouches & Ajustements fins (Modifiable à tout moment) ── */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setShowFineTuning(!showFineTuning)}
            className="w-full flex items-center justify-between text-xs font-semibold text-white/80 hover:text-white transition"
          >
            <div className="flex items-center gap-2">
              <WandIcon width={14} height={14} className="text-rose-gold" />
              <span>{t("Retouches & Ajustements fins des textes & couleurs")}</span>
            </div>
            <span className="text-xs text-white/50">{showFineTuning ? "▲" : "▼"}</span>
          </button>

          {showFineTuning && (
            <div className="mt-4 space-y-3.5 pt-3 border-t border-white/10">
              <div>
                <label className="mb-1 block text-[10px] text-white/60">
                  {t("Titre de l'événement")}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-white/60">
                  {t("Sous-titre / Détails")}
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] text-white/60">
                    {t("Badge / Remise")}
                  </label>
                  <input
                    type="text"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-white/60">
                    {t("Date / Horaires")}
                  </label>
                  <input
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold"
                  />
                </div>
              </div>

              {/* Palette et Police */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div>
                  <label className="mb-1 block text-[10px] text-white/60">
                    {t("Couleur ornementale")}
                  </label>
                  <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 p-1">
                    <input
                      type="color"
                      value={curPrimary}
                      onChange={(e) => setActivePrimaryColor(e.target.value)}
                      className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={activePrimaryColor}
                      onChange={(e) => setActivePrimaryColor(e.target.value)}
                      className="w-full bg-transparent text-[11px] font-mono text-white outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] text-white/60">
                    {t("Fond sombre dégradé")}
                  </label>
                  <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 p-1">
                    <input
                      type="color"
                      value={curSecondary}
                      onChange={(e) => setActiveSecondaryColor(e.target.value)}
                      className="h-6 w-6 cursor-pointer appearance-none rounded-lg border-0 bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={activeSecondaryColor}
                      onChange={(e) => setActiveSecondaryColor(e.target.value)}
                      className="w-full bg-transparent text-[11px] font-mono text-white outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-white/60">
                  {t("Police des titres")}
                </label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-plum-900 px-3 py-2 text-xs text-white outline-none focus:border-rose-gold cursor-pointer"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value} className="bg-plum-950 text-white">
                      {f.label} ({f.category})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Colonne Droite : PRÉVISUALISATION DIRECTE LUXE & EXPORT (Sticky) ── */}
      <div className="flex flex-col items-center justify-start lg:col-span-6 w-full">
        <div className="sticky top-6 flex flex-col items-center w-full max-w-lg space-y-4">
          {/* Barre d'outils et sélecteur de format fluide au-dessus du Canvas */}
          <div className="flex w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 backdrop-blur">
            <div className="flex items-center gap-1">
              {[
                { id: "story" as AspectRatio, label: "Story", ratio: "9:16" },
                { id: "square" as AspectRatio, label: "Carré", ratio: "1:1" },
                { id: "landscape" as AspectRatio, label: "Paysage", ratio: "16:9" },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setAspectRatio(fmt.id)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    aspectRatio === fmt.id
                      ? "bg-rose-gold text-plum-950 shadow-md font-bold"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{fmt.label}</span>
                  <span className="text-[10px] opacity-70">({fmt.ratio})</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pr-1">
              <span className="hidden sm:inline-block rounded-lg bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/70">
                {dims.w}×{dims.h}px
              </span>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{t("HD Live")}</span>
              </span>
            </div>
          </div>

          {/* Écrin de présentation fluide (Mockup Frame interactif) */}
          <div className="relative flex w-full items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-b from-black/60 via-black/40 to-black/80 p-4 sm:p-6 shadow-2xl backdrop-blur-xl min-h-[480px] overflow-hidden transition-all duration-300">
            {/* Lueur d'ambiance d'arrière-plan reflétant les couleurs actives de l'affiche */}
            <div
              className="absolute -inset-10 opacity-30 blur-3xl pointer-events-none transition-all duration-700"
              style={{
                background: `radial-gradient(circle at 50% 50%, ${curPrimary} 0%, ${curSecondary} 70%, transparent 100%)`,
              }}
            />

            {/* Cadre mockup réaliste pour Story (Smartphone) ou Card pour Carré */}
            <div
              className={`relative z-10 transition-all duration-300 shadow-2xl ${
                aspectRatio === "story"
                  ? "rounded-[38px] border-[6px] border-neutral-800/95 ring-1 ring-white/20 p-1.5 bg-neutral-950"
                  : aspectRatio === "square"
                  ? "rounded-2xl border-2 border-white/20 p-1 bg-black/40 ring-1 ring-white/10"
                  : "rounded-2xl border-2 border-white/20 p-1 bg-black/40 ring-1 ring-white/10"
              }`}
            >
              {/* Encoche Smartphone pour Story */}
              {aspectRatio === "story" && (
                <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 h-3.5 w-20 rounded-full bg-neutral-900 border border-white/10 shadow-sm flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-neutral-950 mr-4" />
                  <div className="h-1 w-6 rounded-full bg-neutral-800" />
                </div>
              )}

              {/* Canvas Haute Définition */}
              <div className="relative overflow-hidden rounded-[26px]">
                <canvas
                  ref={canvasRef}
                  style={{
                    width: `${dims.previewW}px`,
                    height: `${dims.previewH}px`,
                    maxWidth: "100%",
                  }}
                  className="block shadow-inner"
                />

                {/* Overlay de chargement Shimmer pendant la génération IA */}
                {isGenerating && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md p-4 text-center animate-fade-in">
                    <div className="relative flex h-14 w-14 items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-2 border-rose-gold border-t-transparent animate-spin" />
                      <SparkleIcon width={24} height={24} className="text-rose-gold animate-pulse" />
                    </div>
                    <p className="mt-3 text-xs font-bold text-white">
                      {t("L'IA compose votre affiche...")}
                    </p>
                    <p className="mt-1 text-[10px] text-white/60">
                      {t("Nouvelle palette de couleurs & typographie")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Boutons d'export et régénération rapide */}
          <div className="w-full space-y-2.5">
            <button
              type="button"
              onClick={handleDownload}
              disabled={isExporting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blush via-rose-gold to-champagne py-3.5 text-sm font-bold text-plum-950 shadow-xl transition hover:brightness-105 active:scale-95 disabled:opacity-70 cursor-pointer"
            >
              <SparkleIcon width={18} height={18} />
              {isExporting ? t("Génération en cours…") : t("Télécharger l'affiche (PNG HD)")}
            </button>

            <button
              type="button"
              disabled={isGenerating}
              onClick={() => handleGenerateAI(undefined, variationIndex + 1, true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-gold/40 bg-gradient-to-r from-rose-gold/15 to-white/[0.02] hover:bg-rose-gold/25 py-3 text-xs font-semibold text-rose-gold transition hover:text-white disabled:opacity-50 cursor-pointer shadow-md"
            >
              <WandIcon width={14} height={14} />
              <span>
                {t("Générer une autre idée d'affiche")}
                {variationIndex > 0 && ` (#${variationIndex + 1})`}
              </span>
            </button>

            <a
              href={`/salon/${salonSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 py-2.5 text-xs font-medium text-white/80 hover:text-white transition cursor-pointer"
            >
              <span>{t("Voir la vitrine en ligne")}</span>
              <ArrowRightIcon width={13} height={13} className="rtl:-scale-x-100" />
            </a>
          </div>

          <p className="text-center text-[11px] text-white/40 max-w-xs leading-relaxed">
            {t("Visuel haute définition avec QR Code vérifié, prêt à être partagé sur Instagram, WhatsApp ou imprimé.")}
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
