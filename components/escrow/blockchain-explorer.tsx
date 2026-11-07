"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { ChainEvent, ChainTx } from "@/lib/escrow/explorer-core";
import type { ExplorerData } from "@/lib/escrow/explorer";

// Explorateur de blocs SalonEscrow : toutes les transactions de la blockchain, du plus récent au plus ancien.
// Les noms (clients, staff, trésoreries) viennent de Salonia ; la chaîne, elle, ne connaît que des adresses.

type Filter = "all" | "bookings" | "token" | "gas";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const tnd = (units: string) => `${Number(units) / 1e6} TND`;

const ROLE_TONE: Record<string, string> = {
  contract: "text-champagne",
  token: "text-amber-200",
  admin: "text-sky-200",
  client: "text-emerald-200",
  staff: "text-violet-200",
  treasury: "text-rose-gold",
};

export function BlockchainExplorer({ data }: { data: ExplorerData }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [live, setLive] = useState(false);
  // Vue brute : uniquement ce que contient la blockchain (adresses), sans les noms ajoutés par Salonia.
  const [raw, setRaw] = useState(false);
  const [pending, startTransition] = useTransition();

  // Actualisation automatique (toutes les 5 s) pendant une démonstration.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => startTransition(() => router.refresh()), 5000);
    return () => clearInterval(id);
  }, [live, router]);

  const name = (address: string | null) => {
    if (!address) return "—";
    const label = raw ? undefined : data.labels[address.toLowerCase()];
    return label ? (
      <span className={ROLE_TONE[label.role]} title={address}>
        {t(label.name.split(" · ")[0])}
        {label.name.includes(" · ") ? ` · ${label.name.split(" · ").slice(1).join(" · ")}` : ""}
      </span>
    ) : (
      <span className="font-mono text-white/70" title={address} dir="ltr">
        {raw ? address : short(address)}
      </span>
    );
  };

  const isBooking = (tx: ChainTx) => tx.target === "BookingEscrow" && tx.fn !== null && !tx.fn.startsWith("set");
  const shown = useMemo(
    () =>
      data.txs.filter((tx) =>
        filter === "all" ? true : filter === "bookings" ? isBooking(tx) : filter === "token" ? tx.target === "MockTND" : tx.kind === "transfer",
      ),
    [data.txs, filter],
  );
  const bookingsCreated = data.txs.reduce((n, tx) => n + tx.events.filter((e) => e.kind === "created").length, 0);

  const eventText = (e: ChainEvent) => {
    switch (e.kind) {
      case "created":
        return <>{t("Réservation")} n°{e.bookingId} {t("créée par")} {name(e.client)} — {t("acompte")} {tnd(e.depositUnits)}</>;
      case "cancelled":
        return <>{t("Réservation")} n°{e.bookingId} {t("annulée")} → <strong>{t(e.refunded ? "remboursée au client" : "acompte versé au salon")}</strong></>;
      case "completed":
        return <>{t("Réservation")} n°{e.bookingId} : {t("prestation réalisée")}</>;
      case "noShow":
        return <>{t("Réservation")} n°{e.bookingId} : {t("client absent")}</>;
      case "locked":
        return <>{tnd(e.amountUnits)} {t("bloqués dans le contrat")}</>;
      case "credited":
        return <>{tnd(e.amountUnits)} {t("crédités à")} {name(e.beneficiary)}</>;
      case "withdrawn":
        return <>{name(e.beneficiary)} {t("retire")} {tnd(e.amountUnits)}</>;
    }
  };

  const action = (tx: ChainTx) => {
    if (tx.kind === "deploy") return <>{t("Déploiement de contrat")} → {name(tx.created)}</>;
    if (tx.kind === "transfer") return <>{t("Envoi de")} {Number(tx.valueEth)} {t("ETH de test (gaz)")} → {name(tx.to)}</>;
    if (tx.fn) {
      return (
        <>
          <span className="font-mono text-champagne" dir="ltr">
            {tx.target}.{tx.fn}
          </span>
          {tx.args.length > 0 && <span className="text-white/60"> ({tx.args.map((a) => (a.startsWith("0x") ? short(a) : a)).join(", ")})</span>}
        </>
      );
    }
    return <>{t("Appel à")} {name(tx.to)}</>;
  };

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "Toutes" },
    { id: "bookings", label: "Réservations" },
    { id: "token", label: "Jeton MockTND" },
    { id: "gas", label: "ETH de test" },
  ];

  return (
    <section className="mt-6 space-y-5 animate-fade-up">
      <div className="glass rounded-[2rem] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-white">{t("Explorateur blockchain")}</h1>
            <p className="mt-1 text-sm text-white/55">
              {t("Lu directement dans les blocs de la blockchain, tous comptes confondus.")}{" "}
              {data.network === "hardhat" ? t("Blockchain locale de démonstration") : "Sepolia (testnet)"} ·{" "}
              {t("blocs")} <bdi dir="ltr">#{data.firstBlock}–#{data.latestBlock}</bdi>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRaw((v) => !v)}
              className={`rounded-xl border px-4 py-2 text-sm transition ${raw ? "border-champagne/50 bg-champagne/10 text-champagne" : "border-white/15 text-white/80 hover:border-white/30"}`}
            >
              {raw ? t("Afficher les noms Salonia") : t("Adresses brutes")}
            </button>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={`rounded-xl border px-4 py-2 text-sm transition ${live ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-white/15 text-white/80 hover:border-white/30"}`}
            >
              {live ? `● ${t("En direct")}` : t("Actualisation auto")}
            </button>
            <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="btn-shine rounded-xl px-4 py-2 text-sm font-semibold text-plum-950 disabled:opacity-60">
              {pending ? t("Lecture…") : t("Actualiser")}
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Transactions", value: data.txs.length },
            { label: "Réservations créées", value: bookingsCreated },
            { label: "Dernier bloc", value: `#${data.latestBlock}` },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs text-white/50">{t(s.label)}</p>
              <p className="mt-1 font-display text-2xl text-white">
                <bdi>{s.value}</bdi>
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 break-all text-xs text-white/45">
          {t("Contrat")} <span className="font-mono" dir="ltr">{data.contract}</span> · MockTND <span className="font-mono" dir="ltr">{data.token}</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-xl px-4 py-2 text-sm transition ${filter === f.id ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950" : "border border-white/10 text-white/70 hover:text-white"}`}
          >
            {t(f.label)}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="glass rounded-[2rem] p-8 text-center text-white/55">{t("Aucune transaction pour ce filtre.")}</p>
      ) : (
        <ol className="space-y-3">
          {shown.map((tx) => (
            <li key={tx.hash} className="glass min-w-0 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-white/80" dir="ltr">
                  #{tx.block}
                </span>
                <bdi dir="ltr">{new Date(tx.time).toLocaleString(lang === "ar" ? "ar-TN" : "fr-FR", { timeZone: "Africa/Tunis" })}</bdi>
                <span className={tx.ok ? "text-emerald-300" : "text-red-300"}>{tx.ok ? `✓ ${t("réussie")}` : `✗ ${t("échouée")}`}</span>
                {!raw && (
                  <span className="ms-auto font-mono" dir="ltr" title={tx.hash}>
                    {short(tx.hash)}
                  </span>
                )}
              </div>
              {raw && (
                <p className="mt-1 break-all font-mono text-[11px] text-white/45" dir="ltr">
                  tx {tx.hash}
                </p>
              )}
              <p className="mt-2 text-sm text-white">{action(tx)}</p>
              <p className="mt-1 break-all text-xs text-white/55">
                {t("De")} {name(tx.from)} · {t("gaz")} <bdi dir="ltr">{Number(tx.gasUsed).toLocaleString("fr-FR")}</bdi>
              </p>
              {tx.events.length > 0 && (
                <ul className="mt-2 space-y-1 border-s border-champagne/30 ps-3 text-xs text-white/75">
                  {tx.events.map((e, i) => (
                    <li key={i}>↳ {eventText(e)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
