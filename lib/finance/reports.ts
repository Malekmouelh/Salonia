// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/reports.ts — LES CALCULS DU TABLEAU DE BORD (F6.5)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Interroge la base pour produire les chiffres affichés : CA, dépenses, résultat, panier
//   moyen, services les plus vendus, comparaison entre centres, CA par jour… Il prépare aussi
//   les données que l'IA (analytics.ts) analyse (prévision, anomalies).
//
// CONCEPT CLÉ : le « pipeline d'agrégation » MongoDB (`aggregate`)
//   Plutôt que de ramener 2 000 paiements en mémoire pour les additionner en JavaScript, on
//   demande à MongoDB de calculer lui-même : c'est beaucoup plus rapide. Un pipeline est une
//   suite d'étapes :
//     $match  = filtrer (comme WHERE en SQL)
//     $group  = regrouper et calculer des sommes/comptages (comme GROUP BY)
//     $unwind = « déplier » un tableau (une ligne par élément)
//     $lookup = jointure avec une autre collection (comme JOIN)
//     $project= choisir/renommer les champs
//
// SÉCURITÉ : toutes les requêtes passent par un « Scope » (périmètre) qui contient l'organisation
//   ET la liste des centres autorisés → impossible de lire les données d'un autre salon/centre.
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import { Types } from "mongoose";
import { addDays, dayKey, fromLocal, parseDayKey, startOfLocalDay, startOfLocalMonth, toLocal } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type PaymentMethod } from "@/lib/enums";
import { CashClosing, Expense, Invoice, Payment } from "@/lib/models/finance";
import { EXPENSE_LABELS } from "./labels";
import { roundTnd } from "./money";
import { financeCenterIds } from "./service";
import {
  cashAnomalies,
  closingAnomalies,
  expenseAnomalies,
  forecastMonth,
  revenueAnomalies,
  type Anomaly,
  type DayPoint,
  type Forecast,
} from "./analytics";

// Requêtes financières contrôlées : toujours filtrées par organisation ET par centres autorisés.
// Utilisées par le tableau de bord, les exports et l'assistant IA (qui n'écrit jamais de requête lui-même).

// Fuseau horaire du salon : sert à découper les « jours » selon l'heure de Tunis (pas l'heure UTC).
const TZ = "Africa/Tunis";
// Convertit un identifiant texte en ObjectId. Obligatoire dans `aggregate` : contrairement à `find`,
// Mongoose ne convertit PAS automatiquement les types dans un pipeline d'agrégation.
const oid = (id: string) => new Types.ObjectId(id);

// Le « périmètre » d'une requête : quel salon, quels centres (identifiants + noms).
export type Scope = { organizationId: string; centerIds: string[]; centers: { id: string; name: string }[] };

// Périmètre de l'utilisateur, éventuellement réduit à un centre.
// Renvoie null si l'utilisateur n'a accès à aucun centre (ou si le centre demandé n'est pas le sien).
export function financeScope(user: CurrentUser, centerId?: string | null): Scope | null {
  if (!user.organization) return null;
  const allowed = financeCenterIds(user); // centres autorisés pour son rôle
  if (allowed.length === 0) return null;
  // Si un centre précis est demandé, on ne le garde QUE s'il fait partie des centres autorisés.
  // (« all » ou rien = tous les centres autorisés → vue consolidée.)
  const centerIds = centerId && centerId !== "all" ? allowed.filter((id) => id === centerId) : allowed;
  if (centerIds.length === 0) return null;
  return {
    organizationId: user.organization.id,
    centerIds,
    centers: user.organization.centers.filter((c) => centerIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name })),
  };
}

// Une période : début (inclus), fin (EXCLUE), libellé affiché et clé technique.
export type Range = { from: Date; to: Date; label: string; key: string };

// Périodes proposées dans la liste déroulante des filtres.
export const PERIODS = [
  { key: "month", label: "Ce mois-ci" },
  { key: "last-month", label: "Mois dernier" },
  { key: "30d", label: "30 derniers jours" },
  { key: "90d", label: "90 derniers jours" },
  { key: "year", label: "Cette année" },
] as const;

