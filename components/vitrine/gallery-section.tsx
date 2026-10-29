"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { PublicRealizationItem } from "@/lib/data/vitrine";

export function GallerySection({
  realizations,
}: {
  realizations: PublicRealizationItem[];
}) {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [activePhoto, setActivePhoto] = useState<PublicRealizationItem | null>(null);

  if (realizations.length === 0) {
    return null;
  }

  // Extraction dynamique des catégories existantes
  const categories = [
    "ALL",
    ...Array.from(new Set(realizations.map((r) => r.category).filter(Boolean))),
  ];

  const filtered =
    selectedCategory === "ALL"
      ? realizations
      : realizations.filter((r) => r.category === selectedCategory);

  return (
    <section className="space-y-6">
      {/* Filtres de catégories */}
      {categories.length > 2 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                selectedCategory === cat
                  ? "bg-rose-gold text-plum-950 font-semibold shadow-md"
                  : "border border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
              }`}
            >
              {cat === "ALL" ? t("Toutes les réalisations") : cat}
            </button>
          ))}
        </div>
      )}

      {/* Grille de réalisations */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((item) => (
          <div
            key={item.id}
            onClick={() => setActivePhoto(item)}
            className="group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-md transition duration-300 hover:scale-[1.02] hover:border-rose-gold/50 hover:shadow-xl"
          >
            <img
              src={item.photo}
              alt={item.title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
              loading="lazy"
            />
            {/* Voile dégradé avec titre */}
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3 opacity-90 transition duration-300 group-hover:opacity-100">
              <span className="w-fit rounded-full bg-rose-gold/20 backdrop-blur border border-rose-gold/40 px-2 py-0.5 text-[9px] font-semibold text-rose-gold">
                {item.category}
              </span>
              <p className="mt-1 text-xs font-medium text-white truncate">{item.title}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox / Agrandissement */}
      {activePhoto && (
        <Modal
          open={Boolean(activePhoto)}
          onClose={() => setActivePhoto(null)}
          title={activePhoto.title}
          wide
        >
          <div className="space-y-4">
            <div className="relative max-h-[70vh] overflow-hidden rounded-2xl border border-white/10 bg-black/60 flex items-center justify-center">
              <img
                src={activePhoto.photo}
                alt={activePhoto.title}
                className="max-h-[68vh] w-auto max-w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white">
                {activePhoto.category}
              </span>
              <span>{new Date(activePhoto.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
