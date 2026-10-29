// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/gateway.ts — LA PASSERELLE DE PAIEMENT EN LIGNE (F6.2)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Simule une banque / un service de paiement en ligne (comme Konnect, Flouci, ClicToPay).
//   Le reste de l'application ne dépend que de l'interface `PaymentGateway` : pour passer en
//   production, on écrira une autre implémentation de cette interface avec la vraie API,
//   sans toucher au reste du code (c'est le principe de « l'inversion de dépendance »).
// SÉCURITÉ : le numéro de carte est vérifié ici puis oublié. Il n'est JAMAIS enregistré en base.
// ═══════════════════════════════════════════════════════════════════════════
import "server-only"; // erreur de compilation si ce fichier est importé côté navigateur
import { randomBytes } from "node:crypto";

// F6.2 — Passerelle de paiement en ligne.
// Contrat minimal : autoriser un paiement et renvoyer une référence de transaction vérifiable.
// Le fournisseur « sandbox » simule une passerelle locale pour la démonstration (aucune donnée de carte
// n'est conservée). Pour la mise en production, implémenter ce contrat avec l'API du fournisseur retenu
// (Konnect, Flouci, ClicToPay…) : redirection vers sa page de paiement, puis vérification serveur à serveur
// du statut de la transaction avant d'appeler confirmOnlinePayment().

// Résultat d'une autorisation : soit succès avec une référence, soit échec avec un message.
// (« Type union discriminée » : le champ `ok` indique quelle forme l'objet a.)
export type GatewayResult = { ok: true; reference: string } | { ok: false; error: string };

// Le « contrat » que toute passerelle doit respecter : un nom et une méthode authorize().
export interface PaymentGateway {
  name: string;
  authorize(input: { amountTnd: number; cardNumber: string; expiry: string; cvc: string }): Promise<GatewayResult>;
}

// Algorithme de Luhn : rejette les numéros de carte mal saisis.
// C'est la formule de contrôle utilisée par toutes les cartes bancaires (détecte une faute de frappe).
// Principe : en partant de la DROITE, on double un chiffre sur deux ; si le double dépasse 9, on
// retranche 9 ; on additionne tout ; le numéro est valide si la somme est un multiple de 10.
export function luhn(cardNumber: string) {
  // On ne garde que les chiffres (\D = tout ce qui n'est pas un chiffre) : accepte « 4242 4242… ».
  const digits = cardNumber.replace(/\D/g, "");
  // Une carte compte entre 12 et 19 chiffres.
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // On lit les chiffres de la fin vers le début.
    let d = Number(digits[digits.length - 1 - i]);
    // Un chiffre sur deux (positions 1, 3, 5… depuis la droite) est doublé.
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Vérifie le format « MM/AA » et que la carte n'est pas expirée.
function validExpiry(expiry: string, now = new Date()) {
  // Expression régulière : 2 chiffres, « / » (espaces tolérés), 2 chiffres.
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]); // « 28 » → 2028
  if (month < 1 || month > 12) return false;
  // Valide si l'année est future, ou si c'est l'année en cours et que le mois n'est pas passé.
  // (getMonth() va de 0 à 11, d'où le +1.)
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

// Cartes de test : 4242 4242 4242 4242 (acceptée), 4000 0000 0000 0002 (refusée).
// La passerelle de démonstration : elle contrôle la carte, puis accepte ou refuse selon les
// 4 derniers chiffres, et fabrique une fausse référence de transaction (SBX-…).
const sandbox: PaymentGateway = {
  name: "sandbox",
  async authorize({ cardNumber, expiry, cvc }) {
    const digits = cardNumber.replace(/\D/g, "");
    if (!luhn(digits)) return { ok: false, error: "Numéro de carte invalide." };
    if (!validExpiry(expiry)) return { ok: false, error: "Date d'expiration invalide." };
    // Le code de sécurité (CVC) a 3 ou 4 chiffres.
    if (!/^\d{3,4}$/.test(cvc)) return { ok: false, error: "Code de sécurité invalide." };
    // Simulation d'un refus de la banque : carte de test se terminant par 0002.
    if (digits.endsWith("0002")) return { ok: false, error: "Paiement refusé par la banque." };
    // `randomBytes(5)` = 5 octets aléatoires → 10 caractères hexadécimaux en majuscules.
    return { ok: true, reference: `SBX-${randomBytes(5).toString("hex").toUpperCase()}` };
  },
};

// Point d'entrée unique : le reste du code appelle getGateway() sans savoir quelle passerelle se cache derrière.
export function getGateway(): PaymentGateway {
  return sandbox;
}