// Période nommée, ou dates libres « YYYY-MM-DD » (fin incluse).
// Convention : `to` est toujours EXCLUE (début du lendemain) : « jusqu'à aujourd'hui inclus »
// s'écrit donc `to = demain 00:00`, ce qui évite les erreurs d'une minute près.
export function resolveRange(period?: string | null, fromKey?: string | null, toKey?: string | null, now = new Date()): Range {
  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  // Dates libres (optionnelles) : parseDayKey renvoie null si le format est invalide.
  const from = fromKey ? parseDayKey(fromKey) : null;
  const to = toKey ? parseDayKey(toKey) : null;
  if (from && to && from <= to) return { from, to: addDays(to, 1), label: `${fromKey} → ${toKey}`, key: "custom" };
  const p = toLocal(now); // composantes de la date en heure de Tunis (année, mois, jour…)
  switch (period) {
    case "last-month": {
      // 1er du mois précédent (si on est en janvier, on revient en décembre de l'année d'avant).
      const start = fromLocal(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 1);
      return { from: start, to: startOfLocalMonth(now), label: "Mois dernier", key: "last-month" };
    }
    case "30d":
      return { from: addDays(tomorrow, -30), to: tomorrow, label: "30 derniers jours", key: "30d" };
    case "90d":
      return { from: addDays(tomorrow, -90), to: tomorrow, label: "90 derniers jours", key: "90d" };
    case "year":
      return { from: fromLocal(p.year, 1, 1), to: tomorrow, label: "Cette année", key: "year" };
    default:
      // Par défaut : du 1er du mois en cours jusqu'à aujourd'hui inclus.
      return { from: startOfLocalMonth(now), to: tomorrow, label: "Ce mois-ci", key: "month" };
  }
}

// Période précédente de même durée (comparaison « vs période précédente »).
// Sert aux petites flèches ▲ +12 % des indicateurs.
export function previousRange(range: Range): Range {
  if (range.key === "month" || range.key === "last-month") {
    const p = toLocal(range.from);
    const start = fromLocal(p.month === 1 ? p.year - 1 : p.year, p.month === 1 ? 12 : p.month - 1, 1);
    // Mois en cours : mêmes jours du mois précédent (du 1er au même quantième) ; mois complet sinon.
    const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000); // 86 400 000 ms = 1 jour
    const end = range.key === "month" ? addDays(start, days) : range.from;
    return { from: start, to: end > range.from ? range.from : end, label: "Période précédente", key: "previous" };
  }
  // Autres périodes : la période juste avant, de même durée.
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from, label: "Période précédente", key: "previous" };
}

// ───── Filtres $match réutilisés dans les pipelines ─────
// Chacun applique l'isolation (salon + centres autorisés) et la période.

// Paiements CONFIRMÉS (status PAID) de la période. `$in` = « parmi cette liste ».
function paymentMatch(scope: Scope, range: { from: Date; to: Date }) {
  return {
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    status: "PAID",
    paidAt: { $gte: range.from, $lt: range.to }, // $gte = ≥ (début inclus), $lt = < (fin exclue)
  };
}

// Factures non annulées de la période (une facture annulée ne compte pas dans les ventes).
function invoiceMatch(scope: Scope, range: { from: Date; to: Date }) {
  return {
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    status: { $ne: "CANCELLED" }, // $ne = « différent de »
    issuedAt: { $gte: range.from, $lt: range.to },
  };
}

// Dépenses de la période.
function expenseMatch(scope: Scope, range: { from: Date; to: Date }) {
  return {
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    date: { $gte: range.from, $lt: range.to },
  };
}

// Montant signé : les remboursements sont soustraits.
// Expression MongoDB : SI kind = "REFUND" ALORS −montant SINON +montant. Ainsi un simple $sum donne le CA net.
const signedAmount = { $cond: [{ $eq: ["$kind", "REFUND"] }, { $multiply: ["$amountTnd", -1] }, "$amountTnd"] };

// Les indicateurs d'une période (cartes en haut du tableau de bord).
export type Summary = {
  revenue: number; // CA encaissé NET (paiements + acomptes − remboursements)
  refunds: number;
  deposits: number;
  expenses: number;
  profit: number; // résultat = CA − dépenses
  margin: number | null; // marge = résultat ÷ CA (null si pas de CA)
  sales: number; // nombre de factures
  averageBasket: number; // panier moyen = total facturé ÷ nombre de factures
  subtotal: number; // total avant remises (sert à la détection de remises excessives)
  discounts: number;
  byMethod: { method: PaymentMethod; amount: number }[];
};

