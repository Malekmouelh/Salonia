"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  createRealizationDirectAction,
  deleteRealizationAction,
  deleteReviewAction,
  moderateReviewAction,
} from "@/app/actions/vitrine";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, SubmitButton } from "@/components/ui/form";
import {
  ArrowRightIcon,
  BoxIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  PaletteIcon,
  PinIcon,
  PlusIcon,
  SparkleIcon,
  StarIcon,
  StoreIcon,
  TrashIcon,
  WandIcon,
} from "@/components/ui/icons";
import { ImageUploader } from "@/components/ui/image-uploader";
import { Modal, Toast } from "@/components/ui/modal";
import type { getAdminVitrineData } from "@/lib/vitrine/service";
import { FeatureToggles } from "./feature-toggles";
import { InvitationStudio } from "./invitation-studio";
import { ShareModal } from "./share-modal";
import { ThemeEditor } from "./theme-editor";

type AdminData = Awaited<ReturnType<typeof getAdminVitrineData>>;

export function AdminVitrineView({ data }: { data: AdminData }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<
    "theme" | "features" | "studio" | "reviews" | "gallery" | "links"
  >("theme");

  const [reviews, setReviews] = useState(data.reviews);
  const [realizations, setRealizations] = useState(data.realizations);
  const [shareCenter, setShareCenter] = useState<any | null>(null);
  const [shareSalon, setShareSalon] = useState(false);
  const [addPhotoModal, setAddPhotoModal] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string>("");
  const [photoTitle, setPhotoTitle] = useState("");
  const [photoCategory, setPhotoCategory] = useState("Coiffure & Beauté");
  const [photoCenterId, setPhotoCenterId] = useState("");
  const [isAddingRealization, setIsAddingRealization] = useState(false);
  const [addRealizationError, setAddRealizationError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const salonUrl = typeof window !== "undefined"
    ? `${window.location.origin}/salon/${data.organization.slug}`
    : `https://salonia.tn/salon/${data.organization.slug}`;

  // Modération d'un avis
  const handleModerateReview = (reviewId: string, status: "APPROVED" | "HIDDEN") => {
    startTransition(async () => {
      const res = await moderateReviewAction(reviewId, status);
      if (res.ok) {
        setReviews((prev) =>
          prev.map((r) => (r.id === reviewId ? { ...r, status } : r)),
        );
        setToast({ tone: "success", message: res.message || t("Avis mis à jour.") });
      } else {
        setToast({ tone: "error", message: res.message || t("Erreur de modération.") });
      }
    });
  };

  // Suppression d'un avis
  const handleDeleteReview = (reviewId: string) => {
    if (!confirm(t("Confirmer la suppression de cet avis ?"))) return;
    startTransition(async () => {
      const res = await deleteReviewAction(reviewId);
      if (res.ok) {
        setReviews((prev) => prev.filter((r) => r.id !== reviewId));
        setToast({ tone: "success", message: t("Avis supprimé.") });
      } else {
        setToast({ tone: "error", message: res.message || t("Erreur.") });
      }
    });
  };

  // Suppression d'une photo de la galerie
  const handleDeleteRealization = (realizationId: string) => {
    if (!confirm(t("Confirmer le retrait de cette photo de la galerie ?"))) return;
    startTransition(async () => {
      const res = await deleteRealizationAction(realizationId);
      if (res.ok) {
        setRealizations((prev) => prev.filter((rz) => rz.id !== realizationId));
        setToast({ tone: "success", message: t("Photo retirée.") });
      } else {
        setToast({ tone: "error", message: res.message || t("Erreur.") });
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Barre d'accès rapide & statut */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 backdrop-blur">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blush to-champagne text-plum-950 font-bold text-lg shadow-md">
            <PaletteIcon width={22} height={22} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-bold text-white">
                {data.organization.name}
              </h2>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-400/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                {t("Vitrine en ligne")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShareSalon(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
          >
            <SparkleIcon width={14} height={14} className="text-rose-gold" />
            <span>{t("QR Code du salon")}</span>
          </button>

          <Link
            href={`/salon/${data.organization.slug}`}
            className="flex items-center gap-1.5 rounded-xl bg-rose-gold px-4 py-2 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
          >
            <span>{t("Voir la vitrine")}</span>
            <ArrowRightIcon width={14} height={14} className="rtl:-scale-x-100" />
          </Link>
        </div>
      </div>

      {/* Onglets de navigation Module 1 */}
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {[
          { id: "theme", label: "Design & Thème", icon: PaletteIcon, badge: null },
          { id: "features", label: "Fonctionnalités", icon: BoxIcon, badge: null },
          { id: "studio", label: "Studio Affiches & Invitations", icon: WandIcon, badge: "F1.4" },
          {
            id: "reviews",
            label: "Avis Clients",
            icon: StarIcon,
            badge: reviews.filter((r) => r.status === "PENDING").length || null,
          },
          { id: "gallery", label: "Galerie & Portfolio", icon: SparkleIcon, badge: realizations.length || null },
          { id: "links", label: "Liens & QR Codes", icon: StoreIcon, badge: data.centers.length },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-3 text-xs font-semibold transition-all duration-300 ${
                isActive
                  ? "bg-gradient-to-r from-blush to-champagne text-plum-950 shadow-[0_6px_20px_-6px_rgb(232_180_160/0.6)]"
                  : "border border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              <Icon width={16} height={16} />
              <span>{t(tab.label)}</span>
              {tab.badge !== null && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    isActive
                      ? "bg-plum-950/20 text-plum-950"
                      : "bg-rose-gold/20 text-rose-gold"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* ONGLET 1 : PERSONNALISATION DU THÈME (F1.1)                 */}
      {/* ─────────────────────────────────────────────────────────── */}
      {activeTab === "theme" && (
        <ThemeEditor
          initialTheme={data.theme}
          salonName={data.organization.name}
          slug={data.organization.slug}
        />
      )}

      {/* ─────────────────────────────────────────────────────────── */}
      {/* ONGLET 2 : ACTIVATION DES FONCTIONNALITÉS (F1.2)            */}
      {/* ─────────────────────────────────────────────────────────── */}
      {activeTab === "features" && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <FeatureToggles initialFeatures={data.features} />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────── */}
      {/* ONGLET 3 : STUDIO D'AFFICHES & INVITATIONS (F1.4)           */}
      {/* ─────────────────────────────────────────────────────────── */}
      {activeTab === "studio" && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8 backdrop-blur">
          <InvitationStudio
            salonName={data.organization.name}
            salonSlug={data.organization.slug}
            primaryColor={data.theme.primaryColor}
            secondaryColor={data.theme.secondaryColor}
          />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────── */}
      {/* ONGLET 4 : MODÉRATION DES AVIS CLIENTES (F1.5)              */}
      {/* ─────────────────────────────────────────────────────────── */}
      {activeTab === "reviews" && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-xl text-white">
                {t("Gestion & Modération des avis clientes")}
              </h3>
              <p className="text-xs text-white/50">
                {t("Validez les avis déposés par vos clientes avant leur affichage public.")}
              </p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
              {reviews.length} {t("avis reçus")}
            </span>
          </div>

          {reviews.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">
              {t("Aucun avis déposé pour le moment.")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/50">
                    <th className="pb-3 text-start font-semibold uppercase">{t("Auteur")}</th>
                    <th className="pb-3 text-start font-semibold uppercase">{t("Note")}</th>
                    <th className="pb-3 text-start font-semibold uppercase">{t("Commentaire")}</th>
                    <th className="pb-3 text-start font-semibold uppercase">{t("Statut")}</th>
                    <th className="pb-3 text-end font-semibold uppercase">{t("Actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {reviews.map((rev) => (
                    <tr key={rev.id} className="transition hover:bg-white/[0.02]">
                      <td className="py-3.5 pe-4 font-semibold text-white">
                        {rev.authorName}
                        <p className="text-[10px] text-white/40 font-normal">
                          {new Date(rev.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="py-3.5 pe-4">
                        <span className="flex items-center gap-1 font-bold text-amber-300">
                          <StarIcon width={14} height={14} />
                          {rev.rating} / 5
                        </span>
                      </td>
                      <td className="py-3.5 pe-4 max-w-xs text-white/80">
                        {rev.comment ? `"${rev.comment}"` : <span className="text-white/30 italic">Sans texte</span>}
                      </td>
                      <td className="py-3.5 pe-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                            rev.status === "APPROVED"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : rev.status === "PENDING"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : "bg-red-500/20 text-red-300 border border-red-500/30"
                          }`}
                        >
                          {rev.status === "APPROVED"
                            ? t("Approuvé")
                            : rev.status === "PENDING"
                              ? t("En attente")
                              : t("Masqué")}
                        </span>
                      </td>
                      <td className="py-3.5 text-end">
                        <div className="flex items-center justify-end gap-1.5">
                          {rev.status !== "APPROVED" && (
                            <button
                              type="button"
                              onClick={() => handleModerateReview(rev.id, "APPROVED")}
                              className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300 transition hover:bg-emerald-500/30"
                              title={t("Approuver et afficher sur la vitrine")}
                            >
                              <CheckIcon width={14} height={14} />
                            </button>
                          )}
                          {rev.status !== "HIDDEN" && (
                            <button
                              type="button"
                              onClick={() => handleModerateReview(rev.id, "HIDDEN")}
                              className="rounded-lg bg-amber-500/20 p-1.5 text-amber-300 transition hover:bg-amber-500/30"
                              title={t("Masquer cet avis")}
                            >
                              <EyeOffIcon width={14} height={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteReview(rev.id)}
                            className="rounded-lg bg-red-500/20 p-1.5 text-red-300 transition hover:bg-red-500/30"
                            title={t("Supprimer définitivement")}
                          >
                            <TrashIcon width={14} height={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────── */}
      {/* ONGLET 5 : GALERIE DE RÉALISATIONS (F1.5)                   */}
      {/* ─────────────────────────────────────────────────────────── */}
      {activeTab === "gallery" && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-xl text-white">
                {t("Galerie de réalisations & Portfolio")}
              </h3>
              <p className="text-xs text-white/50">
                {t("Mettez en avant le savoir-faire de votre équipe (coupes, couleurs, soins, manucure).")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddPhotoModal(true)}
              className="flex items-center gap-2 rounded-2xl bg-rose-gold px-4 py-2.5 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
            >
              <PlusIcon width={16} height={16} />
              <span>{t("Ajouter une réalisation")}</span>
            </button>
          </div>

          {realizations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-white/40">
              {t("Aucune réalisation ajoutée pour le moment. Cliquez sur Ajouter pour enrichir votre vitrine.")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {realizations.map((rz) => (
                <div
                  key={rz.id}
                  className="group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-md"
                >
                  <img
                    src={rz.photo}
                    alt={rz.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex flex-col justify-between bg-black/60 p-3 opacity-0 transition duration-300 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleDeleteRealization(rz.id)}
                      className="self-end rounded-lg bg-red-500/80 p-1.5 text-white transition hover:bg-red-500"
                      title={t("Supprimer")}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                    <div>
                      <span className="rounded-full bg-rose-gold/20 border border-rose-gold/40 px-2 py-0.5 text-[9px] font-semibold text-rose-gold">
                        {rz.category}
                      </span>
                      <p className="mt-1 text-xs font-medium text-white truncate">{rz.title}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────── */}
      {/* ONGLET 6 : LIENS PUBLICS ET QR CODES (F1.3)                 */}
      {/* ─────────────────────────────────────────────────────────── */}
      {activeTab === "links" && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur space-y-6">
          <div>
            <h3 className="font-display text-xl text-white">
              {t("Liens publics & QR Codes de vos centres (F1.3)")}
            </h3>
            <p className="text-xs text-white/50">
              {t("Chaque centre dispose de sa propre adresse web directe et de son QR Code imprimable.")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Carte du salon principal */}
            <div className="flex flex-col justify-between rounded-2xl border border-rose-gold/40 bg-white/[0.04] p-5 shadow-lg">
              <div>
                <span className="rounded-full bg-rose-gold/20 px-2.5 py-0.5 text-[10px] font-bold text-rose-gold">
                  {t("VITRINE PRINCIPALE")}
                </span>
                <h4 className="mt-2 font-display text-lg font-bold text-white">
                  {data.organization.name}
                </h4>
                <p className="mt-1 text-xs text-white/60">
                  {salonUrl}
                </p>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShareSalon(true)}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  {t("Afficher QR Code")}
                </button>
                <Link
                  href={`/salon/${data.organization.slug}`}
                  className="rounded-xl bg-rose-gold px-4 py-2.5 text-xs font-bold text-plum-950 transition hover:brightness-105"
                >
                  {t("Ouvrir")}
                </Link>
              </div>
            </div>

            {/* Cartes des centres individuels */}
            {data.centers.map((c) => {
              const centerUrl = `${salonUrl}/${c.id}`;
              return (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/20"
                >
                  <div>
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white/70">
                      {c.governorate}
                    </span>
                    <h4 className="mt-2 font-display text-lg font-bold text-white">{c.name}</h4>
                    <p className="mt-1 text-xs text-white/60 truncate">{c.address || centerUrl}</p>
                  </div>

                  <div className="mt-5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShareCenter(c)}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/10"
                    >
                      {t("QR Code du centre")}
                    </button>
                    <Link
                      href={`/salon/${data.organization.slug}/${c.id}`}
                      className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
                    >
                      {t("Ouvrir")}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modale d'ajout d'une photo dans la galerie */}
      <Modal
        open={addPhotoModal}
        onClose={() => {
          setAddPhotoModal(false);
          setAddRealizationError(null);
        }}
        title={t("Ajouter une réalisation")}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!photoDataUrl) {
              setAddRealizationError(t("Veuillez sélectionner une photo."));
              return;
            }
            if (!photoTitle.trim()) {
              setAddRealizationError(t("Veuillez renseigner un titre."));
              return;
            }

            setIsAddingRealization(true);
            setAddRealizationError(null);

            try {
              const res = await createRealizationDirectAction({
                title: photoTitle.trim(),
                category: photoCategory.trim() || "Coiffure & Beauté",
                photo: photoDataUrl,
                centerId: photoCenterId || undefined,
              });

              if (res.ok && res.data) {
                // Mise à jour instantanée du portfolio sans rechargement de page
                const newRz = {
                  id: res.data.id,
                  title: res.data.title,
                  category: res.data.category,
                  photo: res.data.photo,
                  centerId: photoCenterId || null,
                  createdAt: res.data.createdAt,
                };
                setRealizations((prev) => [newRz, ...prev]);

                // Message de succès clair (pop-up)
                setToast({
                  tone: "success",
                  message: t("Nouvelle réalisation ajoutée avec succès à votre vitrine !"),
                });

                // Fermeture et réinitialisation
                setAddPhotoModal(false);
                setPhotoDataUrl("");
                setPhotoTitle("");
                setPhotoCategory("Coiffure & Beauté");
                setPhotoCenterId("");
              } else {
                setAddRealizationError(res.message || t("Impossible d'ajouter la réalisation."));
              }
            } catch (err: any) {
              setAddRealizationError(err?.message || t("Une erreur est survenue."));
            } finally {
              setIsAddingRealization(false);
            }
          }}
          className="space-y-4"
        >
          {addRealizationError && (
            <Alert tone="error">{addRealizationError}</Alert>
          )}

          <ImageUploader
            label={t("Photo du soin / prestation")}
            photos={photoDataUrl ? [photoDataUrl] : []}
            maxPhotos={1}
            onChange={(p) => setPhotoDataUrl(p[0] || "")}
          />

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              {t("Titre de la réalisation")}
            </label>
            <input
              name="title"
              required
              value={photoTitle}
              onChange={(e) => setPhotoTitle(e.target.value)}
              placeholder="ex. Balayage Caramel & Brushing Wavy"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-rose-gold"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              {t("Catégorie")}
            </label>
            <input
              name="category"
              value={photoCategory}
              onChange={(e) => setPhotoCategory(e.target.value)}
              placeholder="ex. Coiffure, Onglerie, Soins Visage, Maquillage"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-rose-gold"
            />
          </div>

          {data.centers.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
                {t("Centre associé (optionnel)")}
              </label>
              <select
                name="centerId"
                value={photoCenterId}
                onChange={(e) => setPhotoCenterId(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-plum-950 px-4 py-3 text-sm text-white outline-none focus:border-rose-gold"
              >
                <option value="">{t("Tous les centres")}</option>
                {data.centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <SubmitButton pending={isAddingRealization}>
            {t("Enregistrer la photo")}
          </SubmitButton>
        </form>
      </Modal>

      {/* Modale de partage Salon */}
      <ShareModal
        open={shareSalon}
        onClose={() => setShareSalon(false)}
        title={`${t("QR Code")} : ${data.organization.name}`}
        url={salonUrl}
        salonName={data.organization.name}
      />

      {/* Modale de partage Centre */}
      {shareCenter && (
        <ShareModal
          open={Boolean(shareCenter)}
          onClose={() => setShareCenter(null)}
          title={`${t("QR Code")} : ${shareCenter.name}`}
          url={`${salonUrl}/${shareCenter.id}`}
          salonName={data.organization.name}
          centerName={shareCenter.name}
        />
      )}

      {toast && (
        <Toast tone={toast.tone} onDone={() => setToast(null)}>
          {toast.message}
        </Toast>
      )}
    </div>
  );
}
