"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/dal";
import { EscrowError } from "@/lib/escrow/errors";
import { confirmCancelFromTx } from "@/lib/escrow/service";
import { FinanceError, createClientPaymentLink } from "@/lib/finance/service";

const PaySchema = z.object({
  bookingId: z.string().min(1),
  kind: z.enum(["DEPOSIT", "PAYMENT"]),
});

// Espace client : paiement en ligne (acompte ou totalité) d'un de ses rendez-vous.
// Renvoie l'adresse de la page de paiement sécurisée du Module 6.
export async function payMyBooking(input: z.input<typeof PaySchema>): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (user.role !== "CLIENT") return { ok: false, error: "Paiement réservé aux comptes clients." };
  const parsed = PaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Demande invalide." };
  try {
    const token = await createClientPaymentLink(user.id, parsed.data.bookingId, parsed.data.kind);
    return { ok: true, url: `/paiement/${token}` };
  } catch (e) {
    if (e instanceof FinanceError) return { ok: false, error: e.message };
    throw e;
  }
}

export type EscrowCancelResult = { ok: true; refunded: boolean; depositTnd: string } | { ok: false; error: string };

// Espace client : annulation d'un rendez-vous avec acompte sécurisé (SalonEscrow, Module 3).
// MetaMask a signé cancelBooking depuis le wallet du client ; le serveur relit la transaction sur la chaîne
// (événement BookingCancelled, ce rendez-vous, ce client) avant de mettre la base à jour.
export async function confirmMyEscrowCancel(input: { bookingId: string; txHash: string }): Promise<EscrowCancelResult> {
  const user = await getCurrentUser();
  if (user.role !== "CLIENT") return { ok: false, error: "Annulation réservée aux comptes clients." };
  if (typeof input?.bookingId !== "string" || typeof input?.txHash !== "string") return { ok: false, error: "Demande invalide." };
  try {
    const r = await confirmCancelFromTx({ clientUserId: user.id, bookingId: input.bookingId, txHash: input.txHash });
    await logEvent("BOOKING_CANCELLED", {
      userId: user.id,
      organizationId: r.organizationId,
      detail: `${input.bookingId} · acompte ${r.refunded ? "remboursé" : "versé au salon"}`,
    });
    revalidatePath("/dashboard");
    return { ok: true, refunded: r.refunded, depositTnd: r.depositTnd };
  } catch (e) {
    if (e instanceof EscrowError) return { ok: false, error: e.message };
    throw e;
  }
}