// F6.5 — Indicateurs d'une période : CA encaissé, dépenses, résultat, ventes, panier moyen.
export async function getSummary(scope: Scope, range: { from: Date; to: Date }): Promise<Summary> {
  await connectDB();
  // Trois agrégations indépendantes lancées EN PARALLÈLE (Promise.all) : on attend la plus lente,
  // pas la somme des trois.
  const [payments, invoices, expenses] = await Promise.all([
    // Paiements regroupés par (moyen, nature) : on obtient par exemple { CASH+PAYMENT: 5000, CARD+REFUND: 40 … }.
    Payment.aggregate<{ _id: { method: PaymentMethod; kind: string }; amount: number }>([
      { $match: paymentMatch(scope, range) },
      { $group: { _id: { method: "$method", kind: "$kind" }, amount: { $sum: "$amountTnd" } } },
    ]),
    // Factures : nombre, total TTC, sous-total, remises → 1 seul groupe (_id: null = tout regrouper).
    Invoice.aggregate<{ count: number; total: number; subtotal: number; discounts: number }>([
      { $match: invoiceMatch(scope, range) },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$totalTnd" }, subtotal: { $sum: "$subtotalTnd" }, discounts: { $sum: "$discountTnd" } } },
    ]),
    // Dépenses : total de la période.
    Expense.aggregate<{ total: number }>([{ $match: expenseMatch(scope, range) }, { $group: { _id: null, total: { $sum: "$amountTnd" } } }]),
  ]);
  // `sum(filtre)` additionne les paiements dont la nature satisfait le filtre.
  const sum = (filter: (k: string) => boolean) => payments.filter((p) => filter(p._id.kind)).reduce((n, p) => n + p.amount, 0);
  const refunds = sum((k) => k === "REFUND");
  // CA net = (acomptes + encaissements) − remboursements.
  const revenue = roundTnd(sum((k) => k !== "REFUND") - refunds);
  const expenseTotal = roundTnd(expenses[0]?.total ?? 0); // [0] = premier (et seul) groupe, absent si aucune dépense
  const inv = invoices[0] ?? { count: 0, total: 0, subtotal: 0, discounts: 0 };
  // CA net par moyen de paiement (un remboursement est soustrait de son moyen).
  const methods = new Map<PaymentMethod, number>();
  for (const p of payments) methods.set(p._id.method, (methods.get(p._id.method) ?? 0) + (p._id.kind === "REFUND" ? -p.amount : p.amount));
  return {
    revenue,
    refunds: roundTnd(refunds),
    deposits: roundTnd(sum((k) => k === "DEPOSIT")),
    expenses: expenseTotal,
    profit: roundTnd(revenue - expenseTotal),
    margin: revenue > 0 ? (revenue - expenseTotal) / revenue : null, // évite la division par zéro
    sales: inv.count,
    averageBasket: inv.count ? roundTnd(inv.total / inv.count) : 0,
    subtotal: roundTnd(inv.subtotal),
    discounts: roundTnd(inv.discounts),
    // Du moyen le plus utilisé au moins utilisé.
    byMethod: [...methods].map(([method, amount]) => ({ method, amount: roundTnd(amount) })).sort((a, b) => b.amount - a.amount),
  };
}

// CA encaissé par jour (heure de Tunis), jours sans encaissement inclus (valeur 0).
// `byCenter = true` calcule en plus une série PAR CENTRE (nécessaire à la détection d'anomalies).
export async function getDailyRevenue(scope: Scope, range: { from: Date; to: Date }, byCenter = false) {
  await connectDB();
  const rows = await Payment.aggregate<{ _id: { day: string; center: Types.ObjectId | null }; amount: number }>([
    { $match: paymentMatch(scope, range) },
    {
      $group: {
        // Clé de regroupement : le JOUR (texte « 2026-10-17 » calculé en heure de Tunis) et, si demandé, le centre.
        _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt", timezone: TZ } }, center: byCenter ? "$centerId" : null },
        amount: { $sum: signedAmount }, // CA net du jour
      },
    },
  ]);
  // La base ne renvoie que les jours AVEC encaissement : on génère la liste de TOUS les jours de la
  // période pour que les jours à 0 DT apparaissent aussi (important pour les graphiques et l'IA).
  const keys: { day: string; weekday: number }[] = [];
  for (let d = startOfLocalDay(range.from); d < range.to; d = addDays(d, 1)) keys.push({ day: dayKey(d), weekday: toLocal(d).weekday });
  // Construit la série complète pour un centre donné (ou pour l'ensemble si center === null).
  const series = (center: string | null): DayPoint[] =>
    keys.map((k) => ({
      ...k,
      value: roundTnd(rows.filter((r) => r._id.day === k.day && (center === null || String(r._id.center) === center)).reduce((n, r) => n + r.amount, 0)),
    }));
  return { total: series(null), perCenter: byCenter ? new Map(scope.centerIds.map((id) => [id, series(id)])) : null };
}

