import { BaseError, ContractFunctionRevertedError, HttpRequestError, TimeoutError } from "viem";

// SalonEscrow : erreurs montrées à l'utilisateur. Les erreurs personnalisées du contrat (custom errors)
// sont traduites en phrases claires ; aucun détail technique (adresse, hash, pile) n'est renvoyé au navigateur.

export class EscrowError extends Error {}

const MESSAGES: Record<string, string> = {
  // SlotBooking (Membre 1)
  InvalidStartTime: "L'heure doit être dans le futur et alignée sur 30 minutes.",
  SlotAlreadyBooked: "Ce créneau est déjà réservé.",
  BookingNotFound: "Réservation introuvable sur la blockchain.",
  NotBookingClient: "Seul le client qui a réservé peut annuler.",
  InvalidStatus: "Cette réservation est déjà réglée.",
  BookingAlreadyStarted: "Le rendez-vous a commencé : l'annulation n'est plus possible.",
  TooEarly: "Trop tôt : validation possible dès l'heure du rendez-vous, absence 15 minutes après.",
  // CenterAccess (commun)
  NotCenterStaff: "Seul le staff de ce centre peut faire cette action.",
  NotCenterManager: "Seul le gérant de ce centre peut faire cette action.",
  ZeroAddress: "Adresse de wallet invalide.",
  // DepositVault et MockTND (Membre 2)
  CenterNotConfigured: "Ce salon n'a pas encore configuré son acompte.",
  NothingToWithdraw: "Aucun solde à retirer.",
  ERC20InsufficientBalance: "Solde de jetons insuffisant pour l'acompte.",
  ERC20InsufficientAllowance: "Autorisation de paiement de l'acompte insuffisante.",
  FaucetAmountTooHigh: "Montant de jetons de test trop élevé.",
};

// Un rendez-vous avec acompte sécurisé ne change que par la chaîne : les chemins habituels de Salonia le refusent.
export const ESCROW_CLIENT_ONLY =
  "Cette réservation a un acompte sécurisé : annulez-la depuis votre espace client. Elle ne peut pas être déplacée.";
export const ESCROW_SALON_LOCKED =
  "Rendez-vous avec acompte sécurisé : le salon ne peut ni le déplacer ni l'annuler, et son statut se règle par la blockchain.";

export const UNKNOWN_CHAIN_ERROR = "La transaction a échoué sur la blockchain. Réessayez.";
export const NETWORK_ERROR = "Le réseau blockchain ne répond pas. Réessayez dans un instant.";

export const messageForContractError = (errorName: string | undefined) => (errorName && MESSAGES[errorName]) || UNKNOWN_CHAIN_ERROR;

// Convertit n'importe quelle erreur (viem, réseau, EscrowError) en EscrowError au message lisible.
export function toEscrowError(error: unknown): EscrowError {
  if (error instanceof EscrowError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return new EscrowError(messageForContractError(reverted.data?.errorName));
    if (error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) return new EscrowError(NETWORK_ERROR);
  }
  return new EscrowError(UNKNOWN_CHAIN_ERROR);
}
