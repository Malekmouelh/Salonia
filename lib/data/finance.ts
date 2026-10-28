// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/data/finance.ts — LES LECTURES DE DONNÉES POUR LES PAGES
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Les pages (caisse, factures, dépenses, page de paiement) ont besoin de données prêtes à
//   afficher. Ce fichier va les chercher dans MongoDB et les met en forme :
//     • les identifiants deviennent du texte (`String(_id)`),
//     • les dates deviennent du texte ISO (`toISOString()`),
//   car un « Server Component » ne peut transmettre à un « Client Component » que des données
//   « sérialisables » (texte, nombres, booléens) : ni ObjectId MongoDB, ni objet Date.
//   Ici, on LIT seulement (les écritures sont dans lib/finance/service.ts).
//
// DIFFÉRENCE AVEC reports.ts : reports.ts calcule des statistiques (sommes, moyennes) ; ce fichier
// renvoie des LISTES détaillées (une ligne par rendez-vous, par facture, par dépense).
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import { Types } from "mongoose";
import { addDays, dayKey, parseDayKey, startOfLocalDay } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import type { CurrentUser } from "@/lib/dal";
import { EXPENSE_CATEGORIES, INVOICE_STATUSES, PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_STATUSES, type BookingStatus, type ExpenseCategory, type InvoiceStatus, type PaymentKind, type PaymentMethod, type PaymentStatus } from "@/lib/enums";
import { Booking } from "@/lib/models/booking";
import { Expense, Invoice, Payment } from "@/lib/models/finance";
import { netPaid, roundTnd, sumTnd } from "@/lib/finance/money";
import { canViewFinance, clientCustomerIds, financeCenterIds, hashPaymentToken } from "@/lib/finance/service";
import { Center, Organization } from "@/lib/models/core";

// Lectures du Module 6 pour les pages (données sérialisables).

// Convertit un identifiant texte en ObjectId (nécessaire dans les filtres qui contournent la conversion automatique).
const oid = (id: string) => new Types.ObjectId(id);

// Choisit le centre à afficher dans la caisse : celui demandé s'il est autorisé, sinon le premier
// centre autorisé, sinon null. Évite qu'on passe un identifiant de centre interdit dans l'adresse.
export function resolveFinanceCenter(user: CurrentUser, centerId?: string | null) {
  const allowed = financeCenterIds(user);
  if (centerId && allowed.includes(centerId)) return centerId;
  return allowed[0] ?? null;
}

// Un rendez-vous tel qu'il apparaît dans la caisse (avec ce qui est déjà payé et ce qui reste dû).
export type CashDeskBooking = {
  id: string;
  start: string; // date de début au format ISO (texte)
  status: BookingStatus;
  customer: string;
  phone: string;
  staff: string;
  services: string;
  totalTnd: number;
  paidTnd: number; // déjà payé (acomptes…)
  dueTnd: number; // reste à payer
  invoice: { id: string; number: string } | null; // facture déjà émise ?
  pendingLink: boolean; // un lien de paiement en ligne est-il en attente ?
};

// Une ligne du journal de caisse.
export type CashPayment = {
  id: string;
  paidAt: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amountTnd: number;
  receiptNumber: string | null;
  label: string; // nom du client
  reference: string | null;
  refundable: number; // montant encore remboursable sur ce paiement
};

