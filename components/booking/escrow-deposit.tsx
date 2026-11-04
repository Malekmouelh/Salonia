"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { CheckIcon } from "@/components/ui/icons";
import type { EscrowOffer, EscrowSummary } from "@/lib/escrow/service";

// SalonEscrow (Module 3) : acompte bloqué sur la blockchain, en jeton de test MockTND.
// Le client n'a ni wallet ni crypto à gérer : le serveur Salonia signe pour lui.

// Avant confirmation : montant fixé par le salon, règle d'annulation et état du créneau sur la chaîne.
export function EscrowDepositNotice({ offer, slotFree }: { offer: EscrowOffer; slotFree: boolean | null | undefined }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-2xl border border-champagne/30 bg-champagne/[0.07] p-5">
      <p className="flex items-center gap-2 font-medium text-white">
        <span aria-hidden>🔒</span> {t("Acompte sécurisé par la blockchain")}
      </p>
      {offer.depositTnd ? (
        <p className="mt-2 text-sm text-white/75">
          {t("Acompte fixé par le salon")} : <strong className="text-white"><bdi>{offer.depositTnd}</bdi> TND</strong>{" "}
          <span className="text-white/50">({t("jeton de test MockTND, sans valeur réelle")})</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-amber-200">{t("Montant de l'acompte indisponible pour le moment. Réessayez dans un instant.")}</p>
      )}
      <ul className="mt-3 space-y-1.5 text-sm text-white/65">
        <li>✓ {t("Annulation 24 h ou plus avant le rendez-vous : acompte remboursé.")}</li>
        <li>• {t("Annulation moins de 24 h avant, ou absence : acompte versé au salon.")}</li>
        <li>• {t("Prestation réalisée : acompte versé au salon.")}</li>
      </ul>
      {slotFree === true && <p className="mt-3 text-xs text-emerald-300">✓ {t("Créneau libre sur la blockchain.")}</p>}
      {slotFree === false && <p className="mt-3 text-xs text-red-300">{t("Ce créneau est déjà réservé sur la blockchain. Choisissez-en un autre.")}</p>}
    </div>
  );
}

// Après confirmation : preuve de la transaction (numéro de réservation sur la chaîne et hash).
export function EscrowReceipt({ escrow }: { escrow: EscrowSummary }) {
  const { t } = useI18n();
  const shortHash = `${escrow.txHash.slice(0, 10)}…${escrow.txHash.slice(-8)}`;
  const explorer = escrow.network === "sepolia" ? `https://sepolia.etherscan.io/tx/${escrow.txHash}` : null;
  return (
    <div className="glass mt-5 rounded-[2rem] p-6 text-start animate-fade-up [animation-delay:0.22s]">
      <p className="flex items-center gap-2 font-medium text-white">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400/20 text-emerald-200">
          <CheckIcon width={14} height={14} />
        </span>
        {t("Acompte bloqué sur la blockchain")} · <bdi>{escrow.depositTnd}</bdi> TND
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-white/50">{t("Réservation n°")}</dt>
        <dd className="text-white" dir="ltr">{escrow.chainBookingId}</dd>
        <dt className="text-white/50">{t("Transaction")}</dt>
        <dd className="truncate font-mono text-xs text-white/80" dir="ltr">
          {explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
              {shortHash}
            </a>
          ) : (
            shortHash
          )}
        </dd>
        <dt className="text-white/50">{t("Réseau")}</dt>
        <dd className="text-white/80">{escrow.network === "sepolia" ? "Sepolia (testnet)" : t("Blockchain locale de démonstration")}</dd>
      </dl>
      <p className="mt-3 text-xs text-white/45">{t("Annulez 24 h ou plus avant pour être remboursé. Le reste de la prestation se règle au salon.")}</p>
    </div>
  );
}
