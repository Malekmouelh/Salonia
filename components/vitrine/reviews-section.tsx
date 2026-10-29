"use client";

import { useActionState, useState } from "react";
import { submitPublicReviewAction } from "@/app/actions/vitrine";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { CheckIcon, SparkleIcon, StarIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { PublicReviewItem, PublicShowcaseCenter } from "@/lib/data/vitrine";

// Petite icône étoile interactive
function Star({ filled, onSelect }: { filled: boolean; onSelect?: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      className={`transition-transform duration-200 ${onSelect ? "hover:scale-125 cursor-pointer" : "cursor-default"}`}
    >
      <svg
        viewBox="0 0 24 24"
        width={18}
        height={18}
        fill={filled ? "#f59e0b" : "none"}
        stroke={filled ? "#f59e0b" : "currentColor"}
        strokeWidth={1.5}
        className={filled ? "text-amber-400" : "text-white/20"}
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}

export function ReviewsSection({
  reviews,
  stats,
  organizationId,
  slug,
  centers,
  selectedCenterId,
}: {
  reviews: PublicReviewItem[];
  stats: { average: number; count: number };
  organizationId: string;
  slug: string;
  centers?: PublicShowcaseCenter[];
  selectedCenterId?: string | null;
}) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [state, formAction, isPending] = useActionState(submitPublicReviewAction, undefined);

  return (
    <section className="space-y-8">
      {/* En-tête des avis avec statistiques */}
      <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 backdrop-blur">
        <div className="flex items-center gap-5">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-amber-400/10 border border-amber-400/30">
            <span className="font-display text-3xl font-bold text-amber-300">
              {stats.average > 0 ? stats.average.toFixed(1) : "5.0"}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} filled={s <= Math.round(stats.average)} />
              ))}
            </div>
            <p className="mt-1 text-xs text-white/60">
              {stats.count > 0
                ? `${t("Basé sur")} ${stats.count} ${t("avis clientes vérifiés")}`
                : t("Soyez la première à donner votre avis")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-2xl border border-rose-gold/40 bg-rose-gold/15 px-5 py-3 text-sm font-semibold text-rose-gold transition hover:bg-rose-gold hover:text-plum-950"
        >
          <SparkleIcon width={16} height={16} />
          {t("Laisser un avis")}
        </button>
      </div>

      {/* Grille des avis clients */}
      {reviews.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">
          {t("Aucun avis pour le moment. Votre retour compte beaucoup pour nous !")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((rev) => (
            <div
              key={rev.id}
              className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.025] p-5 shadow-sm transition hover:border-white/20"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} filled={s <= rev.rating} />
                    ))}
                  </div>
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                    <CheckIcon width={12} height={12} />
                    {t("Avis vérifié")}
                  </span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-white/80 italic">
                  "{rev.comment || t("Prestation parfaite et accueil très chaleureux.")}"
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                <span className="text-xs font-semibold text-white">{rev.authorName}</span>
                <span className="text-[10px] text-white/40">
                  {new Date(rev.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modale de dépôt d'avis */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("Partagez votre expérience")}
      >
        <form action={formAction} className="space-y-4">
          {state?.message && <Alert tone="error">{state.message}</Alert>}
          {state?.success && (
            <div className="space-y-3">
              <Alert tone="success">{state.success}</Alert>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-full rounded-2xl bg-white/10 py-3 text-xs font-semibold text-white hover:bg-white/15"
              >
                {t("Fermer")}
              </button>
            </div>
          )}

          {!state?.success && (
            <>
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="rating" value={rating} />
              {selectedCenterId && <input type="hidden" name="centerId" value={selectedCenterId} />}

              {/* Sélection de la note par étoiles */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Votre note")}
                </label>
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} filled={s <= rating} onSelect={() => setRating(s)} />
                  ))}
                  <span className="ms-2 text-xs font-medium text-amber-300">
                    {rating} / 5
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Votre nom ou prénom")}
                </label>
                <input
                  name="authorName"
                  required
                  placeholder="ex. Sarra M."
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-rose-gold"
                />
              </div>

              {centers && centers.length > 1 && !selectedCenterId && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
                    {t("Centre visité (optionnel)")}
                  </label>
                  <select
                    name="centerId"
                    className="w-full rounded-2xl border border-white/10 bg-plum-950 px-4 py-3 text-sm text-white outline-none focus:border-rose-gold"
                  >
                    <option value="">{t("Sélectionnez un centre...")}</option>
                    {centers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.governorate})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
                  {t("Votre commentaire")}
                </label>
                <textarea
                  name="comment"
                  rows={4}
                  maxLength={500}
                  placeholder={t("Partagez votre avis sur l'accueil, la ponctualité et la qualité des prestations...")}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-rose-gold"
                />
              </div>

              <SubmitButton pending={isPending}>
                {t("Publier mon avis")}
              </SubmitButton>
            </>
          )}
        </form>
      </Modal>
    </section>
  );
}
