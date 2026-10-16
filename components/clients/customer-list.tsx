"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtDay, fmtMoney } from "@/lib/booking/format";

type Row = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  visits: number;
  noShows: number;
  lastVisit: string | null;
  spentTnd: number;
};

export function CustomerList({ initialQuery, customers }: { initialQuery: string; customers: Row[] }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (query === initialQuery) return;
    const id = setTimeout(() => startTransition(() => router.replace(`/dashboard/clients${query ? `?q=${encodeURIComponent(query)}` : ""}`)), 300);
    return () => clearTimeout(id);
  }, [query, initialQuery, router]);

  return (
    <div className="mt-6 space-y-4">
      <div className="relative max-w-md animate-fade-up [animation-delay:0.05s]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Rechercher un client (nom, téléphone, e-mail)…")}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3.5 text-white outline-none transition placeholder:text-white/35 focus:border-rose-gold/60"
        />
        {pending && <span className="absolute end-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
      </div>

      {customers.length === 0 ? (
        <p className="glass rounded-[2rem] p-10 text-center text-white/50">{t("Aucun client trouvé.")}</p>
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => {
            const reliability = c.visits + c.noShows ? Math.round((c.visits / (c.visits + c.noShows)) * 100) : null;
            return (
              <Link
                key={c.id}
                href={`/dashboard/clients/${c.id}`}
                className="glass group rounded-3xl p-5 transition duration-300 hover:-translate-y-1 hover:border-rose-gold/30"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blush/80 to-champagne/80 text-sm font-semibold text-plum-950">
                    {c.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{c.name}</p>
                    <p className="text-xs text-white/45" dir="ltr">+216 {c.phone}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label={t("Visites")} value={String(c.visits)} />
                  <Stat label={t("Dépensé")} value={fmtMoney(c.spentTnd, lang)} />
                  <Stat
                    label={t("Fiabilité")}
                    value={reliability === null ? "—" : `${reliability} %`}
                    tone={reliability === null ? undefined : reliability >= 90 ? "good" : reliability >= 75 ? "mid" : "bad"}
                  />
                </div>
                <p className="mt-3 text-xs text-white/40">
                  {c.lastVisit ? `${t("Dernière visite")} : ${fmtDay(c.lastVisit, lang, { day: "numeric", month: "short", year: "numeric" })}` : t("Pas encore venu(e)")}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "mid" | "bad" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "mid" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-white";
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2 py-2">
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}
