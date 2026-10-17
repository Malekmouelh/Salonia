// Calculs monétaires du Module 6 (purs, utilisables côté client, serveur et tests).
// Le dinar tunisien compte 3 décimales (1 DT = 1000 millimes) : on arrondit au millime.

export const VAT_RATE = 0.19;

export function roundTnd(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function sumTnd(values: number[]) {
  return roundTnd(values.reduce((n, v) => n + v, 0));
}

// Les prix du catalogue sont TTC : on en déduit le HT et la TVA incluse.
export function vatBreakdown(totalTtc: number, rate = VAT_RATE) {
  const ht = roundTnd(totalTtc / (1 + rate));
  return { ht, vat: roundTnd(totalTtc - ht), ttc: roundTnd(totalTtc) };
}

export type LineInput = { label: string; quantity: number; unitPriceTnd: number; serviceId?: string | null };

export function computeTotals(lines: LineInput[], discountTnd = 0) {
  const computed = lines.map((l) => ({ ...l, totalTnd: roundTnd(l.quantity * l.unitPriceTnd) }));
  const subtotalTnd = sumTnd(computed.map((l) => l.totalTnd));
  const discount = roundTnd(Math.min(Math.max(discountTnd, 0), subtotalTnd));
  return { lines: computed, subtotalTnd, discountTnd: discount, totalTnd: roundTnd(subtotalTnd - discount) };
}

// Solde restant d'une réservation ou d'une facture : total − (paiements + acomptes − remboursements).
export function balanceDue(totalTnd: number, payments: { kind: string; amountTnd: number; status: string }[]) {
  return roundTnd(totalTnd - netPaid(payments));
}

export function netPaid(payments: { kind: string; amountTnd: number; status: string }[]) {
  return sumTnd(
    payments.filter((p) => p.status === "PAID").map((p) => (p.kind === "REFUND" ? -p.amountTnd : p.amountTnd)),
  );
}

// Numéro de pièce : FAC-2026-00042 / REC-2026-00042.
export function formatDocNumber(prefix: "FAC" | "REC", year: number, seq: number) {
  return `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
}

// Format numérique pour PDF et CSV (point décimal, 3 décimales), indépendant de la langue.
export function plainTnd(value: number) {
  return roundTnd(value).toFixed(3);
}
