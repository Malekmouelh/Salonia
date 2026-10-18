"use client";

import { useState, useTransition } from "react";
import { updateCenterPhotos } from "@/app/actions/centers";
import { ImageUploader } from "@/components/ui/image-uploader";
import { SparkleIcon } from "@/components/ui/icons";

interface CenterPhotosGalleryProps {
  centerId: string;
  initialPhotos: string[];
  isEditable?: boolean;
}

export function CenterPhotosGallery({
  centerId,
  initialPhotos,
  isEditable = true,
}: CenterPhotosGalleryProps) {
  const [photos, setPhotos] = useState<string[]>(initialPhotos);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const handleSave = () => {
    setStatusMessage(null);
    startTransition(async () => {
      const res = await updateCenterPhotos(centerId, photos);
      if (res.ok) {
        setStatusMessage({ text: res.message || "Photos mises à jour." });
        setIsEditing(false);
      } else {
        setStatusMessage({ text: res.message || "Erreur de mise à jour.", isError: true });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-white/50 font-semibold">
            Galerie & Ambiance du centre ({photos.length})
          </span>
          {photos.length > 0 && (
            <span className="rounded-full bg-rose-gold/15 px-2 py-0.5 text-[10px] font-medium text-rose-gold">
              Photos visibles par les clients
            </span>
          )}
        </div>

        {isEditable && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition"
          >
            {photos.length === 0 ? "＋ Ajouter des photos" : "Gérer les photos"}
          </button>
        )}
      </div>

      {statusMessage && (
        <div
          className={`rounded-xl p-3 text-xs ${
            statusMessage.isError
              ? "bg-red-500/15 border border-red-500/30 text-red-200"
              : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-200"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {isEditing ? (
        <div className="rounded-2xl border border-rose-gold/30 bg-white/[0.03] p-4 space-y-4">
          <ImageUploader
            label="Modifier les photos du centre"
            photos={photos}
            onChange={setPhotos}
            maxPhotos={8}
            hint="Glissez vos photos (espace d'accueil, cabines, soins, équipe...). Vos clients verront ces images lors de leur réservation."
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setPhotos(initialPhotos);
                setIsEditing(false);
              }}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/60 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              className="btn-shine rounded-xl px-5 py-2 text-xs font-semibold text-plum-950 disabled:opacity-50"
            >
              {isPending ? "Enregistrement..." : "Enregistrer les photos"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {photos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <SparkleIcon className="mx-auto h-8 w-8 text-white/20 mb-2" />
              <p className="text-xs text-white/50">
                Aucune photo ajoutée pour ce centre pour le moment.
              </p>
              {isEditable && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-rose-gold hover:underline"
                >
                  Téléverser des photos maintenant →
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((src, i) => (
                <div
                  key={i}
                  onClick={() => setSelectedPhoto(src)}
                  className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-md transition duration-300 hover:border-rose-gold/50 hover:shadow-lg"
                >
                  <img
                    src={src}
                    alt={`Photo centre ${i + 1}`}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100 flex items-end p-2.5">
                    <span className="text-[11px] text-white/90 font-medium">Agrandir</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal d'agrandissement de photo */}
      {selectedPhoto && (
        <div
          onClick={() => setSelectedPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
        >
          <div className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-3xl border border-white/20 bg-plum-950 p-2 shadow-2xl">
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 end-4 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              ✕
            </button>
            <img
              src={selectedPhoto}
              alt="Photo agrandie"
              className="max-h-[85vh] w-auto rounded-2xl object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
