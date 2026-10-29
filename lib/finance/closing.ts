// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/closing.ts — LA CLÔTURE DE CAISSE
// ═══════════════════════════════════════════════════════════════════════════
// QU'EST-CE QUE LA CLÔTURE DE CAISSE ?
//   Chaque soir, le gérant compte les espèces du tiroir-caisse et les compare à ce que le SYSTÈME attend
//   (somme des encaissements en espèces de la journée, remboursements déduits). La différence est
//   l'« écart de caisse ». Une fois validée, la journée est VERROUILLÉE : plus aucun paiement ne peut y
//   être ajouté (voir assertDayOpen dans service.ts). Seul le propriétaire peut rouvrir la caisse.
//
// POURQUOI C'EST IMPORTANT POUR UN SALON : les écarts répétés révèlent des erreurs de rendu de monnaie,
// des oublis d'enregistrement ou des vols. Ils alimentent aussi l'IA de détection d'anomalies
// (voir closingAnomalies dans analytics.ts).
//
// DROITS : propriétaire et gérant clôturent (pour leurs centres) ; seul le propriétaire rouvre.
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import { Types } from "mongoose";
import { addDays, dayKey, parseDayKey, startOfLocalDay } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import type { PaymentMethod } from "@/lib/enums";
import { CashClosing, Payment } from "@/lib/models/finance";
import { cashVariance, roundTnd } from "./money";
import { FinanceError, assertCenter, canViewFinance, financeCenterIds } from "./service";

// Totaux attendus d'une journée : un montant NET par moyen de paiement.
export type ExpectedTotal = { method: PaymentMethod; amountTnd: number };

// Une clôture telle qu'affichée dans l'interface (données sérialisables : texte, nombres).
export type ClosingRow = {
  id: string;
  day: string;
  centerId: string;
  center: string;
  expected: ExpectedTotal[];
  expectedCashTnd: number;
  countedCashTnd: number;
  varianceTnd: number;
  note: string | null;
  closedBy: string;
  closedAt: string;
};

// Calcule, à partir des paiements CONFIRMÉS du jour, ce que le système attend pour chaque moyen de paiement.
// Un remboursement compte en négatif : la somme donne l'argent réellement entré (ou sorti) du tiroir.
export async function expectedTotals(organizationId: string, centerId: string, day: string): Promise<ExpectedTotal[]> {
  const from = parseDayKey(day);
  if (!from) throw new FinanceError("Jour invalide.");
  await connectDB();
  const rows = await Payment.aggregate<{ _id: PaymentMethod; amount: number }>([
    {
      $match: {
        organizationId: new Types.ObjectId(organizationId),
        centerId: new Types.ObjectId(centerId),
        status: "PAID",
        paidAt: { $gte: from, $lt: addDays(from, 1) },
      },
    },
    // Regroupement par moyen ; SI c'est un remboursement ALORS −montant SINON +montant.
    { $group: { _id: "$method", amount: { $sum: { $cond: [{ $eq: ["$kind", "REFUND"] }, { $multiply: ["$amountTnd", -1] }, "$amountTnd"] } } } },
  ]);
  return rows.map((r) => ({ method: r._id, amountTnd: roundTnd(r.amount) })).sort((a, b) => b.amountTnd - a.amountTnd);
}

// Espèces attendues = total du moyen « CASH » (0 si aucun encaissement en espèces ce jour-là).
export const expectedCash = (totals: ExpectedTotal[]) => totals.find((t) => t.method === "CASH")?.amountTnd ?? 0;

// Convertit un document Mongo en ClosingRow (texte et nombres simples, nom du centre et du clôtureur).
function toRow(
  c: {
    _id: unknown;
    day: string;
    centerId: unknown;
    expected: { method: string; amountTnd: number }[];
    expectedCashTnd: number;
    countedCashTnd: number;
    varianceTnd: number;
    note?: string | null;
    closedAt: Date;
  },
  centerName: string,
  closedBy: string,
): ClosingRow {
  return {
    id: String(c._id),
    day: c.day,
    centerId: String(c.centerId),
    center: centerName,
    expected: c.expected.map((e) => ({ method: e.method as PaymentMethod, amountTnd: e.amountTnd })),
    expectedCashTnd: c.expectedCashTnd,
    countedCashTnd: c.countedCashTnd,
    varianceTnd: c.varianceTnd,
    note: c.note ?? null,
    closedBy,
    closedAt: c.closedAt.toISOString(),
  };
}

