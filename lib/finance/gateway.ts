import "server-only";
import { randomBytes } from "node:crypto";

// F6.2 — Passerelle de paiement en ligne.
// Contrat minimal : autoriser un paiement et renvoyer une référence de transaction vérifiable.
// Le fournisseur « sandbox » simule une passerelle locale pour la démonstration (aucune donnée de carte
// n'est conservée). Pour la mise en production, implémenter ce contrat avec l'API du fournisseur retenu
// (Konnect, Flouci, ClicToPay…) : redirection vers sa page de paiement, puis vérification serveur à serveur
// du statut de la transaction avant d'appeler confirmOnlinePayment().

export type GatewayResult = { ok: true; reference: string } | { ok: false; error: string };

export interface PaymentGateway {
  name: string;
  authorize(input: { amountTnd: number; cardNumber: string; expiry: string; cvc: string }): Promise<GatewayResult>;
}

// Algorithme de Luhn : rejette les numéros de carte mal saisis.
export function luhn(cardNumber: string) {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function validExpiry(expiry: string, now = new Date()) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

// Cartes de test : 4242 4242 4242 4242 (acceptée), 4000 0000 0000 0002 (refusée).
const sandbox: PaymentGateway = {
  name: "sandbox",
  async authorize({ cardNumber, expiry, cvc }) {
    const digits = cardNumber.replace(/\D/g, "");
    if (!luhn(digits)) return { ok: false, error: "Numéro de carte invalide." };
    if (!validExpiry(expiry)) return { ok: false, error: "Date d'expiration invalide." };
    if (!/^\d{3,4}$/.test(cvc)) return { ok: false, error: "Code de sécurité invalide." };
    if (digits.endsWith("0002")) return { ok: false, error: "Paiement refusé par la banque." };
    return { ok: true, reference: `SBX-${randomBytes(5).toString("hex").toUpperCase()}` };
  },
};

export function getGateway(): PaymentGateway {
  return sandbox;
}
