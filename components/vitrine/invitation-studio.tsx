"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowRightIcon, CheckIcon, SparkleIcon, WandIcon } from "@/components/ui/icons";
import { ImageUploader } from "@/components/ui/image-uploader";
import { Toast } from "@/components/ui/modal";
import { generateQrCodeMatrix } from "@/lib/vitrine/qrcode";
import { POSTER_TEMPLATES, type PosterTemplate } from "@/lib/vitrine/schemas";

type AspectRatio = "story" | "square" | "landscape";

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

  const [template, setTemplate] = useState<PosterTemplate>("vip_invitation");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("story");
  const [title, setTitle] = useState("Invitation Privée & Soins d'Exception");
  const [subtitle, setSubtitle] = useState("Diagnostic offert & Coupe de champagne pour chaque invitée");
  const [date, setDate] = useState("Ce Vendredi & Samedi à partir de 14h");
  const [location, setLocation] = useState(salonName);
  const [discount, setDiscount] = useState("-20% REMISE");
  const [bgPhoto, setBgPhoto] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/salon/${salonSlug}`
    : `https://salonia.tn/salon/${salonSlug}`;

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

      // ───────────────────────────────────────────────────────────
      // 1. Fond luxueux dégradé radial avec profondeur
      // ───────────────────────────────────────────────────────────
      const radial = ctx.createRadialGradient(w / 2, h * 0.4, 80, w / 2, h * 0.45, w * 0.95);
      radial.addColorStop(0, "#36102f");
      radial.addColorStop(0.5, secondaryColor || "#240a20");
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

      // ───────────────────────────────────────────────────────────
      // 2. Double cadre ornemental doré & coins en losanges
      // ───────────────────────────────────────────────────────────
      const pad = 36;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

      const innerPad = 48;
      ctx.strokeStyle = `${primaryColor}55`;
      ctx.lineWidth = 1;
      ctx.strokeRect(innerPad, innerPad, w - innerPad * 2, h - innerPad * 2);

      // Petits losanges dorés aux 4 angles
      const drawCornerDiamond = (cx: number, cy: number) => {
        ctx.fillStyle = primaryColor;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx + 8, cy);
        ctx.lineTo(cx, cy + 8);
        ctx.lineTo(cx - 8, cy);
        ctx.closePath();
        ctx.fill();
      };
      drawCornerDiamond(innerPad, innerPad);
      drawCornerDiamond(w - innerPad, innerPad);
      drawCornerDiamond(innerPad, h - innerPad);
      drawCornerDiamond(w - innerPad, h - innerPad);

      // Helper pour découper le texte sur plusieurs lignes
      const wrapText = (text: string, maxWidth: number) => {
        const words = text.split(" ");
        const lines: string[] = [];
        let currentLine = "";
        for (const word of words) {
          const test = currentLine ? `${currentLine} ${word}` : word;
          if (ctx.measureText(test).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = test;
          }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
      };

      // ───────────────────────────────────────────────────────────
      // 3. Rendu équilibré selon le format (Story 9:16 vs Carré vs Paysage)
      // ───────────────────────────────────────────────────────────
      if (aspectRatio === "story") {
        // ── FORMAT STORY INSTAGRAM / TIKTOK (1080 x 1920) ────────

        // A. En-tête : Maison de Beauté & Nom du Salon (y: 110 à 250)
        ctx.fillStyle = primaryColor;
        ctx.font = "bold 20px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("✦   MAISON DE BEAUTÉ & SOINS D'EXCEPTION   ✦", w / 2, 125);

        ctx.font = "bold 58px 'Playfair Display', Georgia, serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(salonName.toUpperCase(), w / 2, 195);

        // Ligne de séparation élégante
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 140, 230);
        ctx.lineTo(w / 2 + 140, 230);
        ctx.stroke();

        // B. Badge Thématique (y: 310)
        const badgeLabel =
          template === "vip_invitation"
            ? "INVITATION PRIVÉE VIP"
            : template === "modern_promo"
              ? "OFFRE SPÉCIALE DU MOMENT"
              : template === "grand_opening"
                ? "ÉVÉNEMENT EXCLUSIF"
                : "JOURNÉE PRIVILÈGE";

        ctx.font = "bold 22px 'Inter', sans-serif";
        const badgeW = ctx.measureText(badgeLabel).width + 60;
        ctx.fillStyle = `${primaryColor}25`;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(w / 2 - badgeW / 2, 280, badgeW, 52, 26);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = primaryColor;
        ctx.fillText(badgeLabel, w / 2, 314);

        // C. Titre Principal & Sous-titre (y: 430 à 680)
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 68px 'Playfair Display', Georgia, serif";
        const titleLines = wrapText(title, w - 200);
        let curY = 440;
        for (const line of titleLines) {
          ctx.fillText(line, w / 2, curY);
          curY += 80;
        }

        if (subtitle) {
          ctx.fillStyle = "#f3d9cf";
          ctx.font = "italic 32px 'Cormorant Garamond', Georgia, serif";
          const subLines = wrapText(subtitle, w - 240);
          curY += 10;
          for (const line of subLines) {
            ctx.fillText(line, w / 2, curY);
            curY += 44;
          }
        }

        // D. Carte Centrale : Détails du Rendez-vous & Remise (y: 840 à 1280)
        const cardY = 820;
        const cardH = 440;
        const cardW = w - 180;
        const cardX = 90;

        // Fond glassmorphic de la carte
        ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
        ctx.strokeStyle = `${primaryColor}60`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, 32);
        ctx.fill();
        ctx.stroke();

        // En-tête de la carte
        ctx.fillStyle = primaryColor;
        ctx.font = "bold 20px 'Inter', sans-serif";
        ctx.fillText("✦  DÉTAILS DU RENDEZ-VOUS  ✦", w / 2, cardY + 55);

        // Badge Remise / Offre privilégiée
        if (discount) {
          ctx.fillStyle = primaryColor;
          ctx.beginPath();
          ctx.roundRect(w / 2 - 160, cardY + 85, 320, 68, 34);
          ctx.fill();

          ctx.fillStyle = "#2a0f25";
          ctx.font = "bold 34px 'Inter', sans-serif";
          ctx.fillText(discount, w / 2, cardY + 131);
        }

        // Date & Heure
        if (date) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 34px 'Inter', sans-serif";
          ctx.fillText(`🗓️   ${date}`, w / 2, cardY + 225);
        }

        // Lieu
        if (location) {
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "30px 'Inter', sans-serif";
          ctx.fillText(`📍   ${location}`, w / 2, cardY + 285);
        }

        // Mention d'accueil
        ctx.fillStyle = "#f3d9cf";
        ctx.font = "italic 26px 'Cormorant Garamond', Georgia, serif";
        ctx.fillText("Accueil personnalisé & rafraîchissements offerts", w / 2, cardY + 365);

        // E. Bas de page : QR Code & Appel à l'action (y: 1380 à 1840)
        const qrDim = 250;
        const qrX = w / 2 - qrDim / 2;
        const qrY = 1400;

        ctx.fillStyle = primaryColor;
        ctx.font = "bold 22px 'Inter', sans-serif";
        ctx.fillText("✦   VOTRE INVITATION DIGITALE   ✦", w / 2, qrY - 30);

        // Fond blanc du QR code
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(qrX - 18, qrY - 18, qrDim + 36, qrDim + 36, 24);
        ctx.fill();

        // Dessin des modules QR
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

        // Textes d'appel à l'action
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 28px 'Inter', sans-serif";
        ctx.fillText("Scannez avec votre téléphone pour réserver", w / 2, qrY + qrDim + 55);

        ctx.fillStyle = primaryColor;
        ctx.font = "bold 22px 'Inter', sans-serif";
        ctx.fillText("salonia.tn   •   Réservation en ligne instantanée", w / 2, h - 80);
      } else if (aspectRatio === "square") {
        // ── FORMAT CARRÉ (1080 x 1080) ───────────────────────────

        // En-tête
        ctx.fillStyle = primaryColor;
        ctx.font = "bold 18px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("✦   MAISON DE BEAUTÉ   ✦", w / 2, 95);

        ctx.font = "bold 44px 'Playfair Display', Georgia, serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(salonName.toUpperCase(), w / 2, 145);

        // Titre
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 48px 'Playfair Display', Georgia, serif";
        const titleLines = wrapText(title, w - 160);
        let curY = 220;
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

        // Carte centrale horizontale divisée en 2 colonnes : infos à gauche, QR Code à droite
        const cardY = curY + 25;
        const cardH = 380;
        const cardW = w - 160;
        const cardX = 80;

        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.strokeStyle = `${primaryColor}60`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, 28);
        ctx.fill();
        ctx.stroke();

        // Colonne gauche : Date, lieu, remise
        ctx.textAlign = "left";
        if (discount) {
          ctx.fillStyle = primaryColor;
          ctx.beginPath();
          ctx.roundRect(cardX + 40, cardY + 40, 240, 52, 26);
          ctx.fill();
          ctx.fillStyle = "#2a0f25";
          ctx.font = "bold 26px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(discount, cardX + 160, cardY + 76);
          ctx.textAlign = "left";
        }

        if (date) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 28px 'Inter', sans-serif";
          ctx.fillText(`🗓️  ${date}`, cardX + 40, cardY + 150);
        }
        if (location) {
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "24px 'Inter', sans-serif";
          ctx.fillText(`📍  ${location}`, cardX + 40, cardY + 205);
        }

        ctx.fillStyle = "#f3d9cf";
        ctx.font = "italic 20px 'Cormorant Garamond', Georgia, serif";
        ctx.fillText("Réservation en ligne recommandée", cardX + 40, cardY + 270);

        // Colonne droite : QR code
        const qrDim = 210;
        const qrX = cardX + cardW - qrDim - 45;
        const qrY = cardY + (cardH - qrDim) / 2 - 15;

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(qrX - 12, qrY - 12, qrDim + 24, qrDim + 24, 20);
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
        ctx.font = "bold 18px 'Inter', sans-serif";
        ctx.fillText("Scannez pour réserver", qrX + qrDim / 2, qrY + qrDim + 32);

        // Footer
        ctx.fillStyle = primaryColor;
        ctx.font = "bold 20px 'Inter', sans-serif";
        ctx.fillText("salonia.tn   •   Votre salon de beauté en ligne", w / 2, h - 60);
      } else {
        // ── FORMAT PAYSAGE (1200 x 675) ──────────────────────────
        ctx.textAlign = "center";
        ctx.fillStyle = primaryColor;
        ctx.font = "bold 18px 'Inter', sans-serif";
        ctx.fillText("✦   MAISON DE BEAUTÉ   ✦", w / 2, 70);

        ctx.font = "bold 40px 'Playfair Display', Georgia, serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(salonName.toUpperCase(), w / 2, 115);

        // Disposition 2 colonnes
        const leftX = 100;
        const leftW = 680;
        ctx.textAlign = "left";

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 44px 'Playfair Display', Georgia, serif";
        const titleLines = wrapText(title, leftW);
        let curY = 195;
        for (const line of titleLines) {
          ctx.fillText(line, leftX, curY);
          curY += 50;
        }

        if (subtitle) {
          ctx.fillStyle = "#f3d9cf";
          ctx.font = "italic 22px 'Cormorant Garamond', Georgia, serif";
          const subLines = wrapText(subtitle, leftW);
          for (const line of subLines) {
            ctx.fillText(line, leftX, curY);
            curY += 30;
          }
        }

        // Bloc Date / Lieu / Remise
        curY += 20;
        if (discount) {
          ctx.fillStyle = primaryColor;
          ctx.beginPath();
          ctx.roundRect(leftX, curY, 200, 44, 22);
          ctx.fill();
          ctx.fillStyle = "#2a0f25";
          ctx.font = "bold 22px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(discount, leftX + 100, curY + 30);
          ctx.textAlign = "left";
          curY += 65;
        }

        if (date) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 24px 'Inter', sans-serif";
          ctx.fillText(`🗓️   ${date}`, leftX, curY);
          curY += 36;
        }
        if (location) {
          ctx.fillStyle = "#cbd5e1";
          ctx.font = "22px 'Inter', sans-serif";
          ctx.fillText(`📍   ${location}`, leftX, curY);
        }

        // Colonne droite : QR code
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
        ctx.fillText("Scannez pour réserver", qrX + qrDim / 2, qrY + qrDim + 38);

        ctx.fillStyle = primaryColor;
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
  }, [aspectRatio, title, subtitle, date, location, discount, bgPhoto, salonName, primaryColor, secondaryColor, publicUrl, template]);

  // Téléchargement direct au clic avec toast pop-up
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

  const applyTemplatePreset = (tId: PosterTemplate) => {
    setTemplate(tId);
    if (tId === "vip_invitation") {
      setTitle("Invitation Privée & Soins d'Exception");
      setSubtitle("Diagnostic offert & Coupe de champagne pour chaque invitée");
      setDiscount("VIP OFFER");
    } else if (tId === "modern_promo") {
      setTitle("Offre Spéciale Beauté & Bien-être");
      setSubtitle("Valable sur l'ensemble de nos forfaits et soins signatures");
      setDiscount("-25% REMISE");
    } else if (tId === "grand_opening") {
      setTitle("Grande Ouverture de Notre Nouveau Salon");
      setSubtitle("Venez découvrir notre équipe passionnée et nos espaces dédiés");
      setDiscount("CADEAU DE BIENVENUE");
    } else if (tId === "beauty_day") {
      setTitle("Journée Découverte & Ateliers Beauté");
      setSubtitle("Démonstrations en direct, conseils personnalisés et réductions");
      setDiscount("JOURNÉE PRIVILÈGE");
    }
  };

  const dims = getDims(aspectRatio);

  return (
    <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
      {/* Colonne de contrôle (Paramètres de l'affiche) */}
      <div className="space-y-6 lg:col-span-6">
        <div>
          <h3 className="font-display text-xl text-white flex items-center gap-2">
            <WandIcon width={20} height={20} className="text-rose-gold" />
            {t("Studio d'affiches & Invitations (F1.4)")}
          </h3>
          <p className="mt-1 text-xs text-white/60 leading-relaxed">
            {t("Créez en 1 clic des visuels personnalisés haute définition avec QR code scannable intégrable sur Instagram, Facebook et WhatsApp.")}
          </p>
        </div>

        {/* Sélection du modèle */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
            {t("Modèles prêts à l'emploi")}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {POSTER_TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => applyTemplatePreset(tmpl.id)}
                className={`rounded-xl border p-3 text-start text-xs transition ${
                  template === tmpl.id
                    ? "border-rose-gold bg-rose-gold/20 text-white font-semibold shadow-md"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
                }`}
              >
                {t(tmpl.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Format réseaux sociaux */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
            {t("Format de diffusion")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "story", label: "Story (9:16)" },
              { id: "square", label: "Carré (1:1)" },
              { id: "landscape", label: "Paysage (16:9)" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setAspectRatio(f.id as AspectRatio)}
                className={`rounded-xl border py-2.5 text-center text-xs font-medium transition ${
                  aspectRatio === f.id
                    ? "border-rose-gold bg-rose-gold/25 text-white font-bold shadow-md"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Textes de l'affiche */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur space-y-3.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-white/70">
            {t("Personnalisation du contenu")}
          </label>

          <div>
            <label className="mb-1 block text-[11px] text-white/60">{t("Titre de l'événement / Offre")}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white outline-none focus:border-rose-gold"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-white/60">{t("Sous-titre / Détails")}</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white outline-none focus:border-rose-gold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-white/60">{t("Badge / Remise")}</label>
              <input
                type="text"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white outline-none focus:border-rose-gold"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-white/60">{t("Date / Période")}</label>
              <input
                type="text"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white outline-none focus:border-rose-gold"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-white/60">{t("Lieu / Centre")}</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white outline-none focus:border-rose-gold"
            />
          </div>

          <ImageUploader
            label={t("Photo d'arrière-plan personnalisée (optionnel)")}
            hint={t("Ajoutez une photo de votre salon pour un résultat encore plus unique")}
            photos={bgPhoto ? [bgPhoto] : []}
            maxPhotos={1}
            onChange={(p) => setBgPhoto(p[0] || "")}
          />
        </div>
      </div>

      {/* Colonne de prévisualisation & Téléchargement (Sticky qui suit le défilement) */}
      <div className="flex flex-col items-center justify-start lg:col-span-6">
        <div className="sticky top-6 flex flex-col items-center w-full max-w-md">
          <div className="mb-3 flex items-center justify-between w-full">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-gold">
              {t("Aperçu du visuel")}
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] text-white/70">
              {dims.w} × {dims.h} px
            </span>
          </div>

          {/* Canvas haute définition rendu en direct */}
          <div className="relative overflow-hidden rounded-3xl border-2 border-white/15 bg-black/60 shadow-2xl transition-all duration-300">
            <canvas
              ref={canvasRef}
              style={{
                width: `${dims.previewW}px`,
                height: `${dims.previewH}px`,
              }}
              className="block"
            />
          </div>

          {/* Bouton de téléchargement de l'image */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={isExporting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blush via-rose-gold to-champagne py-3.5 text-sm font-bold text-plum-950 shadow-xl transition hover:brightness-105 active:scale-95 disabled:opacity-70"
          >
            <SparkleIcon width={18} height={18} />
            {isExporting ? t("Génération en cours…") : t("Télécharger l'affiche (PNG HD)")}
          </button>

          <p className="mt-2.5 text-center text-[11px] text-white/40 max-w-xs">
            {t("Prêt à poster directement sur vos réseaux sociaux avec le QR Code connecté à votre salon.")}
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