// État de la caisse d'un centre pour un jour : clôturée (avec ses chiffres) ou ouverte (avec les totaux
// attendus, prêts à être comparés au comptage). Affiché dans la page Caisse.
export async function getClosingState(user: CurrentUser, centerId: string, day: string) {
  if (!user.organization || !canViewFinance(user)) return null;
  assertCenter(user, centerId);
  await connectDB();
  const doc = await CashClosing.findOne({ organizationId: user.organization.id, centerId, day })
    .populate<{ closedBy: { firstName: string; lastName: string } | null }>("closedBy", "firstName lastName")
    .lean();
  const centerName = user.organization.centers.find((c) => c.id === centerId)?.name ?? "";
  if (doc) {
    return {
      closing: toRow(doc, centerName, doc.closedBy ? `${doc.closedBy.firstName} ${doc.closedBy.lastName}` : "—"),
      expected: doc.expected.map((e) => ({ method: e.method as PaymentMethod, amountTnd: e.amountTnd })),
      expectedCashTnd: doc.expectedCashTnd,
    };
  }
  const expected = await expectedTotals(user.organization.id, centerId, day);
  return { closing: null, expected, expectedCashTnd: expectedCash(expected) };
}

// Clôture la caisse d'un centre pour un jour donné.
export async function closeCash(user: CurrentUser, input: { centerId: string; day: string; countedCashTnd: number; note?: string }) {
  if (!user.organization || !canViewFinance(user)) throw new FinanceError("Seuls le gérant et le propriétaire peuvent clôturer la caisse.");
  assertCenter(user, input.centerId);
  const dayStart = parseDayKey(input.day);
  if (!dayStart) throw new FinanceError("Jour invalide.");
  // On ne clôture pas l'avenir : le jour doit être aujourd'hui ou passé.
  if (dayStart > startOfLocalDay(new Date())) throw new FinanceError("Impossible de clôturer une journée qui n'a pas encore eu lieu.");
  await connectDB();
  if (await CashClosing.exists({ centerId: input.centerId, day: input.day })) throw new FinanceError("La caisse de ce jour est déjà clôturée.");

  const expected = await expectedTotals(user.organization.id, input.centerId, input.day);
  const expectedCashTnd = expectedCash(expected);
  const counted = roundTnd(input.countedCashTnd);
  try {
    const doc = await CashClosing.create({
      organizationId: user.organization.id,
      centerId: input.centerId,
      day: input.day,
      expected,
      expectedCashTnd,
      countedCashTnd: counted,
      varianceTnd: cashVariance(expectedCashTnd, counted),
      note: input.note || undefined,
      closedBy: user.id,
      closedAt: new Date(),
    });
    return doc;
  } catch (e) {
    // Deux gérants qui cliquent en même temps : l'index unique (centre + jour) refuse le second (code 11000).
    if ((e as { code?: number }).code === 11000) throw new FinanceError("La caisse de ce jour est déjà clôturée.");
    throw e;
  }
}

// Rouvre une caisse clôturée (propriétaire seulement) : supprime la clôture, ce qui ré-autorise les mouvements du jour.
export async function reopenCash(user: CurrentUser, closingId: string) {
  if (!user.organization || user.role !== "OWNER" || !Types.ObjectId.isValid(closingId)) throw new FinanceError("Seul le propriétaire peut rouvrir une caisse.");
  await connectDB();
  const doc = await CashClosing.findOneAndDelete({ _id: closingId, organizationId: user.organization.id });
  if (!doc) throw new FinanceError("Clôture introuvable.");
  return doc;
}

// Historique des clôtures (page « Paiements ») : filtrable par centre, du plus récent au plus ancien.
export async function listClosings(user: CurrentUser, params: { centerId?: string; fromDay?: string; limit?: number }): Promise<ClosingRow[]> {
  if (!user.organization || !canViewFinance(user)) return [];
  await connectDB();
  const allowed = financeCenterIds(user);
  const centers = params.centerId && allowed.includes(params.centerId) ? [params.centerId] : allowed;
  const list = await CashClosing.find({
    organizationId: user.organization.id,
    centerId: { $in: centers },
    // Comparaison de texte « AAAA-MM-JJ » : l'ordre alphabétique est l'ordre chronologique.
    ...(params.fromDay ? { day: { $gte: params.fromDay } } : {}),
  })
    .sort({ day: -1 })
    .limit(params.limit ?? 60)
    .populate<{ closedBy: { firstName: string; lastName: string } | null }>("closedBy", "firstName lastName")
    .lean();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  return list.map((c) => toRow(c, names.get(String(c.centerId)) ?? "", c.closedBy ? `${c.closedBy.firstName} ${c.closedBy.lastName}` : "—"));
}

// Jour courant au format « AAAA-MM-JJ » (heure de Tunis), pour pré-remplir l'interface.
export const todayKey = () => dayKey(new Date());
