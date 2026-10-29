import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  PinIcon,
  PhoneIcon,
  SparkleIcon,
  StarIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { CenterCard } from "@/components/vitrine/center-card";
import { GallerySection } from "@/components/vitrine/gallery-section";
import { ReviewsSection } from "@/components/vitrine/reviews-section";
import { getPublicCenterShowcase } from "@/lib/data/vitrine";
import { governorateLabel } from "@/lib/definitions";

type Props = {
  params: Promise<{ slug: string; centerId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, centerId } = await params;
  const data = await getPublicCenterShowcase(slug, centerId);
  if (!data) return { title: "Centre introuvable · Salonia" };

  const title = `${data.center.name} (${data.salon.name}) · Réservation en ligne`;
  const description = `${data.center.name} à ${governorateLabel(data.center.governorate)}. Horaires, prestations, avis et prise de rendez-vous en ligne.`;

  return {
    title,
    description,
  };
}

export default async function CenterShowcasePage({ params }: Props) {
  const { slug, centerId } = await params;
  const data = await getPublicCenterShowcase(slug, centerId);
  if (!data) notFound();

  const { salon, center, reviews, realizations, reviewStats } = data;
  const { theme, features } = salon;

  const bookingUrl = `/reserver/${salon.slug}?centerId=${center.id}`;

  return (
    <div className="min-h-screen bg-[#180916] text-white">
      {/* Barre supérieure */}
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-plum-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href={`/salon/${salon.slug}`}
            className="flex items-center gap-2 text-xs font-medium text-white/70 transition hover:text-white"
          >
            <ArrowLeftIcon width={14} height={14} className="rtl:-scale-x-100" />
            <span>
              <T>Retour à</T> {salon.name}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <LanguageToggle />
            <Link
              href={bookingUrl}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
              style={{ backgroundColor: theme.primaryColor }}
            >
              <span>
                <T>Réserver dans ce centre</T>
              </span>
              <ArrowRightIcon width={14} height={14} className="rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      </nav>

      {/* En-tête du centre */}
      <header className="relative border-b border-white/10 bg-plum-950/40 py-12">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <span className="rounded-full bg-rose-gold/20 border border-rose-gold/40 px-3 py-1 text-xs font-semibold text-rose-gold">
                {governorateLabel(center.governorate)}
              </span>

              <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
                {center.name}
              </h1>

              <p className="mt-1 text-sm text-white/60">
                <T>Centre officiel de</T> <span className="text-white font-medium">{salon.name}</span>
              </p>

              {center.address && (
                <p className="mt-3 flex items-start gap-2 text-xs text-white/80">
                  <PinIcon width={16} height={16} className="mt-0.5 shrink-0 text-rose-gold" />
                  <span>{center.address}</span>
                </p>
              )}

              {center.phone && (
                <p className="mt-1.5 flex items-center gap-2 text-xs text-white/80">
                  <PhoneIcon width={14} height={14} className="shrink-0 text-rose-gold" />
                  <span>{center.phone}</span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <Link
                href={bookingUrl}
                className="flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-plum-950 shadow-xl transition hover:brightness-105"
                style={{ backgroundColor: theme.primaryColor }}
              >
                <CalendarIcon width={16} height={16} />
                <span>
                  <T>Prendre rendez-vous</T>
                </span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Corps de la page du centre */}
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 space-y-12">
        {/* Grille : Horaires & Praticiennes */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Horaires d'ouverture */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <ClockIcon width={18} height={18} className="text-rose-gold" />
              <T>Horaires d'ouverture</T>
            </h2>

            <div className="mt-4 space-y-2">
              {Object.entries(center.openingHours).map(([day, hours]) => (
                <div
                  key={day}
                  className="flex items-center justify-between border-b border-white/5 py-1.5 text-xs"
                >
                  <span className="capitalize text-white/70">{day}</span>
                  <span className={hours ? "font-medium text-white" : "text-white/40 italic"}>
                    {hours || <T>Fermé</T>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Équipe & Praticiennes */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <UsersIcon width={18} height={18} className="text-rose-gold" />
              <T>L'équipe du centre</T>
            </h2>

            {center.practitioners.length === 0 ? (
              <p className="mt-4 text-xs text-white/50">
                <T>Les praticiennes seront bientôt affichées.</T>
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {center.practitioners.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-3"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-gold/20 font-bold text-rose-gold">
                      {p.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-white">{p.name}</p>
                      <p className="text-[10px] text-white/50">
                        <T>Praticienne qualifiée</T>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Galerie du centre */}
        {features.gallery && realizations.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-white">
              <T>Réalisations de ce centre</T>
            </h2>
            <GallerySection realizations={realizations} />
          </div>
        )}

        {/* Avis spécifiques à ce centre */}
        {features.reviews && (
          <div className="space-y-4">
            <h2 className="font-display text-xl font-bold text-white">
              <T>Avis clientes sur ce centre</T>
            </h2>
            <ReviewsSection
              reviews={reviews}
              stats={reviewStats}
              organizationId={salon.id}
              slug={salon.slug}
              selectedCenterId={center.id}
            />
          </div>
        )}
      </main>
    </div>
  );
}
