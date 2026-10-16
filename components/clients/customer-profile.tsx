"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { updateCustomer } from "@/app/actions/bookings";
import { STATUS_META } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { Toast } from "@/components/ui/modal";
import { fmtDay, fmtMoney, fmtTime } from "@/lib/booking/format";
import { whatsappLink } from "@/lib/booking/messages";
import type { CustomerProfile } from "@/lib/data/customers";

export function CustomerProfileView({
  profile: p,
  salonName,
}: {
  profile: CustomerProfile;
  salonName: string;
}) {
  const { t, lang } = useI18n();
  const [notes, setNotes] = useState(p.notes);
  const [consent, setConsent] = useState(p.remindersConsent);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const now = new Date().toISOString();
  const upcoming = p.history
    .filter((h) => h.start > now && h.status !== "CANCELLED")
    .reverse();
  const past = p.history.filter(
    (h) => h.start <= now || h.status === "CANCELLED",
  );

  const relaunch = whatsappLink(
    p.phone,
    `Bonjour ${p.firstName} ✨ Cela fait un moment ! Chez ${salonName}, nous serions ravis de vous revoir. Réservez en ligne ou répondez à ce message.`,
  );

  return (
    <div className="mt-6 space-y-5">
      <Link
        href="/dashboard/clients"
        className="group inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"
      >
        <ArrowLeftIcon
          width={16}
          height={16}
          className="transition-transform rtl:-scale-x-100 group-hover:-translate-x-1 rtl:group-hover:translate-x-1"
        />
        {t("Tous les clients")}
      </Link>

      <section className="stagger grid gap-5 lg:grid-cols-3">
        <div className="glass glow-border rounded-[2rem] p-7 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-blush to-champagne font-display text-2xl text-plum-950">
              {p.firstName[0]}
              {p.lastName[0]}
            </span>
            <div>
              <h1 className="font-display text-4xl text-white">
                {p.firstName}{" "}
                <span className="text-gradient italic">{p.lastName}</span>
              </h1>
              <p className="text-sm text-white/55" dir="ltr">
                +216 {p.phone}
                {p.email && ` · ${p.email}`}
              </p>
            </div>
            <a
              href={relaunch}
              target="_blank"
              rel="noreferrer"
              className="ms-auto rounded-2xl bg-[#25d366]/15 px-4 py-2.5 text-sm text-[#7ef0a8] hover:bg-[#25d366]/25"
            >
              {t("Relancer sur WhatsApp")}
            </a>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={t("Visites")} value={String(p.stats.visits)} />
            <Kpi
              label={t("Dépensé")}
              value={fmtMoney(p.stats.spentTnd, lang)}
            />
            <Kpi
              label={t("Panier moyen")}
              value={fmtMoney(p.stats.avgBasketTnd, lang)}
            />
            <Kpi
              label={t("Fiabilité")}
              value={
                p.stats.reliability === null ? "—" : `${p.stats.reliability} %`
              }
              hint={`${p.stats.noShows} ${t("absence(s)")} · ${p.stats.cancellations} ${t("annulation(s)")}`}
            />
          </div>
        </div>

        <div className="glass rounded-[2rem] p-6">
          <p className="text-xs uppercase tracking-wider text-white/40">
            {t("Habitudes")}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-white/80">
            {p.favoriteServices.map((s) => (
              <li key={s.name} className="flex justify-between">
                <span>{s.name}</span>
                <span className="text-white/40">×{s.count}</span>
              </li>
            ))}
            {p.favoriteStaff && (
              <li className="pt-2 text-white/60">
                {t("Praticien préféré")} :{" "}
                <span className="text-white">{p.favoriteStaff}</span>
              </li>
            )}
            {p.stats.avgIntervalDays && (
              <li className="text-white/60">
                {t("Revient en moyenne tous les")}{" "}
                <span className="text-white">
                  {p.stats.avgIntervalDays} {t("jours")}
                </span>
              </li>
            )}
          </ul>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-xs uppercase tracking-wider text-white/40">
              {t("Notes (allergies, préférences…)")}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm text-white outline-none focus:border-rose-gold/60"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-white/60">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="accent-rose-gold"
            />
            {t("Accepte les rappels par message")}
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await updateCustomer({
                  customerId: p.id,
                  notes,
                  remindersConsent: consent,
                });
                setToast(r.message ?? r.error ?? null);
              })
            }
            className="btn-shine mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-plum-950 disabled:opacity-60"
          >
            {t("Enregistrer")}
          </button>
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="glass rounded-[2rem] p-6 animate-fade-up">
          <h2 className="mb-3 font-display text-2xl text-white">
            {t("À venir")}
          </h2>
          <Timeline items={upcoming} />
        </section>
      )}

      <section className="glass rounded-[2rem] p-6 animate-fade-up">
        <h2 className="mb-3 font-display text-2xl text-white">
          {t("Historique des prestations")}
        </h2>
        {past.length ? (
          <Timeline items={past} />
        ) : (
          <p className="text-sm text-white/50">
            {t("Aucune prestation pour le moment.")}
          </p>
        )}
      </section>

      {toast && (
        <Toast tone="success" onDone={() => setToast(null)}>
          {t(toast)}
        </Toast>
      )}
    </div>
  );
}

function Timeline({ items }: { items: CustomerProfile["history"] }) {
  const { t, lang } = useI18n();
  return (
    <ol className="relative space-y-2 ps-5">
      <span
        aria-hidden
        className="absolute bottom-2 start-[7px] top-2 w-px bg-white/10"
      />
      {items.map((h) => (
        <li
          key={h.id}
          className="relative flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-3 py-2 hover:bg-white/[0.03]"
        >
          <span
            className={`absolute -start-[17px] top-4 h-2.5 w-2.5 rounded-full ${h.status === "NO_SHOW" ? "bg-red-400" : h.status === "CANCELLED" ? "bg-white/30" : "bg-champagne"}`}
          />
          <span className="w-40 text-sm capitalize text-white">
            {fmtDay(h.start, lang, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}{" "}
            · <span dir="ltr">{fmtTime(h.start, lang)}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-white/70">
            {h.packName ?? h.services.join(", ")}
          </span>
          <span className="text-xs text-white/40">
            {h.staff} · {h.center}
          </span>
          <span className="text-sm text-white">
            {fmtMoney(h.totalTnd, lang)}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] ${STATUS_META[h.status].chip}`}
          >
            {t(STATUS_META[h.status].label)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-4">
      <p className="text-[11px] uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl text-white">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-white/40">{hint}</p>}
    </div>
  );
}
