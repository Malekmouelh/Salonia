"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowRightIcon, ClockIcon, PinIcon, SparkleIcon, UsersIcon } from "@/components/ui/icons";
import type { PublicShowcaseCenter } from "@/lib/data/vitrine";
import { governorateLabel } from "@/lib/definitions";
import { ShareModal } from "./share-modal";

export function CenterCard({
  center,
  salonSlug,
  salonName,
  primaryColor = "#e8b4a0",
}: {
  center: PublicShowcaseCenter;
  salonSlug: string;
  salonName: string;
  primaryColor?: string;
}) {
  const { t } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);

  const centerUrl = typeof window !== "undefined"
    ? `${window.location.origin}/salon/${salonSlug}/${center.id}`
    : `https://salonia.tn/salon/${salonSlug}/${center.id}`;

  const bookingUrl = `/reserver/${salonSlug}?centerId=${center.id}`;

  // Horaires synthétiques
  const [todayKey, setTodayKey] = useState<string>("lundi");
  useEffect(() => {
    try {
      const day = new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(new Date()).toLowerCase();
      setTodayKey(day);
    } catch {
      // fallback lundi
    }
  }, []);
  const todayHours = center.openingHours[todayKey] || center.openingHours["lundi"] || "09:00 - 19:00";

  return (
    <>
      <div className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-lg transition-all duration-300 hover:border-white/20 hover:bg-white/[0.05]">
        {/* Photo d'en-tête du centre */}
        <div className="relative h-44 w-full overflow-hidden bg-gradient-to-br from-plum-900 to-plum-950">
          {center.photos?.[0] ? (
            <img
              src={center.photos[0]}
              alt={center.name}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/30">
              <SparkleIcon width={32} height={32} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-plum-950/90 via-transparent to-transparent" />
          <span className="absolute top-3 end-3 rounded-full border border-white/20 bg-black/50 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {governorateLabel(center.governorate)}
          </span>
        </div>

        {/* Détails du centre */}
        <div className="flex flex-1 flex-col justify-between p-5">
          <div>
            <h3 className="font-display text-xl font-bold text-white group-hover:text-rose-gold transition">
              {center.name}
            </h3>

            {center.address && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-white/70">
                <PinIcon width={14} height={14} className="mt-0.5 shrink-0 text-rose-gold" />
                <span>{center.address}</span>
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/60">
              <span className="flex items-center gap-1 rounded-xl bg-white/5 px-2.5 py-1">
                <ClockIcon width={12} height={12} />
                <span>{todayHours}</span>
              </span>

              {center.practitioners.length > 0 && (
                <span className="flex items-center gap-1 rounded-xl bg-white/5 px-2.5 py-1">
                  <UsersIcon width={12} height={12} />
                  <span>
                    {center.practitioners.length}{" "}
                    {t(center.practitioners.length > 1 ? "praticiennes" : "praticienne")}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Actions : Réserver, Explorer, Partager */}
          <div className="mt-6 flex flex-col gap-2 pt-4 border-t border-white/5">
            <Link
              href={bookingUrl}
              className="flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
              style={{ backgroundColor: primaryColor }}
            >
              <span>{t("Prendre rendez-vous")}</span>
              <ArrowRightIcon width={14} height={14} className="rtl:-scale-x-100" />
            </Link>

            <div className="grid grid-cols-2 gap-2">
              <Link
                href={`/salon/${salonSlug}/${center.id}`}
                className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 py-2 text-center text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                {t("Détails du centre")}
              </Link>

              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                {t("QR & Partager")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={`${t("Partager")} : ${center.name}`}
        url={centerUrl}
        salonName={salonName}
        centerName={center.name}
      />
    </>
  );
}
