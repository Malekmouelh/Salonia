"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "@/components/ui/icons";

interface ImageCropModalProps {
  imageSrc: string;
  aspectRatio: number; // ex: 1 pour logo (carré), 16/9 ou 3 pour bannière
  title: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

export function ImageCropModal({
  imageSrc,
  aspectRatio,
  title,
  onConfirm,
  onCancel,
}: ImageCropModalProps) {
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Largeur de la boîte de cadrage
  const frameWidth = 360;
  const frameHeight = Math.round(frameWidth / aspectRatio);

  useEffect(() => {
    setMounted(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImgLoaded(false);

    // Empêcher le scroll du body pendant que la modale est ouverte
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [imageSrc]);

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setImgLoaded(true);
  };

  // Calcul des dimensions de base de l'image pour couvrir la frame
  let baseWidth = frameWidth;
  let baseHeight = frameHeight;

  if (naturalSize.w > 0 && naturalSize.h > 0) {
    const imgRatio = naturalSize.w / naturalSize.h;
    if (imgRatio > aspectRatio) {
      baseHeight = frameHeight;
      baseWidth = Math.round(frameHeight * imgRatio);
    } else {
      baseWidth = frameWidth;
      baseHeight = Math.round(frameWidth / imgRatio);
    }
  }

  const currentWidth = baseWidth * zoom;
  const currentHeight = baseHeight * zoom;

  // Limites de déplacement
  const maxPanX = Math.max(0, (currentWidth - frameWidth) / 2);
  const maxPanY = Math.max(0, (currentHeight - frameHeight) / 2);

  const clampedPanX = Math.max(-maxPanX, Math.min(maxPanX, pan.x));
  const clampedPanY = Math.max(-maxPanY, Math.min(maxPanY, pan.y));

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPan({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleConfirmCrop = () => {
    if (!imgRef.current || naturalSize.w === 0) return;

    const canvas = document.createElement("canvas");
    const targetWidth = aspectRatio === 1 ? 600 : 1200;
    const targetHeight = Math.round(targetWidth / aspectRatio);

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = naturalSize.w / currentWidth;
    const imgLeftInFrame = (frameWidth - currentWidth) / 2 + clampedPanX;
    const imgTopInFrame = (frameHeight - currentHeight) / 2 + clampedPanY;

    const sx = Math.max(0, -imgLeftInFrame * scale);
    const sy = Math.max(0, -imgTopInFrame * scale);
    const sw = Math.min(naturalSize.w - sx, frameWidth * scale);
    const sh = Math.min(naturalSize.h - sy, frameHeight * scale);

    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

    const croppedDataUrl = canvas.toDataURL("image/webp", 0.9);
    onConfirm(croppedDataUrl);
  };

  if (!mounted) return null;

  // createPortal vers document.body pour échapper à tout contexte d'empilement (stacking context)
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fade-up"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex w-full max-w-lg max-h-[90vh] flex-col rounded-3xl border border-white/20 bg-plum-950 shadow-2xl">
        {/* En-tête — toujours visible en haut */}
        <div className="shrink-0 flex items-center justify-between border-b border-white/10 px-6 pt-6 pb-3">
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className="text-xs text-white/50">
              Glissez l&apos;image pour ajuster le cadrage · Zoomez avec le curseur
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Contenu scrollable — zone de cadrage + zoom */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 [scrollbar-width:thin]">
          {/* Zone de cadrage */}
          <div className="relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-2xl bg-black/60 p-3">
            <div
              ref={containerRef}
              style={{ width: `${frameWidth}px`, height: `${frameHeight}px`, maxWidth: "100%" }}
              className={`relative overflow-hidden rounded-xl border-2 border-dashed border-rose-gold shadow-2xl ${
                isDragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Cadrage"
                onLoad={onImageLoad}
                draggable={false}
                className="pointer-events-none select-none max-w-none transition-transform duration-75"
                style={{
                  width: `${currentWidth}px`,
                  height: `${currentHeight}px`,
                  position: "absolute",
                  left: `${(frameWidth - currentWidth) / 2 + clampedPanX}px`,
                  top: `${(frameHeight - currentHeight) / 2 + clampedPanY}px`,
                }}
              />

              {/* Grille de composition 3x3 */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-30">
                <div className="border-b border-r border-white/40" />
                <div className="border-b border-r border-white/40" />
                <div className="border-b border-r border-white/40" />
                <div className="border-b border-r border-white/40" />
                <div className="border-b border-r border-white/40" />
                <div className="border-b border-r border-white/40" />
                <div className="border-r border-white/40" />
                <div className="border-r border-white/40" />
                <div />
              </div>

              {/* Repère visuel circulaire pour logo */}
              {aspectRatio === 1 && (
                <div className="pointer-events-none absolute inset-0 rounded-full border border-rose-gold/40" />
              )}
            </div>
          </div>

          {/* Contrôle de zoom */}
          <div className="mt-4 flex items-center gap-3 px-1">
            <span className="text-xs font-semibold text-white/70">Zoom</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-white/10 accent-rose-gold"
            />
            <span className="w-10 text-end font-mono text-xs text-white/60">{zoom.toFixed(1)}x</span>
          </div>
        </div>

        {/* Boutons d'action — toujours visibles en bas (sticky footer) */}
        <div className="shrink-0 flex justify-end gap-3 border-t border-white/10 px-6 pb-5 pt-4 bg-plum-950 rounded-b-3xl">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirmCrop}
            disabled={!imgLoaded}
            className="flex items-center gap-1.5 rounded-xl bg-rose-gold px-5 py-2.5 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105 disabled:opacity-50"
          >
            <CheckIcon width={14} height={14} />
            <span>Valider le cadrage</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
