// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/money.ts — LES CALCULS D'ARGENT (fonctions « pures »)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Regroupe toutes les petites formules mathématiques du module : arrondi, totaux de
//   facture, TVA, solde restant, numérotation. Ce sont des fonctions « pures » : elles ne
//   touchent ni la base de données ni le réseau, elles prennent des nombres et renvoient
//   des nombres. Avantage : faciles à tester (voir finance.test.ts) et utilisables
//   partout (serveur, navigateur).
// ═══════════════════════════════════════════════════════════════════════════

// Calculs monétaires du Module 6 (purs, utilisables côté client, serveur et tests).
// Le dinar tunisien compte 3 décimales (1 DT = 1000 millimes) : on arrondit au millime.

// Taux de TVA en Tunisie sur les services : 19 %. (Valeur utilisée par défaut partout.)
export const VAT_RATE = 0.19;

// Arrondit un montant au millime (3 décimales).
// POURQUOI ne pas utiliser les nombres tels quels ? En informatique, 0.1 + 0.2 donne
// 0.30000000000000004 (limite des nombres à virgule flottante). Sans arrondi, on pourrait
// afficher ou comparer des montants faux. `Number.EPSILON` est un minuscule correctif qui
// fait arrondir 1.0005 vers 1.001 (au lieu de 1.000) : on multiplie par 1000, on arrondit
// à l'entier, puis on redivise par 1000.
export function roundTnd(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

// Additionne une liste de montants puis arrondit le résultat (évite l'accumulation d'erreurs).
// `reduce` parcourt la liste en gardant un cumul `n` (départ = 0).
export function sumTnd(values: number[]) {
  return roundTnd(values.reduce((n, v) => n + v, 0));
}

// Les prix du catalogue sont TTC : on en déduit le HT et la TVA incluse.
// TTC = HT × (1 + taux)  ⇒  HT = TTC ÷ (1 + taux).   Exemple : 119 TTC → 100 HT + 19 de TVA.
// On calcule la TVA par soustraction (TTC − HT) pour que HT + TVA retombe TOUJOURS exactement
// sur le TTC, même avec les arrondis.
export function vatBreakdown(totalTtc: number, rate = VAT_RATE) {
  const ht = roundTnd(totalTtc / (1 + rate));
  return { ht, vat: roundTnd(totalTtc - ht), ttc: roundTnd(totalTtc) };
}

// Une ligne à facturer telle que saisie : libellé, quantité, prix unitaire (serviceId facultatif).
export type LineInput = { label: string; quantity: number; unitPriceTnd: number; serviceId?: string | null };

// Calcule les totaux d'une facture à partir de ses lignes et d'une remise éventuelle.
// Étapes : (1) total de chaque ligne = quantité × prix ; (2) sous-total = somme des lignes ;
// (3) la remise est « bornée » : jamais négative (Math.max(…, 0)) et jamais supérieure au
// sous-total (Math.min(…, subtotal)) → impossible d'obtenir un total négatif ; (4) total = sous-total − remise.
export function computeTotals(lines: LineInput[], discountTnd = 0) {
  const computed = lines.map((l) => ({ ...l, totalTnd: roundTnd(l.quantity * l.unitPriceTnd) }));
  const subtotalTnd = sumTnd(computed.map((l) => l.totalTnd));
  const discount = roundTnd(Math.min(Math.max(discountTnd, 0), subtotalTnd));
  return { lines: computed, subtotalTnd, discountTnd: discount, totalTnd: roundTnd(subtotalTnd - discount) };
}

// Solde restant d'une réservation ou d'une facture : total − (paiements + acomptes − remboursements).
// Exemple : total 100, acompte 30 payé → il reste 70 à payer.
export function balanceDue(totalTnd: number, payments: { kind: string; amountTnd: number; status: string }[]) {
  return roundTnd(totalTnd - netPaid(payments));
}

// Argent NET réellement encaissé = paiements/acomptes − remboursements.
// On ne garde que les paiements PAYÉS (status "PAID") : un lien en attente ou un paiement
// échoué n'est pas de l'argent reçu. Un remboursement compte en négatif.
export function netPaid(payments: { kind: string; amountTnd: number; status: string }[]) {
  return sumTnd(
    payments.filter((p) => p.status === "PAID").map((p) => (p.kind === "REFUND" ? -p.amountTnd : p.amountTnd)),
  );
}

// Numéro de pièce : FAC-2026-00042 / REC-2026-00042.
// `padStart(5, "0")` complète à gauche avec des zéros jusqu'à 5 chiffres (42 → "00042").
export function formatDocNumber(prefix: "FAC" | "REC", year: number, seq: number) {
  return `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
}

// Format numérique pour PDF et CSV (point décimal, 3 décimales), indépendant de la langue.
// `toFixed(3)` renvoie du texte avec exactement 3 décimales (12.5 → "12.500").
export function plainTnd(value: number) {
  return roundTnd(value).toFixed(3);
}

// Écart de caisse = espèces comptées − espèces attendues.
// Négatif : il MANQUE de l'argent dans le tiroir ; positif : il y en a EN TROP (souvent un oubli d'enregistrement).
// Exemple : attendu 480 DT, compté 465 DT → écart de −15 DT.
export function cashVariance(expectedCashTnd: number, countedCashTnd: number) {
  return roundTnd(countedCashTnd - expectedCashTnd);
}
