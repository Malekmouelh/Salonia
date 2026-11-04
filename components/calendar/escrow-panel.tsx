"use client";

import { useEffect, useState, useTransition } from "react";
import { getEscrowChainStatus, settleEscrowBooking, type ActionResult } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtTime } from "@/lib/booking/format";
import type { CalendarBooking } from "@/lib/booking/types";
import type { EscrowStatus } from "@/lib/enums";
import { staffActionTimes, staffActions } from "@/lib/escrow/rules";
import { ActionButton } from "./booking-drawer";

// SalonEscrow (Module 3) : fiche d'un rendez-vous avec acompte sécurisé, côté salon.
// Statut relu sur la blockchain ; boutons « Prestation réalisée » (dès le début) et « Client absent »
// (15 minutes après le début). Le salon ne peut ni déplacer ni annuler : seul le client annule.

const CHAIN_LABELS: Record<EscrowStatus, string> = {
  NONE: "Introuvable sur la blockchain",
  CONFIRMED: "Acompte bloqué",
  CANCELLED: "Annulé par le client",
  COMPLETED: "Prestation validée · acompte versé au salon",
  NO_SHOW: "Absence · acompte versé au salon",
};

export function EscrowPanel({ booking, onDone }: { booking: CalendarBooking; onDone: (r: ActionResult) => void }) {
  const { t, lang } = useI18n();
  const escrow = booking.escrow!;
  const [chainStatus, setChainStatus] = useState<EscrowStatus | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getEscrowChainStatus(booking.id).then((r) => active && setChainStatus(r.status));
    return () => {
      active = false;
    };
  }, [booking.id]);

  const status = chainStatus ?? escrow.status;
  const start = new Date(booking.start);
  const { canComplete, canNoShow } = staffActions(start);
  const { noShowFrom } = staffActionTimes(start);
  const open = status === "CONFIRMED" && booking.status === "CONFIRMED";

  const settle = (outcome: "COMPLETED" | "NO_SHOW") =>
    startTransition(async () => {
      setError(null);
      const r = await settleEscrowBooking(booking.id, outcome);
      if (r.ok) onDone(r);
      else setError(r.error ?? "Erreur");
    });

  return (
    <div className="rounded-2xl border border-champagne/30 bg-champagne/[0.07] p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        🔒 {t("Acompte sécurisé par la blockchain")} · <bdi>{escrow.depositTnd}</bdi> TND
      </p>
      <p className="mt-1 text-xs text-white/60">
        {chainStatus === undefined
          ? t("Lecture de la blockchain…")
          : `${t(CHAIN_LABELS[status])} · ${chainStatus === null ? t("blockchain injoignable : dernier état connu") : t("lu sur la blockchain")}`}
      </p>

      {open && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ActionButton tone="ok" disabled={pending || !canComplete} onClick={() => settle("COMPLETED")}>
              {t("Prestation réalisée")}
            </ActionButton>
            <ActionButton tone="danger" disabled={pending || !canNoShow} onClick={() => settle("NO_SHOW")}>
              {t("Client absent")}
            </ActionButton>
          </div>
          {pending && <p role="status" className="mt-2 text-xs text-white/50">{t("Transaction en cours sur la blockchain… cela peut prendre quelques secondes.")}</p>}
          {!canComplete && (
            <p className="mt-2 text-xs text-white/50">
              {t("Validation possible à partir de")} <bdi dir="ltr">{fmtTime(booking.start, lang)}</bdi>, {t("absence à partir de")}{" "}
              <bdi dir="ltr">{fmtTime(noShowFrom.toISOString(), lang)}</bdi>.
            </p>
          )}
          {canComplete && !canNoShow && (
            <p className="mt-2 text-xs text-white/50">
              {t("Absence possible à partir de")} <bdi dir="ltr">{fmtTime(noShowFrom.toISOString(), lang)}</bdi>.
            </p>
          )}
          <p className="mt-2 text-[11px] text-white/40">{t("Le salon ne peut ni déplacer ni annuler ce rendez-vous : seul le client peut l'annuler.")}</p>
        </>
      )}
      {error && <p className="mt-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{t(error)}</p>}
    </div>
  );
}
