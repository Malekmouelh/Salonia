import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import type { EscrowStatus } from "@/lib/enums";
import { Booking, Customer, Notification } from "@/lib/models/booking";
import { Promotion } from "@/lib/models/catalog";
import { Center, User } from "@/lib/models/core";
import * as chain from "./chain";
import { escrowConfig, isEscrowEnabled } from "./config";
import { EscrowError } from "./errors";
import { getLinkedWallet } from "@/lib/wallet/service";
import { ensurePractitionerChainId, ensureWalletIndex } from "./ids";
import { isEscrowSlot, staffActions, unitsToTnd } from "./rules";

// SalonEscrow — service Salonia (Module 3, Membre 1) : fait le lien entre la base et la chaîne.
// Les Server Actions vérifient la session ; ce service vérifie le reste (organisation, centre, propriétaire)
// avant d'appeler lib/escrow/chain.ts. Un centre utilise l'acompte sécurisé dès qu'il a un numéro de chaîne
// (Center.chainId), attribué quand l'administrateur le configure sur le contrat (scripts/escrow-dev.ts).
// Clients : MetaMask signe leurs transactions et le serveur les vérifie. Staff : wallet géré par le serveur.

export type EscrowOffer = { depositTnd: string | null };

export type EscrowSummary = {
  network: string;
  chainBookingId: number;
  depositTnd: string;
  txHash: string;
};

// Numéro de chaîne du centre s'il utilise l'acompte sécurisé, sinon null (parcours Salonia habituel).
export async function escrowCenterChainId(organizationId: string, centerId: string): Promise<number | null> {
  if (!isEscrowEnabled() || !Types.ObjectId.isValid(centerId)) return null;
  await connectDB();
  const center = await Center.findOne({ _id: centerId, organizationId }).select("chainId").lean();
  return typeof center?.chainId === "number" ? center.chainId : null;
}

