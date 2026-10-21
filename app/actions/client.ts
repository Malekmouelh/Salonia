"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/dal";
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