// Axes de ventilation possibles et forme d'une ligne de résultat.
export type BreakdownDimension = "service" | "center" | "staff" | "category" | "method" | "month";
export type BreakdownRow = { key: string; label: string; amount: number; count: number };

// Ventilation d'une période selon un axe (prestations, centres, praticiens, catégories de dépenses…).
// Une seule fonction pour les 6 « classements » du tableau de bord ; la branche exécutée dépend de `dimension`.
export async function getBreakdown(scope: Scope, range: { from: Date; to: Date }, dimension: BreakdownDimension, limit = 10): Promise<BreakdownRow[]> {
  await connectDB();
  const names = new Map(scope.centers.map((c) => [c.id, c.name])); // id de centre → nom
  let rows: BreakdownRow[] = [];

  if (dimension === "service") {
    // F6.5 — Services les plus demandés : lignes de factures (rendez-vous et ventes directes).
    const agg = await Invoice.aggregate<{ _id: string; amount: number; count: number }>([
      { $match: invoiceMatch(scope, range) },
      { $unwind: "$lines" }, // une ligne de résultat PAR ligne de facture (au lieu d'une par facture)
      { $group: { _id: "$lines.label", amount: { $sum: "$lines.totalTnd" }, count: { $sum: "$lines.quantity" } } },
    ]);
    rows = agg.map((r) => ({ key: r._id, label: r._id, amount: roundTnd(r.amount), count: r.count }));
  } else if (dimension === "center" || dimension === "method" || dimension === "month") {
    // Ces trois axes ne diffèrent que par le champ de regroupement.
    const field =
      dimension === "center" ? "$centerId" : dimension === "method" ? "$method" : { $dateToString: { format: "%Y-%m", date: "$paidAt", timezone: TZ } };
    const agg = await Payment.aggregate<{ _id: unknown; amount: number; count: number }>([
      { $match: paymentMatch(scope, range) },
      // count : nombre de paiements, SANS compter les remboursements (1 sauf si REFUND → 0).
      { $group: { _id: field, amount: { $sum: signedAmount }, count: { $sum: { $cond: [{ $eq: ["$kind", "REFUND"] }, 0, 1] } } } },
    ]);
    rows = agg.map((r) => {
      const key = String(r._id);
      return { key, label: dimension === "center" ? (names.get(key) ?? key) : key, amount: roundTnd(r.amount), count: r.count };
    });
    // Pour l'évolution mensuelle, on trie par date (ordre chronologique) et non par montant.
    if (dimension === "month") return rows.sort((a, b) => a.key.localeCompare(b.key));
  } else if (dimension === "staff") {
    // CA par praticien : le paiement ne connaît pas le praticien → on passe par la réservation ($lookup = jointure).
    const agg = await Payment.aggregate<{ _id: Types.ObjectId; amount: number; count: number; firstName: string; lastName: string }>([
      { $match: { ...paymentMatch(scope, range), bookingId: { $ne: null } } }, // uniquement les paiements liés à un rendez-vous
      { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "booking", pipeline: [{ $project: { staffId: 1 } }] } },
      { $unwind: "$booking" },
      // Regroupement par praticien ; `$addToSet` collecte les réservations distinctes (pour les compter).
      { $group: { _id: "$booking.staffId", amount: { $sum: signedAmount }, bookings: { $addToSet: "$bookingId" } } },
      // Deuxième jointure pour récupérer le nom du praticien.
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user", pipeline: [{ $project: { firstName: 1, lastName: 1 } }] } },
      { $unwind: "$user" },
      { $project: { amount: 1, count: { $size: "$bookings" }, firstName: "$user.firstName", lastName: "$user.lastName" } },
    ]);
    rows = agg.map((r) => ({ key: String(r._id), label: `${r.firstName} ${r.lastName}`, amount: roundTnd(r.amount), count: r.count }));
  } else if (dimension === "category") {
    // Dépenses par catégorie (loyer, produits…).
    const agg = await Expense.aggregate<{ _id: ExpenseCategory; amount: number; count: number }>([
      { $match: expenseMatch(scope, range) },
      { $group: { _id: "$category", amount: { $sum: "$amountTnd" }, count: { $sum: 1 } } },
    ]);
    rows = agg.map((r) => ({ key: r._id, label: EXPENSE_LABELS[r._id] ?? r._id, amount: roundTnd(r.amount), count: r.count }));
  }
  // Tri décroissant par montant, puis on garde les `limit` premières lignes (classement « top N »).
  return rows.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