// F6.1 — Caisse d'un centre pour une journée : rendez-vous à encaisser, acomptes possibles
// sur les 7 prochains jours, impayés des 14 derniers jours, et journal des paiements du jour.
export async function getCashDesk(user: CurrentUser, centerId: string, dayParam?: string) {
  if (!user.organization) return null;
  await connectDB();
  // Jour affiché : celui de l'adresse (?day=2026-10-17) s'il est valide, sinon aujourd'hui.
  // (`a && b || c` : si dayParam est vide ou invalide, on retombe sur aujourd'hui.)
  const day = (dayParam && parseDayKey(dayParam)) || startOfLocalDay(new Date());
  const organizationId = user.organization.id;
  // Un membre du staff ne voit que SES rendez-vous : on ajoute un filtre sur le praticien.
  // `...staffOnly` insère ce filtre dans la requête (ou rien du tout pour les autres rôles).
  const staffOnly = user.role === "STAFF" ? { staffId: oid(user.id) } : {};

  // Rendez-vous non annulés, de 14 jours avant à 7 jours après le jour affiché.
  // `populate` = « jointure » : remplace l'identifiant du client/du praticien par ses informations.
  const bookings = await Booking.find({
    organizationId,
    centerId,
    ...staffOnly,
    status: { $ne: "CANCELLED" },
    start: { $gte: addDays(day, -14), $lt: addDays(day, 8) },
  })
    .sort({ start: 1 })
    .populate<{ customerId: { firstName: string; lastName: string; phone: string } }>("customerId", "firstName lastName phone")
    .populate<{ staffId: { firstName: string } }>("staffId", "firstName")
    .lean();

  // Une seule requête pour TOUS les paiements et factures de ces rendez-vous (`$in`), plutôt qu'une
  // requête par rendez-vous : c'est beaucoup plus rapide (évite le problème dit « N+1 »).
  const ids = bookings.map((b) => b._id);
  const [payments, invoices] = await Promise.all([
    Payment.find({ bookingId: { $in: ids }, status: { $in: ["PAID", "PENDING"] } }).select("bookingId kind amountTnd status method").lean(),
    Invoice.find({ bookingId: { $in: ids }, status: { $ne: "CANCELLED" } }).select("bookingId number discountTnd").lean(),
  ]);

  // Pour chaque rendez-vous, on retrouve ses paiements et sa facture, et on calcule le reste à payer.
  const rows: CashDeskBooking[] = bookings.map((b) => {
    const mine = payments.filter((p) => String(p.bookingId) === String(b._id));
    const paid = netPaid(mine); // netPaid ignore les paiements non confirmés (PENDING)
    const invoice = invoices.find((i) => String(i.bookingId) === String(b._id));
    return {
      id: String(b._id),
      start: b.start.toISOString(),
      status: b.status as BookingStatus,
      customer: `${b.customerId.firstName} ${b.customerId.lastName}`,
      phone: b.customerId.phone,
      staff: b.staffId.firstName,
      services: b.packName ?? b.items.map((i) => i.name).join(" + "),
      totalTnd: b.totalTnd,
      paidTnd: paid,
      // Facturé = plus rien à payer ; sinon total − déjà payé (jamais négatif).
      dueTnd: invoice ? 0 : Math.max(0, roundTnd(b.totalTnd - paid)),
      invoice: invoice ? { id: String(invoice._id), number: invoice.number } : null,
      pendingLink: mine.some((p) => p.status === "PENDING" && p.method === "ONLINE"),
    };
  });

  // On répartit les rendez-vous dans les trois sections de la page.
  const dayEnd = addDays(day, 1);
  // « Du jour » : début entre minuit et minuit.
  const todayRows = rows.filter((r) => new Date(r.start) >= day && new Date(r.start) < dayEnd);
  // Impayés : prestations passées réalisées (ou non marquées) sans facture.
  // (On exclut les absences « NO_SHOW » et les rendez-vous « PENDING » non confirmés.)
  const unpaid = rows.filter((r) => new Date(r.start) < day && r.dueTnd > 0 && r.status !== "NO_SHOW" && r.status !== "PENDING");
  // À venir : rendez-vous futurs sur lesquels un acompte est encore possible.
  const upcoming = rows.filter((r) => new Date(r.start) >= dayEnd && r.dueTnd > 0);

  const journal = await getCashJournal(user, centerId, day);
  // `...journal` ajoute les champs payments, totals et totalTnd au résultat.
  return { day: dayKey(day), today: todayRows, unpaid, upcoming, ...journal };
}