// Acompte affiché sur la page de réservation, lu sur la chaîne (depositOf). depositTnd null : lecture impossible.
export async function getEscrowOffers(organizationId: string): Promise<Record<string, EscrowOffer>> {
  if (!isEscrowEnabled()) return {};
  await connectDB();
  const centers = await Center.find({ organizationId, chainId: { $ne: null } }).select("chainId").lean();
  const entries = await Promise.all(
    centers.map(async (c) => {
      try {
        const units = await chain.depositOf(c.chainId!);
        return [String(c._id), { depositTnd: units > BigInt(0) ? unitsToTnd(units) : null }] as const;
      } catch {
        return [String(c._id), { depositTnd: null }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

// Le créneau est-il libre sur la chaîne (isSlotFree) ? null si le centre n'utilise pas l'acompte sécurisé.
// Un praticien sans numéro n'a encore jamais été réservé sur la chaîne : son créneau est libre.
export async function isSlotFreeOnChain(p: { organizationId: string; centerId: string; staffId: string; start: Date }) {
  const centerChainId = await escrowCenterChainId(p.organizationId, p.centerId);
  if (centerChainId === null || !Types.ObjectId.isValid(p.staffId)) return null;
  const staff = await User.findOne({ _id: p.staffId, organizationId: p.organizationId, role: "STAFF", centerIds: p.centerId })
    .select("chainId")
    .lean();
  if (!staff) return false;
  if (typeof staff.chainId !== "number") return true;
  return chain.isSlotFree(centerChainId, staff.chainId, p.start);
}

// ── Réservation signée par MetaMask (le navigateur signe, le serveur vérifie) ──
// 1. Salonia enregistre le rendez-vous en attente (PENDING) : le créneau est tenu pendant HOLD_MINUTES.
// 2. prepareEscrowIntent renvoie au navigateur ce qu'il doit signer (centre, praticien, heure, montant).
// 3. MetaMask envoie approve + createBooking depuis le wallet du client.
// 4. confirmEscrowFromTx relit la transaction sur la chaîne et ne confirme que si elle correspond exactement.
// Sans confirmation à temps, releaseExpiredHolds libère le créneau.
export const HOLD_MINUTES = 15;

export type EscrowIntent = {
  bookingId: string;
  centerChainId: number;
  practitionerChainId: number;
  startTime: number;
  depositUnits: string;
  depositTnd: string;
  walletAddress: string;
};

export const NO_WALLET = "Reliez MetaMask à votre compte pour réserver avec l'acompte sécurisé.";

// Le rendez-vous appartient-il au compte client connecté ? (fiche client reliée par userId)
async function ownedBooking(clientUserId: string, bookingId: string) {
  if (!Types.ObjectId.isValid(bookingId)) throw new EscrowError("Rendez-vous introuvable.");
  await connectDB();
  const booking = await Booking.findById(bookingId).select("organizationId centerId staffId customerId start status escrow").lean();
  const owner = booking && (await Customer.exists({ _id: booking.customerId, userId: clientUserId }));
  if (!booking || !owner) throw new EscrowError("Rendez-vous introuvable.");
  return booking;
}

export async function prepareEscrowIntent(p: { organizationId: string; bookingId: string; clientUserId: string }): Promise<EscrowIntent> {
  const booking = await ownedBooking(p.clientUserId, p.bookingId);
  if (String(booking.organizationId) !== p.organizationId) throw new EscrowError("Rendez-vous introuvable.");
  if (booking.escrow) throw new EscrowError("L'acompte de ce rendez-vous est déjà bloqué.");
  if (booking.status !== "PENDING") throw new EscrowError("Cette réservation est déjà réglée.");
  if (!isEscrowSlot(booking.start)) throw new EscrowError("Avec l'acompte sécurisé, choisissez un créneau à l'heure pile ou à la demie.");

  const centerId = String(booking.centerId);
  const centerChainId = await escrowCenterChainId(p.organizationId, centerId);
  if (centerChainId === null) throw new EscrowError("Ce salon n'utilise pas l'acompte sécurisé.");
  const walletAddress = await getLinkedWallet(p.clientUserId);
  if (!walletAddress) throw new EscrowError(NO_WALLET);
  const practitionerChainId = await ensurePractitionerChainId(p.organizationId, centerId, String(booking.staffId));
  const deposit = await chain.depositOf(centerChainId);
  if (deposit === BigInt(0)) throw new EscrowError("Ce salon n'a pas encore configuré son acompte.");
  // Testnet : un peu de gaz pour que le wallet du client puisse payer ses transactions.
  await chain.fundGas(walletAddress as `0x${string}`);

  await Booking.updateOne({ _id: booking._id }, { $set: { escrowHoldUntil: new Date(Date.now() + HOLD_MINUTES * 60_000) } });
  return {
    bookingId: p.bookingId,
    centerChainId,
    practitionerChainId,
    startTime: Math.floor(booking.start.getTime() / 1000),
    depositUnits: deposit.toString(),
    depositTnd: unitsToTnd(deposit),
    walletAddress,
  };
}

// Vérifie la transaction createBooking envoyée par MetaMask, puis confirme le rendez-vous.
export async function confirmEscrowFromTx(p: {
  clientUserId: string;
  bookingId: string;
  txHash: string;
}): Promise<EscrowSummary & { organizationId: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(p.txHash)) throw new EscrowError("Transaction introuvable ou refusée par le contrat.");
  const booking = await ownedBooking(p.clientUserId, p.bookingId);
  if (booking.escrow) throw new EscrowError("L'acompte de ce rendez-vous est déjà bloqué.");
  if (booking.status !== "PENDING") throw new EscrowError("Cette réservation est déjà réglée.");
  const config = escrowConfig();
  if (!config) throw new EscrowError("L'acompte sécurisé n'est pas activé sur ce serveur.");

  const organizationId = String(booking.organizationId);
  const [centerChainId, walletAddress, staff, created] = await Promise.all([
    escrowCenterChainId(organizationId, String(booking.centerId)),
    getLinkedWallet(p.clientUserId),
    User.findById(booking.staffId).select("chainId").lean(),
    chain.bookingCreatedInTx(p.txHash as `0x${string}`),
  ]);
  const matches =
    walletAddress !== null &&
    created.client.toLowerCase() === walletAddress.toLowerCase() &&
    created.centerId === centerChainId &&
    created.practitionerId === staff?.chainId &&
    created.startTime === Math.floor(booking.start.getTime() / 1000);
  if (!matches) throw new EscrowError("La transaction ne correspond pas à ce rendez-vous.");

  try {
    await Booking.updateOne(
      { _id: booking._id, status: "PENDING", escrow: null },
      {
        $set: {
          status: "CONFIRMED",
          escrow: {
            network: config.network,
            chainBookingId: created.chainBookingId,
            centerChainId: created.centerId,
            practitionerChainId: created.practitionerId,
            depositUnits: created.deposit.toString(),
            clientAddress: created.client,
            status: "CONFIRMED",
            createTxHash: p.txHash,
          },
        },
        $unset: { escrowHoldUntil: 1 },
      },
    );
  } catch (error) {
    // Index unique (réseau, n° de réservation) : une même transaction ne confirme qu'un seul rendez-vous.
    if ((error as { code?: number }).code === 11000) throw new EscrowError("Cette transaction a déjà été utilisée.");
    throw error;
  }
  return { organizationId, network: config.network, chainBookingId: created.chainBookingId, depositTnd: unitsToTnd(created.deposit), txHash: p.txHash };
}

// Le client a refusé dans MetaMask (ou la transaction a échoué) : le créneau est rendu aussitôt.
export async function abandonEscrowIntent(p: { clientUserId: string; bookingId: string }) {
  const booking = await ownedBooking(p.clientUserId, p.bookingId);
  if (booking.status === "PENDING" && !booking.escrow) await rollbackUnpaidBooking(String(booking.organizationId), p.bookingId);
}

// Rendez-vous en attente d'acompte dont le délai est passé : le créneau est libéré.
export async function releaseExpiredHolds(now: Date = new Date()) {
  await connectDB();
  const expired = await Booking.find({ status: "PENDING", escrow: null, escrowHoldUntil: { $lt: now } }).select("organizationId").lean();
  for (const b of expired) await rollbackUnpaidBooking(String(b.organizationId), String(b._id));
  return expired.length;
}

// Statut lu sur la chaîne (getBooking) pour des rendez-vous Salonia : la chaîne fait foi pour l'acompte.
// null : réseau différent de celui du serveur, ou chaîne injoignable (l'écran affiche alors la copie de la base).
export async function readEscrowStatuses(items: { id: string; network: string; chainBookingId: number }[]) {
  const config = escrowConfig();
  const entries = await Promise.all(
    items.map(async (item) => {
      if (!config || item.network !== config.network) return [item.id, null] as const;
      try {
        return [item.id, (await chain.getBooking(item.chainBookingId)).status] as const;
      } catch {
        return [item.id, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<string, EscrowStatus | null>;
}

// Annulation signée par MetaMask (cancelBooking depuis le wallet du client) : le serveur relit l'événement
// BookingCancelled de la transaction, vérifie qu'il concerne CE rendez-vous et CE client, puis met la base à jour.
// Le contrat a déjà appliqué la règle des 24 h : remboursé au client, sinon versé au salon.
export async function confirmCancelFromTx(p: { clientUserId: string; bookingId: string; txHash: string }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(p.txHash)) throw new EscrowError("Transaction introuvable ou refusée par le contrat.");
  const booking = await ownedBooking(p.clientUserId, p.bookingId);
  if (!booking.escrow) throw new EscrowError("Ce rendez-vous n'a pas d'acompte sécurisé.");
  const config = escrowConfig();
  if (!config || booking.escrow.network !== config.network) throw new EscrowError("L'acompte sécurisé n'est pas activé sur ce serveur.");

  const cancelled = await chain.bookingCancelledInTx(p.txHash as `0x${string}`);
  if (
    cancelled.chainBookingId !== booking.escrow.chainBookingId ||
    cancelled.client.toLowerCase() !== booking.escrow.clientAddress.toLowerCase()
  ) {
    throw new EscrowError("La transaction ne correspond pas à ce rendez-vous.");
  }
  await Booking.updateOne(
    { _id: booking._id },
    {
      $set: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: cancelled.refunded ? "Annulé par le client (acompte remboursé)" : "Annulé par le client (acompte versé au salon)",
        "escrow.status": "CANCELLED",
        "escrow.refunded": cancelled.refunded,
        "escrow.settleTxHash": p.txHash,
      },
    },
  );
  return { organizationId: String(booking.organizationId), refunded: cancelled.refunded, depositTnd: unitsToTnd(booking.escrow.depositUnits) };
}

// Prestation réalisée (COMPLETED) ou client absent (NO_SHOW), signé par le wallet du membre de l'équipe.
// La Server Action a déjà vérifié la session et l'accès au rendez-vous (centre, et pour un STAFF : ses propres
// rendez-vous). Le contrat revérifie que ce wallet est staff du centre et les délais (début, début + 15 min).
export async function settleEscrowBookingByStaff(p: {
  organizationId: string;
  bookingId: string;
  staffUserId: string;
  outcome: "COMPLETED" | "NO_SHOW";
}) {
  await connectDB();
  const booking = await Booking.findOne({ _id: p.bookingId, organizationId: p.organizationId }).select("start status escrow").lean();
  if (!booking) throw new EscrowError("Rendez-vous introuvable.");
  if (!booking.escrow) throw new EscrowError("Ce rendez-vous n'a pas d'acompte sécurisé.");
  if (booking.status !== "CONFIRMED" || booking.escrow.status !== "CONFIRMED") throw new EscrowError("Cette réservation est déjà réglée.");
  const { canComplete, canNoShow } = staffActions(booking.start);
  if ((p.outcome === "COMPLETED" && !canComplete) || (p.outcome === "NO_SHOW" && !canNoShow)) {
    throw new EscrowError("Trop tôt : validation possible dès l'heure du rendez-vous, absence 15 minutes après.");
  }
  const config = escrowConfig();
  if (!config || booking.escrow.network !== config.network) throw new EscrowError("L'acompte sécurisé n'est pas activé sur ce serveur.");

  const staffWalletIndex = await ensureWalletIndex(p.staffUserId);
  const { txHash } = await chain.settleBookingOnChain({
    staffWalletIndex,
    centerChainId: booking.escrow.centerChainId,
    chainBookingId: booking.escrow.chainBookingId,
    outcome: p.outcome,
  });
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { status: p.outcome, "escrow.status": p.outcome, "escrow.refunded": false, "escrow.settleTxHash": txHash } },
  );
  return { txHash, depositTnd: unitsToTnd(booking.escrow.depositUnits) };
}

// Annule l'enregistrement d'un rendez-vous dont l'acompte n'a pas pu être bloqué : le créneau redevient libre.
// Même retour arrière que la protection contre les réservations simultanées de lib/booking/create.ts.
export async function rollbackUnpaidBooking(organizationId: string, bookingId: string) {
  await connectDB();
  const booking = await Booking.findOneAndDelete({ _id: bookingId, organizationId, escrow: null }).lean();
  if (!booking) return;
  await Notification.deleteMany({ bookingId: booking._id });
  if (booking.promotionId) await Promotion.updateOne({ _id: booking.promotionId }, { $inc: { usedCount: -1 } });
}
