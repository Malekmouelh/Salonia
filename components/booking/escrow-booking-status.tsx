"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmMyEscrowCancel } from "@/app/actions/client";
import type { EscrowWebConfig } from "@/app/actions/wallet";
import { useI18n } from "@/components/i18n/i18n-provider";
import type { EscrowStatus } from "@/lib/enums";
import { cancellationOutcome } from "@/lib/escrow/rules";
import { cancelWithMetaMask, metaMaskMessage } from "@/lib/wallet/browser";

// SalonEscrow (Module 3) : acompte d'un rendez-vous dans l'espace client — statut lu sur la blockchain
// et annulation signée par MetaMask, avec l'issue annoncée AVANT de confirmer (règle des 24 heures).
// Le serveur relit ensuite la transaction sur la chaîne avant de mettre la base à jour.

export type EscrowInfo = {
  depositTnd: string;
  chainBookingId: number;
  clientAddress: string;
  status: EscrowStatus;
  fromChain: boolean;
  refunded: boolean | null;
};

function statusLabel(e: EscrowInfo) {
  if (e.status === "CONFIRMED") return { text: "Acompte bloqué", tone: "text-champagne" };
  if (e.status === "CANCELLED" && e.refunded) return { text: "Acompte remboursé", tone: "text-emerald-300" };
  if (e.status === "NONE") return { text: "Acompte introuvable sur la blockchain", tone: "text-amber-200" };
  return { text: "Acompte versé au salon", tone: "text-white/60" };
}

export function EscrowBookingStatus({
  bookingId,
  start,
  escrow,
  cfg,
}: {
  bookingId: string;
  start: string;
  escrow: EscrowInfo;
  cfg: EscrowWebConfig | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const label = statusLabel(escrow);
  const outcome = cancellationOutcome(new Date(start));
  const cancellable = cfg !== null && escrow.status === "CONFIRMED" && outcome !== "STARTED";

  const cancel = () =>
    startTransition(async () => {
      setMessage(null);
      let txHash: string;
      try {
        txHash = await cancelWithMetaMask(cfg!, { chainBookingId: escrow.chainBookingId, clientAddress: escrow.clientAddress });
      } catch (e) {
        setMessage({ tone: "error", text: t(metaMaskMessage(e)) });
        return;
      }
      const r = await confirmMyEscrowCancel({ bookingId, txHash });
      if (r.ok) {
        setConfirming(false);
        setMessage({
          tone: "ok",
          text: r.refunded
            ? `${t("Rendez-vous annulé : votre acompte est remboursé")} (${r.depositTnd} TND).`
            : `${t("Rendez-vous annulé : l'acompte est versé au salon")} (${r.depositTnd} TND).`,
        });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: t(r.error) });
      }
    });

  return (
    <div className="basis-full ps-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={label.tone}>
          🔒 {t(label.text)} · <bdi>{escrow.depositTnd}</bdi> TND
        </span>
        <span className="text-white/35">
          {escrow.fromChain ? t("lu sur la blockchain") : t("blockchain injoignable : dernier état connu")}
        </span>
        {cancellable && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="ms-auto rounded-lg border border-white/15 px-3 py-1 text-white/80 transition hover:border-red-300/60 hover:text-white">
            {t("Annuler")}
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3" role="alertdialog" aria-label={t("Annuler le rendez-vous")}>
          <p className={outcome === "REFUND" ? "text-emerald-200" : "text-amber-200"}>
            {outcome === "REFUND"
              ? t("Plus de 24 h avant le rendez-vous : votre acompte vous sera remboursé.")
              : t("Moins de 24 h avant le rendez-vous : l'acompte sera versé au salon.")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={cancel} className="rounded-lg bg-red-500/80 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
              {pending ? t("Validez dans MetaMask…") : t("Confirmer l'annulation")}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded-lg border border-white/15 px-3 py-1.5 text-white/80">
              {t("Garder mon rendez-vous")}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={`mt-2 ${message.tone === "ok" ? "text-emerald-300" : "text-red-300"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
