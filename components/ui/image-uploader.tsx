"use client";

import { useRef, useState } from "react";
import { PlusIcon, TrashIcon } from "@/components/ui/icons";

interface ImageUploaderProps {
  label: string;
  hint?: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  maxPhotos?: number;
}

export function ImageUploader({
  label,
  hint = "Glissez vos photos ou cliquez pour parcourir (PNG, JPG, WebP - max 3 Mo par image).",
  photos,
  onChange,
  maxPhotos = 6,
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Seules les images sont acceptées."));
        return;
      }
      if (file.size > 3.5 * 1024 * 1024) {
        reject(new Error("Image trop volumineuse (max 3.5 Mo)."));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Compression automatique via canvas pour que le chargement soit ultra rapide
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxDim = 1200;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);

          // WebP ou JPEG optimisé
          const optimizedDataUrl = canvas.toDataURL("image/webp", 0.85);
          resolve(optimizedDataUrl);
        };
        img.onerror = () => resolve(result); // Fallback dataUrl standard
        img.src = result;
      };
      reader.onerror = () => reject(new Error("Erreur de lecture du fichier."));
      reader.readAsDataURL(file);
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);

    const availableSlots = maxPhotos - photos.length;
    if (availableSlots <= 0) {
      setError(`Limite de ${maxPhotos} photos atteinte.`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, availableSlots);
    try {
      const converted = await Promise.all(filesToProcess.map((f) => processFile(f)));
      onChange([...photos, ...converted]);
    } catch (err: any) {
      setError(err?.message || "Impossible de charger l'image.");
    }
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
            className="text-[11px] text-white/40 hover:text-red-400"
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
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 text-rose-gold transition group-hover:scale-110">
            <PlusIcon width={18} height={18} />
          </span>
          <p className="mt-2 text-xs font-medium text-white">
            Cliquez pour téléverser ou glissez vos photos ici
          </p>
          <p className="mt-0.5 text-[11px] text-white/40">{hint}</p>
        </div>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}

      {/* Galerie de prévisualisation des photos */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
          {photos.map((photo, idx) => (
            <div
              key={idx}
              className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5 shadow-md"
            >
              <img
                src={photo}
                alt={`Photo ${idx + 1}`}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(idx);
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition group-hover:opacity-100"
                title="Supprimer la photo"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-red-500/80 text-white hover:bg-red-500">
                  <TrashIcon width={14} height={14} />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
