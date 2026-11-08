"use client";

import { useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";
import { ImageCropModal } from "./image-crop-modal";

interface ImageUploaderProps {
  label: string;
  hint?: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  maxPhotos?: number;
  cropAspectRatio?: number; // ex: 1 pour logo, 16/6 (2.66) pour bannière
  cropTitle?: string;
}

export function ImageUploader({
  label,
  hint = "Glissez vos photos ou cliquez pour parcourir (PNG, JPG, WebP - max 3 Mo par image).",
  photos,
  onChange,
  maxPhotos = 6,
  cropAspectRatio,
  cropTitle,
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // État de la modale de recadrage
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [cropTargetIndex, setCropTargetIndex] = useState<number | null>(null);

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Seules les images sont acceptées."));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error("Image trop volumineuse (max 5 Mo)."));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error("Erreur de lecture du fichier."));
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const availableSlots = maxPhotos - photos.length;
    if (availableSlots <= 0 && maxPhotos > 1) {
      setError(`Limite de ${maxPhotos} photos atteinte.`);
      return;
    }

    const firstFile = files[0];
    try {
      const dataUrl = await readFileAsDataUrl(firstFile);

      // Si le recadrage est activé, ouvrir la modale immédiatement pour la première photo
      if (cropAspectRatio) {
        setImageToCrop(dataUrl);
        setCropTargetIndex(maxPhotos === 1 ? 0 : null);
        setCropModalOpen(true);
      } else {
        // Mode standard sans crop
        const remainingFiles = Array.from(files).slice(0, Math.max(1, availableSlots));
        const converted = await Promise.all(remainingFiles.map((f) => readFileAsDataUrl(f)));
        if (maxPhotos === 1) {
          onChange([converted[0]]);
        } else {
          onChange([...photos, ...converted]);
        }
      }
    } catch (err) {
      setError((err instanceof Error ? err.message : "") || "Impossible de charger l'image.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmCrop = (croppedDataUrl: string) => {
    if (cropTargetIndex !== null && photos[cropTargetIndex]) {
      // Remplacement de l'image existante recadrée
      const updated = [...photos];
      updated[cropTargetIndex] = croppedDataUrl;
      onChange(updated);
    } else if (maxPhotos === 1) {
      onChange([croppedDataUrl]);
    } else {
      onChange([...photos, croppedDataUrl]);
    }
    setCropModalOpen(false);
    setImageToCrop(null);
    setCropTargetIndex(null);
  };

  const handleOpenRecrop = (index: number) => {
    if (!photos[index]) return;
    setImageToCrop(photos[index]);
    setCropTargetIndex(index);
    setCropModalOpen(true);
  };

  const handleRemove = (index: number) => {
    onChange(photos.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
          {label} ({photos.length}/{maxPhotos})
        </label>
        {photos.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-white/40 transition hover:text-red-400"
          >
            Tout effacer
          </button>
        )}
      </div>

      {/* Zone de glisser-déposer / sélection de fichier */}
      {photos.length < maxPhotos && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition ${
            dragActive
              ? "border-rose-gold bg-rose-gold/10"
              : "border-white/15 bg-white/[0.02] hover:border-rose-gold/50 hover:bg-white/[0.05]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple={maxPhotos > 1}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-rose-gold transition group-hover:scale-110">
            <PlusIcon width={18} height={18} />
          </span>
          <p className="mt-2 text-xs font-medium text-white">
            Cliquez pour téléverser ou glissez votre photo ici
          </p>
          <p className="mt-0.5 text-[11px] text-white/40">{hint}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}

      {/* Galerie de prévisualisation des photos */}
      {photos.length > 0 && (
        <div
          className={
            maxPhotos === 1 && cropAspectRatio && cropAspectRatio > 1.5
              ? "grid grid-cols-1"
              : "grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6"
          }
        >
          {photos.map((photo, idx) => (
            <div
              key={idx}
              style={{
                aspectRatio:
                  maxPhotos === 1 && cropAspectRatio ? cropAspectRatio : 1,
              }}
              className="group relative overflow-hidden rounded-2xl border border-white/15 bg-black/40 shadow-md"
            >
              <img
                src={photo}
                alt={`${label} ${idx + 1}`}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />

              {/* Barre d'actions au survol */}
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/70 opacity-0 backdrop-blur-xs transition group-hover:opacity-100">
                {cropAspectRatio && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenRecrop(idx);
                    }}
                    className="flex items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-gold hover:text-plum-950 shadow-md"
                    title="Recadrer l'image"
                  >
                    <span>✂️ Cadrer</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(idx);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-xl bg-red-500/80 text-white transition hover:bg-red-500 shadow-md"
                  title="Supprimer la photo"
                >
                  <TrashIcon width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modale interactive de cadrage */}
      {cropModalOpen && imageToCrop && cropAspectRatio && (
        <ImageCropModal
          imageSrc={imageToCrop}
          aspectRatio={cropAspectRatio}
          title={cropTitle || "Cadrer l'image"}
          onConfirm={handleConfirmCrop}
          onCancel={() => {
            setCropModalOpen(false);
            setImageToCrop(null);
            setCropTargetIndex(null);
          }}
        />
      )}
    </div>
  );
}