// Une ligne du tableau « comparaison entre centres ».
export type CenterComparison = {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number | null;
  sales: number;
  averageBasket: number;
};

// F6.5 — Comparaison entre centres (vue consolidée du propriétaire).
// Pour chaque centre on recalcule les indicateurs (getSummary avec un périmètre réduit à ce centre),
// tous les centres en parallèle (Promise.all), puis on trie du plus gros CA au plus petit.
export async function compareCenters(scope: Scope, range: { from: Date; to: Date }): Promise<CenterComparison[]> {
  return Promise.all(
    scope.centers.map(async (c) => {
      const s = await getSummary({ ...scope, centerIds: [c.id], centers: [c] }, range);
      return { id: c.id, name: c.name, revenue: s.revenue, expenses: s.expenses, profit: s.profit, margin: s.margin, sales: s.sales, averageBasket: s.averageBasket };
    }),
  ).then((rows) => rows.sort((a, b) => b.revenue - a.revenue));
}

// IA — Prévision du CA du mois en cours (moyenne par jour de la semaine sur 12 semaines + tendance).
// Cette fonction PRÉPARE les données ; le calcul de la prévision est fait par forecastMonth (analytics.ts).
export async function getForecast(scope: Scope, now = new Date()): Promise<Forecast> {
  const today = startOfLocalDay(now);
  const monthStart = startOfLocalMonth(now);
  const p = toLocal(now);
  // 1er jour du mois suivant (en décembre, on passe à janvier de l'année suivante).
  const nextMonth = fromLocal(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 1 : p.month + 1, 1);
  // Historique : les 84 derniers jours (12 semaines) jusqu'à hier inclus.
  const { total } = await getDailyRevenue(scope, { from: addDays(today, -84), to: today });
  // Jours du mois déjà écoulés (déjà encaissés).
  const monthToDate = total.filter((d) => parseDayKey(d.day)! >= monthStart);
  // Jours restants du mois, aujourd'hui compris (à prévoir).
  const remaining: { day: string; weekday: number }[] = [];
  for (let d = today; d < nextMonth; d = addDays(d, 1)) remaining.push({ day: dayKey(d), weekday: toLocal(d).weekday });
  return forecastMonth(total, monthToDate, remaining);
}

