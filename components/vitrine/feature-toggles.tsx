"use client";

import { useState, useTransition } from "react";
import { updateFeaturesAction } from "@/app/actions/vitrine";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Toast } from "@/components/ui/modal";
import {
  BoxIcon,
  CheckIcon,
  SparkleIcon,
  TagIcon,
  UsersIcon,
  WalletIcon,
  WandIcon,
} from "@/components/ui/icons";
import type { FeaturesConfig } from "@/lib/vitrine/schemas";

type FeatureItem = {
  key: keyof FeaturesConfig;
  title: string;
  description: string;
  icon: any;
  category: "commercial" | "engagement" | "operations";
};

const FEATURES: FeatureItem[] = [
  {
    key: "onlinePayment",
    title: "Paiement en ligne & Acomptes",
    description: "Permettre aux clientes de régler en ligne ou de verser un acompte à la réservation.",
    icon: WalletIcon,
    category: "commercial",
  },
  {
    key: "packs",
    title: "Packs & Forfaits de prestations",
    description: "Vente de séances groupées avec tarifs préférentiels (mariage, cures de soins…).",
    icon: BoxIcon,
    category: "commercial",
  },
  {
    key: "promotions",
    title: "Promotions & Réductions temporaires",
    description: "Activation des remises en pourcentage ou montant fixe sur vos services.",
    icon: TagIcon,
    category: "commercial",
  },
  {
    key: "reviews",
    title: "Avis & Témoignages clientes",
    description: "Collecte des notes et commentaires avec système de modération avant publication.",
    icon: SparkleIcon,
    category: "engagement",
  },
  {
    key: "gallery",
    title: "Galerie de réalisations & Portfolio",
    description: "Exposer vos plus belles coiffures, maquillages et soins sur votre vitrine.",
    icon: SparkleIcon,
    category: "engagement",
  },
  {
    key: "invitations",
    title: "Studio d'affiches & Invitations VIP",
    description: "Générer des visuels téléchargeables prêts à partager sur Instagram et Facebook.",
    icon: WandIcon,
    category: "engagement",
  },
  {
    key: "loyalty",
    title: "Programme de fidélité",
    description: "Attribution de points et avantages exclusifs pour récompenser la régularité.",
    icon: UsersIcon,
    category: "commercial",
  },
  {
    key: "multiCenter",
    title: "Multi-centres & Établissements",
    description: "Afficher l'ensemble de vos adresses et permettre le choix du centre par la cliente.",
    icon: BoxIcon,
    category: "operations",
  },
];

export function FeatureToggles({
  initialFeatures,
}: {
  initialFeatures: FeaturesConfig;
}) {
  const { t } = useI18n();
  const [features, setFeatures] = useState<FeaturesConfig>(initialFeatures);
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const toggleFeature = (key: keyof FeaturesConfig) => {
    const updated = {
      ...features,
      [key]: !features[key],
    };
    setFeatures(updated);

    startTransition(async () => {
      const res = await updateFeaturesAction(updated);
      if (res.ok) {
        setToast({ tone: "success", message: t("Modules mis à jour avec succès.") });
      } else {
        setToast({ tone: "error", message: res.message || t("Erreur de mise à jour.") });
        // Annulation en cas d'échec
        setFeatures(features);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-white">
            {t("Activation des modules du salon")}
          </h3>
          <p className="text-sm text-white/60">
            {t("Personnalisez votre salon en activant uniquement les fonctionnalités dont vous avez besoin.")}
          </p>
        </div>
        {isPending && (
          <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-rose-gold">
            <span className="h-2 w-2 animate-ping rounded-full bg-rose-gold" />
            {t("Enregistrement…")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FEATURES.map((feat) => {
          const Icon = feat.icon;
          const isEnabled = Boolean(features[feat.key]);

          return (
            <div
              key={feat.key}
              onClick={() => toggleFeature(feat.key)}
              className={`group relative flex cursor-pointer items-start justify-between gap-4 rounded-3xl border p-5 transition-all duration-300 ${
                isEnabled
                  ? "border-rose-gold/40 bg-white/[0.04] shadow-[0_8px_30px_-12px_rgb(232_180_160/0.25)] hover:border-rose-gold/60"
                  : "border-white/10 bg-white/[0.015] opacity-70 hover:opacity-100"
              }`}
            >
              <div className="flex items-start gap-3.5">
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border transition ${
                    isEnabled
                      ? "border-rose-gold/50 bg-rose-gold/15 text-rose-gold"
                      : "border-white/10 bg-white/5 text-white/40"
                  }`}
                >
                  <Icon width={20} height={20} />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-white group-hover:text-rose-gold transition">
                    {t(feat.title)}
                  </h4>
                  <p className="mt-1 text-xs text-white/50 leading-relaxed">
                    {t(feat.description)}
                  </p>
                </div>
              </div>

              {/* Bouton bascule (Switch interactif) */}
              <div
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out ${
                  isEnabled ? "bg-emerald-500" : "bg-white/15"
                }`}
                role="switch"
                aria-checked={isEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-300 ease-in-out ${
                    isEnabled ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {toast && (
        <Toast tone={toast.tone} onDone={() => setToast(null)}>
          {toast.message}
        </Toast>
      )}
    </div>
  );
}