// Journal de caisse du jour et totaux par moyen de paiement (clôture de caisse).
export async function getCashJournal(user: CurrentUser, centerId: string, day: Date) {
  const list = await Payment.find({
    organizationId: user.organization!.id,
    centerId,
    status: "PAID",
    paidAt: { $gte: day, $lt: addDays(day, 1) },
    // Le staff ne voit que les paiements qu'il a encaissés lui-même.
    ...(user.role === "STAFF" ? { receivedBy: user.id } : {}),
  })
    .sort({ paidAt: -1 }) // du plus récent au plus ancien
    .populate<{ customerId: { firstName: string; lastName: string } | null }>("customerId", "firstName lastName")
    .lean();
  // Pour chaque paiement du jour, combien a DÉJÀ été remboursé ? (somme des remboursements qui le visent)
  const refunded = await Payment.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { refundOf: { $in: list.map((p) => p._id) }, status: "PAID" } },
    { $group: { _id: "$refundOf", total: { $sum: "$amountTnd" } } },
  ]);
  const payments: CashPayment[] = list.map((p) => ({
    id: String(p._id),
    paidAt: p.paidAt!.toISOString(),
    kind: p.kind as PaymentKind,
    method: p.method as PaymentMethod,
    amountTnd: p.amountTnd,
    receiptNumber: p.receiptNumber ?? null,
    label: p.customerId ? `${p.customerId.firstName} ${p.customerId.lastName}` : "Client de passage",
    reference: p.reference ?? null,
    // Remboursable = montant payé − déjà remboursé (0 pour un remboursement lui-même, qui ne se rembourse pas).
    refundable: p.kind === "REFUND" ? 0 : roundTnd(p.amountTnd - (refunded.find((r) => String(r._id) === String(p._id))?.total ?? 0)),
  }));
  // Totaux par moyen de paiement (clôture de caisse) : les remboursements sont soustraits.
  const totals = new Map<PaymentMethod, number>();
  for (const p of payments) totals.set(p.method, roundTnd((totals.get(p.method) ?? 0) + (p.kind === "REFUND" ? -p.amountTnd : p.amountTnd)));
  return {
    payments,
    totals: [...totals].map(([method, amount]) => ({ method, amount })),
    totalTnd: sumTnd([...totals.values()]),
  };
}

// Une ligne de la liste des factures.
export type InvoiceRow = {
  id: string;
  number: string;
  issuedAt: string;
  center: string;
  customerName: string;
  totalTnd: number;
  paidTnd: number;
  discountTnd: number;
  status: InvoiceStatus;
  lines: string; // résumé des prestations (« Coupe, 2 × Brushing »)
  cancelReason: string | null;
};

