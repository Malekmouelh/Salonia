// SalonEscrow (Module 3, Membre 1) : règles du contrat recopiées côté serveur, sans dépendance blockchain.
// Elles servent à AFFICHER à l'avance ce que fera le contrat (remboursement ou crédit au salon) et à refuser
// une demande vouée à l'échec avant d'envoyer une transaction. Le contrat reste l'autorité :
// mêmes valeurs que SlotBooking.sol et DepositVault.sol (SLOT_DURATION, NO_SHOW_DELAY, REFUND_WINDOW).
import { ESCROW_STATUSES, type EscrowStatus } from "@/lib/enums";

export const SLOT_MINUTES = 30;
export const NO_SHOW_DELAY_MINUTES = 15;
export const REFUND_WINDOW_HOURS = 24;
export const TOKEN_DECIMALS = 6;
export const MAX_UINT32 = 4_294_967_295;

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

// Horodatage Unix en secondes, comme block.timestamp.
export const toChainTime = (date: Date) => Math.floor(date.getTime() / 1000);

// Heure de début acceptée par createBooking : alignée sur 30 minutes (Tunis = UTC+1 : même alignement qu'en UTC).
export function isEscrowSlot(start: Date) {
  return start.getTime() % 1000 === 0 && toChainTime(start) % (SLOT_MINUTES * MINUTE_S) === 0;
}

export type CancellationOutcome = "REFUND" | "SALON" | "STARTED";

// Ce que fera cancelBooking : remboursé s'il reste AU MOINS 24 h (24 h pile incluse), sinon acompte au salon ;
// refusé à partir de l'heure de début.
export function cancellationOutcome(start: Date, now: Date = new Date()): CancellationOutcome {
  const startS = toChainTime(start);
  const nowS = toChainTime(now);
  if (nowS >= startS) return "STARTED";
  return nowS + REFUND_WINDOW_HOURS * HOUR_S <= startS ? "REFUND" : "SALON";
}

// Moments à partir desquels le staff peut valider (début) ou marquer l'absence (début + 15 min).
export function staffActionTimes(start: Date) {
  return { completedFrom: start, noShowFrom: new Date(start.getTime() + NO_SHOW_DELAY_MINUTES * MINUTE_S * 1000) };
}

export function staffActions(start: Date, now: Date = new Date()) {
  const { completedFrom, noShowFrom } = staffActionTimes(start);
  return { canComplete: now >= completedFrom, canNoShow: now >= noShowFrom };
}

// Statut renvoyé par getBooking (0 à 4) → statut Salonia de l'acompte.
export function escrowStatusFromChain(value: number | bigint): EscrowStatus {
  const status = ESCROW_STATUSES[Number(value)];
  if (status === undefined) throw new Error(`Statut de réservation inconnu sur la chaîne : ${value}`);
  return status;
}

// Statut de rendez-vous Salonia correspondant à un acompte réglé sur la chaîne.
export function bookingStatusForEscrow(status: EscrowStatus) {
  if (status === "CANCELLED") return "CANCELLED" as const;
  if (status === "COMPLETED") return "COMPLETED" as const;
  if (status === "NO_SHOW") return "NO_SHOW" as const;
  return "CONFIRMED" as const;
}

export const isUint32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_UINT32;

// 30000000n → "30" ; 12500000n → "12.5". Montant en TND pour l'affichage.
export function unitsToTnd(units: bigint | string): string {
  const value = BigInt(units);
  const base = BigInt(10 ** TOKEN_DECIMALS);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
