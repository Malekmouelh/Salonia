"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowRightIcon, PinIcon, SearchIcon, SparkleIcon, StoreIcon } from "@/components/ui/icons";
import { fmtMoney } from "@/lib/booking/format";
import { GOVERNORATES, governorateLabel } from "@/lib/definitions";
import type { SalonCard } from "@/lib/data/salons";

// Recherche sans accents ni majuscules (« coiffure » trouve « Coiffure »).
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Annuaire des salons : recherche par nom, prestation ou ville, filtre par gouvernorat.
export function SalonDirectory({ salons, limit }: { salons: SalonCard[]; limit?: number }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [governorate, setGovernorate] = useState("");

  const present = useMemo(() => new Set(salons.flatMap((s) => s.centers.map((c) => c.governorate))), [salons]);
  const results = useMemo(() => {
    const q = norm(query.trim());
    return salons.filter((s) => {
      if (governorate && !s.centers.some((c) => c.governorate === governorate)) return false;
      if (!q) return true;
      const haystack = [s.name, ...s.categories, ...s.centers.flatMap((c) => [c.name, c.address ?? "", governorateLabel(c.governorate)])].join(" ");
      return norm(haystack).includes(q);
    });
  }, [salons, query, governorate]);
  const shown = limit ? results.slice(0, limit) : results;

  return (
    <div>
      {!limit && (
        <div className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="relative block">
            <SearchIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Nom du salon, prestation, ville…")}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3.5 pe-4 ps-12 text-white outline-none transition placeholder:text-white/35 focus:border-rose-gold/60"
            />
          </label>
          <select
            value={governorate}
            onChange={(e) => setGovernorate(e.target.value)}
            aria-label={t("Gouvernorat")}
            className="rounded-2xl border border-white/10 bg-plum-950 px-4 py-3.5 text-white outline-none focus:border-rose-gold/60"
          >
            <option value="">{t("Tous les gouvernorats")}</option>
            {GOVERNORATES.filter((g) => present.has(g.value)).map((g) => (
              <option key={g.value} value={g.value}>{t(g.label)}</option>
            ))}
          </select>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="glass rounded-[2rem] p-8 text-center text-white/55">{t("Aucun salon ne correspond à votre recherche.")}</p>
      ) : (
        <ul className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <li key={s.slug} className="glass group flex flex-col overflow-hidden rounded-[2rem] transition duration-300 hover:-translate-y-1 hover:border-rose-gold/40">
              <div className="relative h-36 overflow-hidden bg-gradient-to-br from-blush/30 via-plum-800 to-champagne/20">
                {s.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- photo stockée en data URL (Module 2)
                  <img src={s.photo} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                ) : (
                  <StoreIcon className="absolute start-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white/25 rtl:translate-x-1/2" />
                )}
                {s.priceFrom !== null && (
                  <span className="absolute end-3 top-3 rounded-full bg-plum-950/80 px-3 py-1 text-xs text-white backdrop-blur">
                    {t("dès")} {fmtMoney(s.priceFrom, lang)}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="font-display text-xl text-white">{s.name}</h3>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-white/55">
                  <PinIcon width={15} height={15} className="mt-0.5 shrink-0" />
                  <span>{[...new Set(s.centers.map((c) => t(governorateLabel(c.governorate))))].join(" · ")}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.categories.slice(0, 4).map((c) => (
                    <span key={c} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-white/70">{t(c)}</span>
                  ))}
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-white/45">
                  <SparkleIcon width={13} height={13} />
                  {s.servicesCount} {t("prestations")}
                  {s.packsCount > 0 && ` · ${s.packsCount} ${t("packs")}`}
                  {` · ${s.centers.length} ${t(s.centers.length > 1 ? "centres" : "centre")}`}
                </p>
                <Link
                  href={`/reserver/${s.slug}`}
                  className="btn-shine mt-5 flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-plum-950"
                >
                  {t("Voir et réserver")} <ArrowRightIcon width={16} height={16} className="rtl:-scale-x-100" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