// F6.3 — Liste des factures (recherche par numéro ou client, filtre par statut et centre).
export async function listInvoices(
  user: CurrentUser,
  params: { q?: string; status?: string; centerId?: string; from?: Date; to?: Date; limit?: number },
): Promise<InvoiceRow[]> {
  // Seuls propriétaire et gérant consultent les factures (le staff reçoit une liste vide).
  if (!user.organization || !canViewFinance(user)) return [];
  await connectDB();
  const allowed = financeCenterIds(user);
  // Centre demandé s'il est autorisé, sinon tous les centres autorisés.
  const centers = params.centerId && allowed.includes(params.centerId) ? [params.centerId] : allowed;
  const q = params.q?.trim(); // texte recherché, sans espaces autour
  // SÉCURITÉ : on « échappe » les caractères spéciaux d'expression régulière (. * + ? ( ) [ ] …).
  // Sans cela, un utilisateur pourrait saisir une expression qui ralentit la base (attaque « ReDoS »)
  // ou fausse la recherche. `\\$&` ajoute un antislash devant chaque caractère spécial.
  const escaped = q?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Construction du filtre : chaque `...(condition ? {…} : {})` n'ajoute le critère que s'il est demandé.
  const list = await Invoice.find({
    organizationId: user.organization.id,
    centerId: { $in: centers },
    // Statut : on vérifie qu'il fait partie des valeurs connues avant de l'utiliser.
    ...(params.status && (INVOICE_STATUSES as readonly string[]).includes(params.status) ? { status: params.status as InvoiceStatus } : {}),
    // Période (début et/ou fin).
    ...(params.from || params.to ? { issuedAt: { ...(params.from ? { $gte: params.from } : {}), ...(params.to ? { $lt: params.to } : {}) } } : {}),
    // Recherche textuelle : le numéro OU le nom du client contient le texte ($regex, option "i" = sans casse).
    ...(escaped ? { $or: [{ number: { $regex: escaped, $options: "i" } }, { customerName: { $regex: escaped, $options: "i" } }] } : {}),
  })
    .sort({ issuedAt: -1 })
    .limit(params.limit ?? 100) // limite le nombre de lignes (100 par défaut)
    .lean();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  return list.map((i) => ({
    id: String(i._id),
    number: i.number,
    issuedAt: i.issuedAt.toISOString(),
    center: names.get(String(i.centerId)) ?? "",
    customerName: i.customerName,
    totalTnd: i.totalTnd,
    paidTnd: i.paidTnd,
    discountTnd: i.discountTnd ?? 0,
    status: i.status as InvoiceStatus,
    lines: i.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.label}` : l.label)).join(", "),
    cancelReason: i.cancelReason ?? null,
  }));
}

// Une ligne de la liste des dépenses.
export type ExpenseRowData = {
  id: string;
  date: string;
  centerId: string;
  center: string;
  category: ExpenseCategory;
  label: string;
  amountTnd: number;
  method: string;
  supplier: string | null;
};

// F6.4 — Dépenses d'une période.
export async function listExpenses(user: CurrentUser, params: { centerId?: string; from: Date; to: Date; category?: string }): Promise<ExpenseRowData[]> {
  if (!user.organization || !canViewFinance(user)) return [];
  await connectDB();
  const allowed = financeCenterIds(user);
  const centers = params.centerId && allowed.includes(params.centerId) ? [params.centerId] : allowed;
  const list = await Expense.find({
    organizationId: user.organization.id,
    centerId: { $in: centers },
    date: { $gte: params.from, $lt: params.to },
    // Filtre de catégorie, après vérification qu'elle est valide.
    ...(params.category && (EXPENSE_CATEGORIES as readonly string[]).includes(params.category) ? { category: params.category as ExpenseCategory } : {}),
  })
    .sort({ date: -1, createdAt: -1 }) // plus récentes d'abord ; à date égale, la dernière saisie d'abord
    .limit(500)
    .lean();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  return list.map((e) => ({
    id: String(e._id),
    date: dayKey(e.date),
    centerId: String(e.centerId),
    center: names.get(String(e.centerId)) ?? "",
    category: e.category as ExpenseCategory,
    label: e.label,
    amountTnd: e.amountTnd,
    method: e.method ?? "CASH",
    supplier: e.supplier ?? null,
  }));
}

// Paiements d'une période (export CSV).
export async function listPayments(user: CurrentUser, params: { centerIds: string[]; from: Date; to: Date }) {
  if (!user.organization) return [];
  await connectDB();
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  const list = await Payment.find({
    organizationId: user.organization.id,
    centerId: { $in: params.centerIds },
    status: "PAID",
    paidAt: { $gte: params.from, $lt: params.to },
  })
    .sort({ paidAt: 1 }) // ordre chronologique (du plus ancien au plus récent)
    .populate<{ customerId: { firstName: string; lastName: string } | null }>("customerId", "firstName lastName")
    .populate<{ invoiceId: { number: string } | null }>("invoiceId", "number")
    .lean();
  return list.map((p) => ({
    paidAt: p.paidAt!,
    receiptNumber: p.receiptNumber ?? "",
    invoiceNumber: p.invoiceId?.number ?? "",
    center: names.get(String(p.centerId)) ?? "",
    customer: p.customerId ? `${p.customerId.firstName} ${p.customerId.lastName}` : "Client de passage",
    kind: p.kind as PaymentKind,
    method: p.method as PaymentMethod,
    status: p.status as PaymentStatus,
    // Un remboursement est exporté en NÉGATIF pour que la colonne « Montant » s'additionne correctement dans Excel.
    amountTnd: p.kind === "REFUND" ? -p.amountTnd : p.amountTnd,
    reference: p.reference ?? "",
  }));
}

// F6.2 — Page publique de paiement : résumé du lien (sans donnée sensible du salon).
// Cette fonction est appelée SANS utilisateur connecté (c'est le client qui ouvre son lien).
// Elle ne renvoie donc que le strict nécessaire : prénom, prestation, montant, nom du salon.
export async function getPaymentLink(token: string) {
  // Format du jeton : 20 à 64 caractères parmi lettres, chiffres, « _ » et « - » (c'est du base64url).
  // On rejette tout de suite les valeurs absurdes, sans même interroger la base.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  await connectDB();
  // On retrouve le paiement par l'EMPREINTE du jeton (le jeton en clair n'est jamais en base).
  const payment = await Payment.findOne({ gatewayTokenHash: hashPaymentToken(token) }).lean();
  if (!payment || !payment.bookingId) return null;
  const [booking, org, center] = await Promise.all([
    Booking.findById(payment.bookingId).select("items packName start status").populate<{ customerId: { firstName: string } }>("customerId", "firstName").lean(),
    Organization.findById(payment.organizationId).select("name").lean(),
    Center.findById(payment.centerId).select("name").lean(),
  ]);
  if (!booking) return null;
  // Lien expiré = encore « PENDING » mais date d'expiration dépassée. (`!!` convertit en vrai booléen.)
  const expired = payment.status === "PENDING" && !!payment.gatewayExpiresAt && payment.gatewayExpiresAt < new Date();
  return {
    salon: org?.name ?? "Salon",
    center: center?.name ?? "",
    firstName: booking.customerId?.firstName ?? "",
    services: booking.packName ?? booking.items.map((i) => i.name).join(" + "),
    start: booking.start.toISOString(),
    kind: payment.kind as PaymentKind,
    amountTnd: payment.amountTnd,
    status: (expired ? "EXPIRED" : payment.status) as PaymentStatus | "EXPIRED",
    bookingCancelled: booking.status === "CANCELLED",
    receiptNumber: payment.receiptNumber ?? null,
    expiresAt: payment.gatewayExpiresAt?.toISOString() ?? null,
  };
}

// ───────────────────────── Historique des paiements (F6.1, F6.2) ─────────────────────────

// Une ligne de l'historique : un paiement quel que soit son statut (payé, en attente de lien, échoué, annulé).
export type PaymentHistoryRow = {
  id: string;
  at: string; // date du paiement, ou de création du lien s'il n'est pas encore payé
  kind: PaymentKind;
  method: PaymentMethod;
  status: PaymentStatus;
  amountTnd: number;
  receiptNumber: string | null;
  customer: string;
  center: string;
  reference: string | null;
  invoiceNumber: string | null;
  refundable: number; // montant encore remboursable (0 si non payé ou déjà remboursé)
  expiresAt: string | null; // expiration du lien de paiement en ligne
  attempts: number; // essais de carte ratés sur le lien
};

// Liste filtrable des paiements (propriétaire et gérant) : recherche par n° de reçu ou référence,
// filtres moyen / nature / statut / centre / période. C'est la vue « registre » complète des mouvements d'argent.
export async function listPaymentHistory(
  user: CurrentUser,
  params: { q?: string; method?: string; kind?: string; status?: string; centerId?: string; from: Date; to: Date; limit?: number },
): Promise<PaymentHistoryRow[]> {
  if (!user.organization || !canViewFinance(user)) return [];
  await connectDB();
  const allowed = financeCenterIds(user);
  const centers = params.centerId && allowed.includes(params.centerId) ? [params.centerId] : allowed;
  // Même protection que pour les factures : on échappe les caractères spéciaux d'expression régulière.
  const escaped = params.q?.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const list = await Payment.find({
    organizationId: user.organization.id,
    centerId: { $in: centers },
    createdAt: { $gte: params.from, $lt: params.to },
    ...(params.method && (PAYMENT_METHODS as readonly string[]).includes(params.method) ? { method: params.method as PaymentMethod } : {}),
    ...(params.kind && (PAYMENT_KINDS as readonly string[]).includes(params.kind) ? { kind: params.kind as PaymentKind } : {}),
    ...(params.status && (PAYMENT_STATUSES as readonly string[]).includes(params.status) ? { status: params.status as PaymentStatus } : {}),
    ...(escaped ? { $or: [{ receiptNumber: { $regex: escaped, $options: "i" } }, { reference: { $regex: escaped, $options: "i" } }] } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(params.limit ?? 200)
    .populate<{ customerId: { firstName: string; lastName: string } | null }>("customerId", "firstName lastName")
    .populate<{ invoiceId: { number: string } | null }>("invoiceId", "number")
    .lean();
  // Montants déjà remboursés, par paiement d'origine (pour calculer ce qui reste remboursable).
  const refunded = await Payment.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { refundOf: { $in: list.map((p) => p._id) }, status: "PAID" } },
    { $group: { _id: "$refundOf", total: { $sum: "$amountTnd" } } },
  ]);
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  return list.map((p) => ({
    id: String(p._id),
    at: (p.paidAt ?? (p.createdAt as Date)).toISOString(),
    kind: p.kind as PaymentKind,
    method: p.method as PaymentMethod,
    status: p.status as PaymentStatus,
    amountTnd: p.amountTnd,
    receiptNumber: p.receiptNumber ?? null,
    customer: p.customerId ? `${p.customerId.firstName} ${p.customerId.lastName}` : "Client de passage",
    center: names.get(String(p.centerId)) ?? "",
    reference: p.reference ?? null,
    invoiceNumber: p.invoiceId?.number ?? null,
    refundable:
      p.status === "PAID" && p.kind !== "REFUND" ? roundTnd(p.amountTnd - (refunded.find((r) => String(r._id) === String(p._id))?.total ?? 0)) : 0,
    expiresAt: p.gatewayExpiresAt?.toISOString() ?? null,
    attempts: p.gatewayAttempts ?? 0,
  }));
}

// ───────────────────────── Espace client : « Mes paiements » ─────────────────────────

export type MyInvoice = { id: string; number: string; issuedAt: string; center: string; totalTnd: number; paidTnd: number; status: InvoiceStatus; lines: string };
export type MyPayment = { id: string; paidAt: string; kind: PaymentKind; method: PaymentMethod; amountTnd: number; receiptNumber: string; center: string };

// Factures et reçus d'un compte CLIENT (cahier §4 : « consulter son historique »).
// Isolation : on ne lit QUE les documents rattachés à SES fiches client (clientCustomerIds).
export async function getMyFinance(user: CurrentUser): Promise<{ invoices: MyInvoice[]; payments: MyPayment[] }> {
  const ids = await clientCustomerIds(user);
  if (!user.organization || ids.length === 0) return { invoices: [], payments: [] };
  const names = new Map(user.organization.centers.map((c) => [c.id, c.name]));
  const [invoices, payments] = await Promise.all([
    Invoice.find({ organizationId: user.organization.id, customerId: { $in: ids } }).sort({ issuedAt: -1 }).limit(50).lean(),
    Payment.find({ organizationId: user.organization.id, customerId: { $in: ids }, status: "PAID", receiptNumber: { $ne: null } })
      .sort({ paidAt: -1 })
      .limit(50)
      .lean(),
  ]);
  return {
    invoices: invoices.map((i) => ({
      id: String(i._id),
      number: i.number,
      issuedAt: i.issuedAt.toISOString(),
      center: names.get(String(i.centerId)) ?? "",
      totalTnd: i.totalTnd,
      paidTnd: i.paidTnd,
      status: i.status as InvoiceStatus,
      lines: i.lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.label}` : l.label)).join(", "),
    })),
    payments: payments.map((p) => ({
      id: String(p._id),
      paidAt: p.paidAt!.toISOString(),
      kind: p.kind as PaymentKind,
      method: p.method as PaymentMethod,
      amountTnd: p.amountTnd,
      receiptNumber: p.receiptNumber!,
      center: names.get(String(p.centerId)) ?? "",
    })),
  };
}

