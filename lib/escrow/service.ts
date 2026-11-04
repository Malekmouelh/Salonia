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
import { ensurePractitionerChainId, ensureWalletIndex } from "./ids";
import { cancellationOutcome, isEscrowSlot, staffActions, unitsToTnd } from "./rules";

// SalonEscrow — service Salonia (Module 3, Membre 1) : fait le lien entre la base et la chaîne.
// Les Server Actions vérifient la session ; ce service vérifie le reste (organisation, centre, propriétaire)
// avant d'appeler lib/escrow/chain.ts. Un centre utilise l'acompte sécurisé dès qu'il a un numéro de chaîne
// (Center.chainId), attribué quand l'administrateur le configure sur le contrat (scripts/escrow-setup.ts).

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

// Bloque l'acompte d'un rendez-vous Salonia déjà enregistré : wallet du client → createBooking sur la chaîne,
// puis copie du résultat dans Booking.escrow. Le client et le centre viennent de la base, jamais du navigateur.
export async function lockDepositForBooking(p: { organizationId: string; bookingId: string; clientUserId: string }): Promise<EscrowSummary> {
  await connectDB();
  const booking = await Booking.findOne({ _id: p.bookingId, organizationId: p.organizationId }).select("centerId staffId start escrow").lean();
  if (!booking) throw new EscrowError("Rendez-vous introuvable.");
  if (booking.escrow) throw new EscrowError("L'acompte de ce rendez-vous est déjà bloqué.");
  if (!isEscrowSlot(booking.start)) throw new EscrowError("Avec l'acompte sécurisé, choisissez un créneau à l'heure pile ou à la demie.");

  const centerId = String(booking.centerId);
  const centerChainId = await escrowCenterChainId(p.organizationId, centerId);
  if (centerChainId === null) throw new EscrowError("Ce salon n'utilise pas l'acompte sécurisé.");
  const [practitionerChainId, clientWalletIndex] = await Promise.all([
    ensurePractitionerChainId(p.organizationId, centerId, String(booking.staffId)),
    ensureWalletIndex(p.clientUserId),
  ]);

  const created = await chain.createBookingOnChain({ clientWalletIndex, centerChainId, practitionerChainId, start: booking.start });
  const network = escrowConfig()!.network;
  try {
    await Booking.updateOne(
      { _id: p.bookingId, organizationId: p.organizationId },
      {
        $set: {
          escrow: {
            network,
            chainBookingId: created.chainBookingId,
            centerChainId,
            practitionerChainId,
            depositUnits: created.depositUnits,
            clientAddress: created.clientAddress,
            status: "CONFIRMED",
            createTxHash: created.txHash,
          },
        },
      },
    );
  } catch (error) {
    // L'acompte est bloqué sur la chaîne mais la base n'a pas pu l'enregistrer : trace pour rapprochement manuel.
    console.error(`SalonEscrow : réservation ${created.chainBookingId} (${network}) non enregistrée pour le rendez-vous ${p.bookingId}.`, error);
    throw new EscrowError("Acompte bloqué, mais l'enregistrement a échoué. Contactez le salon.");
  }
  return { network, chainBookingId: created.chainBookingId, depositTnd: unitsToTnd(created.depositUnits), txHash: created.txHash };
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

// Annulation par le client lui-même (cancelBooking signé par SON wallet). Le contrat applique la règle des 24 h :
// remboursé au client, sinon versé au salon. Seul le compte relié à la fiche client du rendez-vous peut annuler.
export async function cancelEscrowBookingForClient(p: { clientUserId: string; bookingId: string }) {
  if (!Types.ObjectId.isValid(p.bookingId)) throw new EscrowError("Rendez-vous introuvable.");
  await connectDB();
  const booking = await Booking.findById(p.bookingId).select("organizationId customerId start status escrow").lean();
  const owner = booking && (await Customer.exists({ _id: booking.customerId, userId: p.clientUserId }));
  if (!booking || !owner) throw new EscrowError("Rendez-vous introuvable.");
  if (!booking.escrow) throw new EscrowError("Ce rendez-vous n'a pas d'acompte sécurisé.");
  if (booking.status !== "CONFIRMED" || booking.escrow.status !== "CONFIRMED") throw new EscrowError("Cette réservation est déjà réglée.");
  if (cancellationOutcome(booking.start) === "STARTED") throw new EscrowError("Le rendez-vous a commencé : l'annulation n'est plus possible.");
  const config = escrowConfig();
  if (!config || booking.escrow.network !== config.network) throw new EscrowError("L'acompte sécurisé n'est pas activé sur ce serveur.");

  const clientWalletIndex = await ensureWalletIndex(p.clientUserId);
  const { refunded, txHash } = await chain.cancelBookingOnChain({ clientWalletIndex, chainBookingId: booking.escrow.chainBookingId });

  await Booking.updateOne(
    { _id: booking._id },
    {
      $set: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: refunded ? "Annulé par le client (acompte remboursé)" : "Annulé par le client (acompte versé au salon)",
        "escrow.status": "CANCELLED",
        "escrow.refunded": refunded,
        "escrow.settleTxHash": txHash,
      },
    },
  );
  return { organizationId: String(booking.organizationId), refunded, txHash, depositTnd: unitsToTnd(booking.escrow.depositUnits) };
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