// IA — Détection d'anomalies : CA journalier, dépenses, remboursements et remises.
// Rassemble les trois détecteurs de analytics.ts et leur fournit les données.
export async function getAnomalies(scope: Scope, now = new Date()): Promise<Anomaly[]> {
  await connectDB();
  const today = startOfLocalDay(now);
  const names = new Map(scope.centers.map((c) => [c.id, c.name]));
  // 1) CA journalier de chaque centre sur 70 jours (10 semaines) → anomalies de chiffre d'affaires.
  const { perCenter } = await getDailyRevenue(scope, { from: addDays(today, -70), to: today }, true);
  const anomalies: Anomaly[] = [];
  for (const [centerId, series] of perCenter!) {
    anomalies.push(...revenueAnomalies(series, { centerId, centerName: names.get(centerId) }));
  }

  // Dépenses : mois courant contre les 3 mois précédents (et 6 mois d'historique pour les dépenses isolées).
  const p = toLocal(now);
  // Liste des 7 derniers mois au format « 2026-10 », du plus récent au plus ancien
  // (le calcul `((m - 1 + 12) % 12) + 1` gère le passage de janvier à décembre de l'année précédente).
  const months = Array.from({ length: 7 }, (_, i) => {
    const m = p.month - i;
    const year = m <= 0 ? p.year - 1 : p.year;
    return `${year}-${String(((m - 1 + 12) % 12) + 1).padStart(2, "0")}`;
  });
  // On charge les dépenses depuis le 1er jour du mois le plus ancien (months[6]).
  const [y, m] = months[6].split("-").map(Number);
  const expenses = await Expense.find(expenseMatch(scope, { from: fromLocal(y, m, 1), to: addDays(today, 1) }))
    .select("centerId category label amountTnd date") // on ne charge que les champs utiles
    .lean();
  anomalies.push(
    ...expenseAnomalies(
      expenses.map((e) => ({ id: String(e._id), centerId: String(e.centerId), category: e.category, label: e.label, amountTnd: e.amountTnd, month: dayKey(e.date).slice(0, 7) })),
      months[0], // mois courant
      months.slice(1, 4), // les 3 mois précédents
      { center: (id) => names.get(id) ?? "Centre", category: (c) => EXPENSE_LABELS[c as ExpenseCategory] ?? c },
    ),
  );

  // Caisse : 30 derniers jours, par centre.
  for (const c of scope.centers) {
    const s = await getSummary({ ...scope, centerIds: [c.id], centers: [c] }, { from: addDays(today, -29), to: addDays(today, 1) });
    // `revenue + refunds` = CA brut avant remboursements (le détecteur compare les remboursements à ce brut).
    anomalies.push(...cashAnomalies({ revenue: s.revenue + s.refunds, refunds: s.refunds, subtotal: s.subtotal, discounts: s.discounts, centerId: c.id, centerName: c.name }));
    // Centre déficitaire : il encaisse, mais ses dépenses dépassent ses recettes.
    if (s.revenue > 0 && s.profit < 0) {
      anomalies.push({
        id: `margin-${c.id}`,
        severity: "high",
        kind: "NEGATIVE_MARGIN",
        title: `Centre déficitaire sur 30 jours · ${c.name}`,
        detail: `Dépenses (${Math.round(s.expenses)} DT) supérieures au chiffre d'affaires encaissé (${Math.round(s.revenue)} DT).`,
        centerId: c.id,
      });
    }
  }
  // Écarts de caisse des 30 derniers jours (clôtures validées par les gérants).
  const closings = await CashClosing.find({
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    day: { $gte: dayKey(addDays(today, -29)) },
  })
    .select("centerId day varianceTnd")
    .lean();
  anomalies.push(
    ...closingAnomalies(
      closings.map((c) => ({ id: String(c._id), centerId: String(c.centerId), day: c.day, varianceTnd: c.varianceTnd })),
      { center: (id) => names.get(id) ?? "Centre" },
    ),
  );
  // Tri : alertes « importantes » d'abord, puis les plus récentes ; on n'en garde que 12.
  const order = { high: 0, medium: 1 };
  return anomalies.sort((a, b) => order[a.severity] - order[b.severity] || (b.day ?? "").localeCompare(a.day ?? "")).slice(0, 14);
}

// Clôtures de caisse d'une période (jours « AAAA-MM-JJ », bornes incluses), pour l'assistant IA.
// Chaque ligne : le jour, le centre, les espèces attendues/comptées et l'écart. 60 lignes maximum.
export async function getClosingsInRange(scope: Scope, fromDay: string, toDay: string) {
  await connectDB();
  const names = new Map(scope.centers.map((c) => [c.id, c.name]));
  const list = await CashClosing.find({
    organizationId: oid(scope.organizationId),
    centerId: { $in: scope.centerIds.map(oid) },
    day: { $gte: fromDay, $lte: toDay },
  })
    .sort({ day: -1 })
    .limit(60)
    .lean();
  return list.map((c) => ({
    day: c.day,
    center: names.get(String(c.centerId)) ?? "",
    expectedCashTnd: c.expectedCashTnd,
    countedCashTnd: c.countedCashTnd,
    varianceTnd: c.varianceTnd,
  }));
}

// Liste {valeur, libellé} des catégories de dépenses (pour les listes déroulantes).
export const EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_LABELS[c] }));
