"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LanguageToggle, useI18n } from "@/components/i18n/i18n-provider";
import {
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  SparkleIcon,
  StarIcon,
  WalletIcon,
} from "@/components/ui/icons";
import type { PublicSalonShowcase } from "@/lib/data/vitrine";
import { FONT_OPTIONS } from "@/lib/vitrine/schemas";
import { CenterCard } from "./center-card";
import { GallerySection } from "./gallery-section";
import { ReviewsSection } from "./reviews-section";
import { ShareModal } from "./share-modal";

export function PublicSalonPage({ salon }: { salon: PublicSalonShowcase }) {
  const { t, lang } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("ALL");

  const { theme, features, centers, services, packs, reviews, reviewStats, realizations } = salon;

  // ── Mode d'ambiance dynamique (Sombre / Clair) avec bascule en 1 clic ──
  const [activeMode, setActiveMode] = useState<"dark" | "light">(() => {
    if (theme.colorMode === "light") return "light";
    if (theme.colorMode === "dark") return "dark";
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  });

  const isLight = activeMode === "light";

  const fontConfig = FONT_OPTIONS.find(
    (f) =>
      f.value.toLowerCase() === theme.fontFamily?.toLowerCase() ||
      f.label.toLowerCase() === theme.fontFamily?.toLowerCase(),
  );
  const fontFamilyCss = fontConfig
    ? fontConfig.cssFont
    : theme.fontFamily
      ? `'${theme.fontFamily}', system-ui, sans-serif`
      : "'Playfair Display', serif";

  const customFontHref =
    (theme as any).customFontUrl ||
    (!fontConfig &&
    theme.fontFamily &&
    !["playfair", "cormorant", "outfit", "inter", "tajawal", "cairo", "amiri"].includes(
      theme.fontFamily.toLowerCase(),
    )
      ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
          theme.fontFamily,
        )}:wght@400;600;700&display=swap`
      : null);

  const [publicUrl, setPublicUrl] = useState<string>(
    typeof window !== "undefined"
      ? `${window.location.origin}/salon/${salon.slug}`
      : `https://salonia.tn/salon/${salon.slug}`,
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPublicUrl(`${window.location.origin}/salon/${salon.slug}`);
    }
  }, [salon.slug]);

  // Filtrage des prestations
  const categories = [
    "ALL",
    ...Array.from(new Set(services.map((s: any) => s.category).filter(Boolean))),
  ];

  const filteredServices =
    activeCategory === "ALL"
      ? services
      : services.filter((s: any) => s.category === activeCategory);

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isLight ? "bg-[#fcfaf8] text-slate-900" : "bg-[#180916] text-white"
      }`}
      style={
        {
          "--vitrine-primary": theme.primaryColor,
          "--vitrine-secondary": theme.secondaryColor,
          "--vitrine-accent": theme.accentColor,
          "--font-display": fontFamilyCss,
        } as React.CSSProperties
      }
    >
      {customFontHref && <link rel="stylesheet" href={customFontHref} />}

      {/* ─────────────────────────────────────────────────────────── */}
      {/* BARRE DE NAVIGATION VITRINE                                 */}
      {/* ─────────────────────────────────────────────────────────── */}
      <nav
        className={`sticky top-0 z-40 border-b backdrop-blur-xl transition-colors duration-300 ${
          isLight
            ? "border-slate-200 bg-white/90 text-slate-900 shadow-xs"
            : "border-white/10 bg-plum-950/80 text-white"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href={`/salon/${salon.slug}`} className="flex items-center gap-3">
            {theme.logo ? (
              <img
                src={theme.logo}
                alt={salon.name}
                className="h-10 w-10 rounded-xl border border-white/15 object-cover"
                style={{
                  boxShadow: `0 0 0 2px ${theme.accentColor}40`,
                }}
              />
            ) : (
              <span
                className="grid h-10 w-10 place-items-center rounded-xl font-bold text-plum-950 shadow-md"
                style={{ backgroundColor: theme.primaryColor }}
              >
                {salon.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span
              className={`text-lg font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"}`}
              style={{ fontFamily: fontFamilyCss }}
            >
              {salon.name}
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Bouton de permutation Mode Sombre / Mode Clair (Demandé) */}
            <button
              type="button"
              onClick={() => setActiveMode((m) => (m === "dark" ? "light" : "dark"))}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                isLight
                  ? "border-slate-300 bg-white text-slate-800 shadow-xs hover:bg-slate-100"
                  : "border-white/15 bg-white/5 text-white hover:bg-white/10"
              }`}
              title={isLight ? t("Passer au mode sombre") : t("Passer au mode clair")}
              aria-label={isLight ? t("Passer au mode sombre") : t("Passer au mode clair")}
            >
              <span>{isLight ? "🌙" : "☀️"}</span>
              <span className="hidden sm:inline">{isLight ? t("Sombre") : t("Clair")}</span>
            </button>

            <LanguageToggle />

            {/* Bouton Partager & QR Code */}
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                isLight
                  ? "border-slate-300 bg-white text-slate-800 shadow-xs hover:bg-slate-100"
                  : "border-white/15 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              <SparkleIcon width={14} height={14} style={{ color: theme.accentColor || theme.primaryColor }} />
              <span className="hidden sm:inline">{t("Partager & QR")}</span>
            </button>

            <Link
              href={`/reserver/${salon.slug}`}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
              style={{ backgroundColor: theme.primaryColor }}
            >
              <span>{t("Réserver")}</span>
              <ArrowRightIcon width={14} height={14} className="rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* EN-TÊTE HERO & BANNIÈRE DU SALON (F1.1)                     */}
      {/* ─────────────────────────────────────────────────────────── */}
      <header className="relative">
        <div
          className="relative h-64 w-full overflow-hidden bg-gradient-to-r from-plum-950 to-plum-900 sm:h-80 md:h-96"
          style={{
            backgroundImage: theme.banner ? `url(${theme.banner})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div
            className={`absolute inset-0 bg-gradient-to-t ${
              isLight
                ? "from-[#fcfaf8] via-[#fcfaf8]/50 to-black/30"
                : "from-[#180916] via-[#180916]/50 to-black/30"
            }`}
          />
        </div>

        {/* Bloc d'identité flottant */}
        <div className="relative mx-auto -mt-20 max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
            {/* Logo */}
            {theme.logo ? (
              <img
                src={theme.logo}
                alt={salon.name}
                className="h-28 w-28 shrink-0 rounded-3xl border-4 object-cover shadow-2xl sm:h-36 sm:w-36"
                style={{
                  borderColor: theme.primaryColor,
                  boxShadow: `0 0 0 3px ${theme.accentColor || theme.primaryColor}50, 0 20px 30px -10px rgba(0,0,0,0.5)`,
                }}
              />
            ) : (
              <div
                className="grid h-28 w-28 shrink-0 place-items-center rounded-3xl border-4 font-display text-3xl font-bold shadow-2xl sm:h-36 sm:w-36"
                style={{
                  backgroundColor: theme.primaryColor,
                  borderColor: theme.accentColor || theme.primaryColor,
                  color: isLight ? "#1a0a14" : "#ffffff",
                }}
              >
                {salon.name.slice(0, 2).toUpperCase()}
              </div>
            )}

            {/* Titre & Slogan */}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1
                  className={`text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl ${
                    isLight ? "text-slate-900" : "text-white"
                  }`}
                  style={{
                    fontFamily: fontFamilyCss,
                  }}
                >
                  {salon.name}
                </h1>
                {reviewStats.count > 0 && (
                  <span
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                      isLight
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-amber-400/30 bg-amber-400/15 text-amber-300"
                    }`}
                  >
                    <StarIcon
                      width={14}
                      height={14}
                      className={isLight ? "text-amber-600" : "text-amber-400"}
                    />
                    <span>{reviewStats.average.toFixed(1)}</span>
                    <span className="opacity-70">({reviewStats.count})</span>
                  </span>
                )}
              </div>

              <p
                className={`mt-2 max-w-2xl text-sm leading-relaxed sm:text-base ${
                  isLight ? "text-slate-600" : "text-white/80"
                }`}
              >
                {theme.tagline || t("L'art de sublimer votre beauté au quotidien")}
              </p>
            </div>

            {/* Bouton de réservation rapide */}
            <div className="mt-2 sm:mt-0">
              <Link
                href={`/reserver/${salon.slug}`}
                className="flex items-center gap-2.5 rounded-2xl px-6 py-3.5 text-sm font-bold text-plum-950 shadow-xl transition duration-300 hover:scale-105 hover:brightness-105"
                style={{ backgroundColor: theme.primaryColor }}
              >
                <CalendarIcon width={18} height={18} />
                <span>{t("Prendre rendez-vous en ligne")}</span>
              </Link>
            </div>
          </div>

          {/* Description & Réseaux sociaux */}
          <div
            className={`mt-6 flex flex-wrap items-center justify-between gap-4 border-b pb-6 ${
              isLight ? "border-slate-200" : "border-white/10"
            }`}
          >
            <p
              className={`max-w-3xl text-xs leading-relaxed sm:text-sm ${
                isLight ? "text-slate-600" : "text-white/60"
              }`}
            >
              {theme.description ||
                t(
                  "Bienvenue dans notre salon. Découvrez notre sélection de soins, prestations de coiffure et forfaits sur-mesure.",
                )}
            </p>

            {/* Liens réseaux sociaux */}
            <div className="flex items-center gap-2">
              {theme.instagram && (
                <a
                  href={`https://instagram.com/${theme.instagram.replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`rounded-xl border px-3 py-1.5 text-xs transition ${
                    isLight
                      ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-xs"
                      : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  }`}
                >
                  Instagram
                </a>
              )}
              {theme.facebook && (
                <a
                  href={theme.facebook.startsWith("http") ? theme.facebook : `https://${theme.facebook}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`rounded-xl border px-3 py-1.5 text-xs transition ${
                    isLight
                      ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-xs"
                      : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  }`}
                >
                  Facebook
                </a>
              )}
              {theme.whatsapp && (
                <a
                  href={`https://wa.me/${theme.whatsapp.replace(/[^0-9]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400 transition hover:bg-emerald-500/20"
                >
                  WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* CONTENU PRINCIPAL                                           */}
      {/* ─────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 space-y-16">
        {/* Section 1 : Centres & Adresses (F1.3) */}
        {centers.length > 0 && (
          <section className="space-y-6">
            <div className="flex items-end justify-between">
              <div>
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isLight ? "text-amber-900" : "text-rose-gold"
                  }`}
                >
                  {t("Nos Adresses")}
                </span>
                <h2
                  className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${
                    isLight ? "text-slate-900" : "text-white"
                  }`}
                  style={{ fontFamily: fontFamilyCss }}
                >
                  {t("Choisissez votre centre")}
                </h2>
              </div>
              <span className={`text-xs ${isLight ? "text-slate-500" : "text-white/50"}`}>
                {centers.length} {t(centers.length > 1 ? "centres disponibles" : "centre")}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {centers.map((center) => (
                <CenterCard
                  key={center.id}
                  center={center}
                  salonSlug={salon.slug}
                  salonName={salon.name}
                  primaryColor={theme.primaryColor}
                  isLight={isLight}
                />
              ))}
            </div>
          </section>
        )}

        {/* Section 2 : Menu des prestations & tarifs (Catalogue) */}
        <section className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  isLight ? "text-amber-900" : "text-rose-gold"
                }`}
              >
                {t("Nos Soins & Prestations")}
              </span>
              <h2
                className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${
                  isLight ? "text-slate-900" : "text-white"
                }`}
                style={{ fontFamily: fontFamilyCss }}
              >
                {t("Menu & Tarifs")}
              </h2>
            </div>

            {/* Filtre catégories */}
            {categories.length > 2 && (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      activeCategory === cat
                        ? isLight
                          ? "bg-slate-900 text-white font-bold shadow-md"
                          : "text-plum-950 font-bold shadow-md"
                        : isLight
                          ? "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                          : "border border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
                    }`}
                    style={{
                      backgroundColor:
                        activeCategory === cat
                          ? isLight
                            ? "#180916"
                            : theme.primaryColor
                          : undefined,
                    }}
                  >
                    {cat === "ALL" ? t("Tous les soins") : cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredServices.map((srv: any) => (
              <div
                key={srv.id}
                className={`flex flex-col justify-between rounded-3xl border p-5 transition duration-300 ${
                  isLight
                    ? "border-slate-200 bg-white text-slate-800 shadow-xs hover:border-slate-300 hover:shadow-md"
                    : "border-white/10 bg-white/[0.03] text-white hover:border-white/20 hover:bg-white/[0.05]"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h3
                      className={`text-base font-semibold ${
                        isLight ? "text-slate-900" : "text-white"
                      }`}
                    >
                      {srv.name}
                    </h3>
                    <span
                      className={`shrink-0 font-display text-base font-bold ${
                        isLight ? "text-amber-900" : ""
                      }`}
                      style={{
                        color: isLight ? "#92400e" : theme.accentColor || theme.primaryColor,
                      }}
                    >
                      {srv.priceTnd} TND
                    </span>
                  </div>

                  <p
                    className={`mt-1 flex items-center gap-1.5 text-xs ${
                      isLight ? "text-slate-500" : "text-white/50"
                    }`}
                  >
                    <ClockIcon width={12} height={12} />
                    <span>{srv.durationMinutes} min</span>
                    {srv.category && (
                      <>
                        <span>•</span>
                        <span>{srv.category}</span>
                      </>
                    )}
                  </p>

                  {srv.description && (
                    <p
                      className={`mt-2.5 text-xs line-clamp-2 ${
                        isLight ? "text-slate-600" : "text-white/70"
                      }`}
                    >
                      {srv.description}
                    </p>
                  )}
                </div>

                <div
                  className={`mt-5 pt-3 border-t flex items-center justify-between ${
                    isLight ? "border-slate-100" : "border-white/5"
                  }`}
                >
                  {features.onlinePayment ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-500">
                      <WalletIcon width={12} height={12} />
                      {t("Paiement en ligne disponible")}
                    </span>
                  ) : (
                    <span />
                  )}

                  <Link
                    href={`/reserver/${salon.slug}?serviceId=${srv.id}`}
                    className={`flex items-center gap-1.5 text-xs font-semibold transition hover:translate-x-1 rtl:hover:-translate-x-1 ${
                      isLight ? "font-bold" : ""
                    }`}
                    style={{ color: isLight ? "#92400e" : theme.primaryColor }}
                  >
                    <span>{t("Réserver")}</span>
                    <ArrowRightIcon width={12} height={12} className="rtl:-scale-x-100" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3 : Packs & Forfaits (si activé par le salon F1.2) */}
        {features.packs && packs && packs.length > 0 && (
          <section className="space-y-6">
            <div>
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  isLight ? "text-amber-900" : "text-rose-gold"
                }`}
              >
                {t("Formules Privilèges")}
              </span>
              <h2
                className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${
                  isLight ? "text-slate-900" : "text-white"
                }`}
                style={{ fontFamily: fontFamilyCss }}
              >
                {t("Nos Packs & Cures")}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {packs.map((pk: any) => (
                <div
                  key={pk.id}
                  className={`relative overflow-hidden rounded-3xl border p-6 shadow-xl ${
                    isLight
                      ? "border-slate-200 bg-white"
                      : "border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02]"
                  }`}
                >
                  {/* Badge VIP aux couleurs de l'accent */}
                  <span
                    className={`absolute top-4 end-4 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      isLight
                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                        : "border"
                    }`}
                    style={{
                      backgroundColor: isLight
                        ? undefined
                        : `${theme.accentColor || theme.primaryColor}20`,
                      borderColor: isLight
                        ? undefined
                        : `${theme.accentColor || theme.primaryColor}40`,
                      color: isLight ? undefined : theme.accentColor || theme.primaryColor,
                    }}
                  >
                    {t("PACK VIP")}
                  </span>

                  <h3
                    className={`font-display text-lg font-bold ${
                      isLight ? "text-slate-900" : "text-white"
                    }`}
                    style={{ fontFamily: fontFamilyCss }}
                  >
                    {pk.name}
                  </h3>
                  <p
                    className={`mt-2 font-display text-2xl font-bold ${
                      isLight ? "text-amber-900" : ""
                    }`}
                    style={{
                      fontFamily: fontFamilyCss,
                      color: isLight ? "#92400e" : theme.accentColor || theme.primaryColor,
                    }}
                  >
                    {pk.priceTnd} TND
                  </p>

                  {pk.description && (
                    <p
                      className={`mt-2 text-xs leading-relaxed ${
                        isLight ? "text-slate-600" : "text-white/70"
                      }`}
                    >
                      {pk.description}
                    </p>
                  )}

                  <div className="mt-6">
                    <Link
                      href={`/reserver/${salon.slug}?packId=${pk.id}`}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
                      style={{ backgroundColor: theme.primaryColor }}
                    >
                      <span>{t("Choisir ce pack")}</span>
                      <ArrowRightIcon width={12} height={12} className="rtl:-scale-x-100" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 4 : Galerie de réalisations (F1.5) */}
        {features.gallery && realizations && realizations.length > 0 && (
          <section className="space-y-6">
            <div>
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  isLight ? "text-amber-900" : "text-rose-gold"
                }`}
              >
                {t("Portfolio & Galerie")}
              </span>
              <h2
                className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${
                  isLight ? "text-slate-900" : "text-white"
                }`}
                style={{ fontFamily: fontFamilyCss }}
              >
                {t("Nos Réalisations")}
              </h2>
            </div>

            <GallerySection realizations={realizations} isLight={isLight} />
          </section>
        )}

        {/* Section 5 : Avis clientes vérifiés (F1.5) */}
        {features.reviews && (
          <section className="space-y-6">
            <div>
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  isLight ? "text-amber-900" : "text-rose-gold"
                }`}
              >
                {t("Témoignages")}
              </span>
              <h2
                className={`mt-1 font-display text-2xl font-bold sm:text-3xl ${
                  isLight ? "text-slate-900" : "text-white"
                }`}
                style={{ fontFamily: fontFamilyCss }}
              >
                {t("Avis de nos Clientes")}
              </h2>
            </div>

            <ReviewsSection
              reviews={reviews}
              stats={reviewStats}
              organizationId={salon.id}
              slug={salon.slug}
              centers={centers}
              isLight={isLight}
            />
          </section>
        )}
      </main>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* PIED DE PAGE VITRINE                                        */}
      {/* ─────────────────────────────────────────────────────────── */}
      <footer
        className={`border-t py-10 transition-colors ${
          isLight ? "border-slate-200 bg-slate-100/80 text-slate-900" : "border-white/10 bg-plum-950/60 text-white"
        }`}
      >
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-center sm:flex-row sm:text-start sm:px-6">
          <div>
            <p
              className={`font-display text-lg font-bold ${
                isLight ? "text-slate-900" : "text-white"
              }`}
              style={{ fontFamily: fontFamilyCss }}
            >
              {salon.name}
            </p>
            <p className={`mt-1 text-xs ${isLight ? "text-slate-500" : "text-white/50"}`}>
              {t("Propulsé par Salonia · La plateforme tout-en-un des salons de beauté en Tunisie")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={`rounded-xl border px-3 py-2 text-xs transition ${
                isLight
                  ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-xs"
                  : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              }`}
            >
              {t("QR Code du salon")}
            </button>
            <Link
              href={`/reserver/${salon.slug}`}
              className="rounded-xl px-4 py-2 text-xs font-bold text-plum-950 shadow-md transition hover:brightness-105"
              style={{ backgroundColor: theme.primaryColor }}
            >
              {t("Réserver un soin")}
            </Link>
          </div>
        </div>
      </footer>

      {/* Modale de partage avec QR Code certifié et scannable */}
      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={`${t("Partager la vitrine")} : ${salon.name}`}
        url={publicUrl}
        salonSlug={salon.slug}
        salonName={salon.name}
      />
    </div>
  );
}
