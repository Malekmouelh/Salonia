// Données de démonstration du Module 6 (paiements, factures, dépenses), dérivées des rendez-vous du seed.
// Appelé à la fin de scripts/seed.ts ; peut aussi être relancé seul : npm run db:seed:finance
// Deux anomalies sont volontairement présentes pour la démonstration de l'IA :
//  - Djerba : un jour récent sans encaissement saisi (oubli de caisse) ;
//  - Sousse : un achat de produits exceptionnel ce mois-ci.
import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { connectDB } from "../lib/db";
import { addDays, addMinutes, dayKey, fromLocal, startOfLocalDay, toLocal } from "../lib/booking/time";
import { computeTotals, formatDocNumber, roundTnd, VAT_RATE } from "../lib/finance/money";
import { Booking, Customer } from "../lib/models/booking";
import { Center, Organization, User } from "../lib/models/core";
import { Expense, FinanceCounter, Invoice, Payment } from "../lib/models/finance";

let seed = 6062026;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

type Doc = Record<string, unknown>;

export async function seedFinance(organizationId: Types.ObjectId) {
  const orgKey = String(organizationId);
  await Promise.all([
    Payment.deleteMany({ organizationId }),
    Invoice.deleteMany({ organizationId }),
    Expense.deleteMany({ organizationId }),
    FinanceCounter.deleteMany({ _id: { $regex: `^${orgKey}:` } }),
  ]);
  await Promise.all([Payment, Invoice, Expense, FinanceCounter].map((m) => m.createIndexes()));

  const [centers, owner, managers, bookings] = await Promise.all([
    Center.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    User.findOne({ organizationId, role: "OWNER" }).lean(),
    User.find({ organizationId, role: "MANAGER" }).lean(),
    Booking.find({ organizationId, status: { $in: ["COMPLETED", "CONFIRMED", "PENDING"] } }).sort({ start: 1 }).lean(),
  ]);
  const customers = new Map(
    (await Customer.find({ organizationId }).select("firstName lastName phone").lean()).map((c) => [String(c._id), c]),
  );
  const now = new Date();
  const today = startOfLocalDay(now);
  const cashier = (centerId: unknown) => managers.find((m) => m.centerIds.some((id) => String(id) === String(centerId)))?._id ?? owner?._id ?? null;

  // Jour sans saisie de caisse à Djerba (anomalie « CA anormalement bas »).
  const djerba = centers.find((c) => c.governorate === "MEDENINE");
  let forgottenDay: string | null = null;
  for (let d = 5; d < 12 && djerba; d++) {
    const day = addDays(today, -d);
    if (toLocal(day).weekday !== 0 && toLocal(day).weekday !== 6) {
      forgottenDay = dayKey(day);
      break;
    }
  }

  const payments: Doc[] = [];
  const invoices: Doc[] = [];
  const method = () => {
    const r = rand();
    return r < 0.55 ? "CASH" : r < 0.85 ? "CARD" : "MOBILE";
  };

  for (const b of bookings) {
    const customer = customers.get(String(b.customerId));
    const by = cashier(b.centerId);
    const base = { organizationId, centerId: b.centerId, bookingId: b._id, customerId: b.customerId, status: "PAID", receivedBy: by };
    // Acompte pris à la réservation pour les prestations chères.
    const deposit = b.totalTnd >= 80 && rand() < 0.5 ? Math.ceil(b.totalTnd * 0.3) : 0;
    const depositAt = new Date(Math.min((b.createdAt as Date).getTime() + 10 * 60_000, b.start.getTime() - 3600_000));
    // Hors des heures d'ouverture, l'acompte ne peut avoir été réglé qu'en ligne.
    const hour = toLocal(depositAt).hour;
    const depositMethod = hour < 9 || hour >= 20 || rand() < 0.4 ? "ONLINE" : method();
    if (deposit && depositAt < now) payments.push({ ...base, _id: new Types.ObjectId(), kind: "DEPOSIT", method: depositMethod, amountTnd: deposit, paidAt: depositAt, reference: depositMethod === "ONLINE" ? `SBX-${Math.floor(rand() * 1e10).toString(16).toUpperCase()}` : undefined });

    if (b.status !== "COMPLETED" || b.end > now) continue;
    const isForgotten = djerba && String(b.centerId) === String(djerba._id) && dayKey(b.start) === forgottenDay;
    // Quelques prestations récentes restent à encaisser (liste « Impayés » de la caisse).
    const unpaid = isForgotten || (b.start > addDays(today, -3) && rand() < 0.12);
    if (unpaid) continue;

    const discount = rand() < 0.06 ? roundTnd(b.totalTnd * pick([0.1, 0.15, 0.2])) : 0;
    const due = roundTnd(b.totalTnd - discount - deposit);
    const paidAt = addMinutes(b.end, Math.floor(rand() * 10));
    const invoiceId = new Types.ObjectId();
    const split = due > 60 && rand() < 0.1;
    const parts = split ? [roundTnd(due / 2), roundTnd(due - roundTnd(due / 2))] : [due];
    for (const amount of parts) {
      const m = method();
      payments.push({ ...base, _id: new Types.ObjectId(), invoiceId, kind: "PAYMENT", method: m, amountTnd: amount, paidAt, reference: m === "CARD" ? `TPE-${Math.floor(rand() * 900000 + 100000)}` : undefined });
    }
    if (deposit) payments.filter((p) => String(p.bookingId) === String(b._id) && p.kind === "DEPOSIT").forEach((p) => (p.invoiceId = invoiceId));
    const lines = b.packId
      ? [{ label: b.packName ?? "Pack", quantity: 1, unitPriceTnd: b.totalTnd }]
      : b.items.map((i) => ({ label: i.name, quantity: 1, unitPriceTnd: i.priceTnd, serviceId: String(i.serviceId) }));
    const totals = computeTotals(lines, discount);
    invoices.push({
      _id: invoiceId,
      organizationId,
      centerId: b.centerId,
      bookingId: b._id,
      customerId: b.customerId,
      customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Client",
      customerPhone: customer?.phone,
      ...totals,
      lines: totals.lines.map((l) => ({ ...l, serviceId: l.serviceId ? new Types.ObjectId(l.serviceId) : null })),
      vatRate: VAT_RATE,
      paidTnd: totals.totalTnd,
      status: "PAID",
      issuedAt: paidAt,
      issuedBy: by,
    });
  }

  // Ventes directes (produits revendus, clients de passage) : 2 à 4 par semaine et par centre.
  const PRODUCTS: [string, number][] = [["Shampooing professionnel", 28], ["Masque kératine", 45], ["Sérum pointes", 38], ["Vernis semi-permanent", 18], ["Coupe homme (sans RDV)", 20]];
  for (const c of centers) {
    for (let d = -70; d < 0; d++) {
      if (rand() > 0.45) continue;
      const day = addDays(today, d);
      if (toLocal(day).weekday === 0 && c.governorate !== "MEDENINE") continue;
      const [label, price] = pick(PRODUCTS);
      const quantity = rand() < 0.2 ? 2 : 1;
      const totals = computeTotals([{ label, quantity, unitPriceTnd: price }]);
      const paidAt = addMinutes(day, 11 * 60 + Math.floor(rand() * 420));
      const invoiceId = new Types.ObjectId();
      invoices.push({ _id: invoiceId, organizationId, centerId: c._id, customerName: "Client de passage", ...totals, vatRate: VAT_RATE, paidTnd: totals.totalTnd, status: "PAID", issuedAt: paidAt, issuedBy: cashier(c._id) });
      payments.push({ _id: new Types.ObjectId(), organizationId, centerId: c._id, invoiceId, kind: "PAYMENT", method: method(), status: "PAID", amountTnd: totals.totalTnd, paidAt, receivedBy: cashier(c._id) });
    }
  }

  // Remboursements (gestes commerciaux) : environ 1 % des paiements.
  const refundable = payments.filter((p) => p.kind === "PAYMENT" && p.bookingId && rand() < 0.01);
  for (const p of refundable) {
    payments.push({
      _id: new Types.ObjectId(),
      organizationId,
      centerId: p.centerId,
      bookingId: p.bookingId,
      customerId: p.customerId,
      invoiceId: p.invoiceId,
      kind: "REFUND",
      method: p.method === "ONLINE" ? "CASH" : p.method,
      status: "PAID",
      amountTnd: roundTnd((p.amountTnd as number) * 0.5),
      paidAt: addDays(p.paidAt as Date, 1),
      receivedBy: cashier(p.centerId),
      note: "Geste commercial (client insatisfait)",
      refundOf: p._id,
    });
  }

  // Numérotation séquentielle par année, dans l'ordre chronologique.
  const counters = new Map<string, number>();
  const number = (prefix: "FAC" | "REC", at: Date) => {
    const year = toLocal(at).year;
    const key = `${orgKey}:${prefix}:${year}`;
    const seq = (counters.get(key) ?? 0) + 1;
    counters.set(key, seq);
    return formatDocNumber(prefix, year, seq);
  };
  invoices.sort((a, b) => (a.issuedAt as Date).getTime() - (b.issuedAt as Date).getTime()).forEach((i) => (i.number = number("FAC", i.issuedAt as Date)));
  payments.sort((a, b) => (a.paidAt as Date).getTime() - (b.paidAt as Date).getTime()).forEach((p) => (p.receiptNumber = number("REC", p.paidAt as Date)));

  await Invoice.insertMany(invoices);
  await Payment.insertMany(payments);
  await FinanceCounter.insertMany([...counters].map(([_id, seq]) => ({ _id, seq })));

  // ── Dépenses : 4 mois (mois en cours compris) ──
  const p = toLocal(now);
  const RENT: Record<string, number> = { TUNIS: 2400, SOUSSE: 1700, MEDENINE: 1500 };
  const staffCount = new Map<string, number>();
  for (const u of await User.find({ organizationId, role: { $in: ["STAFF", "MANAGER"] } }).select("centerIds").lean()) {
    for (const id of u.centerIds) staffCount.set(String(id), (staffCount.get(String(id)) ?? 0) + 1);
  }
  const expenses: Doc[] = [];
  for (let m = 3; m >= 0; m--) {
    const month = p.month - m <= 0 ? p.month - m + 12 : p.month - m;
    const year = p.month - m <= 0 ? p.year - 1 : p.year;
    const first = fromLocal(year, month, 1);
    const at = (day: number) => {
      const d = addDays(first, day - 1);
      return d <= today ? d : null;
    };
    const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Africa/Tunis" }).format(addDays(first, 3));
    for (const c of centers) {
      const add = (day: number, category: string, label: string, amountTnd: number, extra: Doc = {}) => {
        const date = at(day);
        if (date) expenses.push({ organizationId, centerId: c._id, category, label, amountTnd: roundTnd(amountTnd), date, createdBy: owner?._id, ...extra });
      };
      add(1, "RENT", `Loyer ${monthLabel}`, RENT[c.governorate] ?? 1500, { method: "TRANSFER", supplier: "Propriétaire du local" });
      add(28, "SALARIES", `Salaires ${monthLabel}`, (staffCount.get(String(c._id)) ?? 2) * 1150, { method: "TRANSFER" });
      add(10, "UTILITIES", "STEG (électricité)", 180 + rand() * 120, { method: "CASH", supplier: "STEG" });
      add(12, "UTILITIES", "SONEDE (eau) et internet", 110 + rand() * 40, { method: "CASH" });
      add(5, "PRODUCTS", "Colorations et oxydants", 380 + rand() * 140, { method: "CHECK", supplier: "L'Oréal Professionnel Tunisie" });
      add(19, "PRODUCTS", "Consommables (gants, serviettes, vernis)", 160 + rand() * 90, { method: "CASH", supplier: "Grossiste Beauté Sfax" });
      if (rand() < 0.6) add(15, "MARKETING", "Publicité Instagram / Facebook", 120 + rand() * 100, { method: "CARD", supplier: "Meta" });
      if (rand() < 0.25) add(22, "EQUIPMENT", "Petit matériel (brosses, ciseaux)", 90 + rand() * 150, { method: "CASH" });
    }
  }
  // Achat exceptionnel à Sousse ce mois-ci (anomalie « dépense inhabituelle »).
  const sousse = centers.find((c) => c.governorate === "SOUSSE");
  if (sousse) {
    expenses.push({ organizationId, centerId: sousse._id, category: "PRODUCTS", label: "Stock annuel kératine et lisseurs", amountTnd: 2650, date: addDays(today, -2), method: "CHECK", supplier: "Distributeur Kératine Pro", createdBy: owner?._id });
  }
  await Expense.insertMany(expenses);

  const revenue = payments.reduce((n, x) => n + (x.kind === "REFUND" ? -(x.amountTnd as number) : (x.amountTnd as number)), 0);
  console.log(`  Finances : ${payments.length} paiements (${Math.round(revenue)} DT), ${invoices.length} factures, ${expenses.length} dépenses`);
  if (forgottenDay) console.log(`  Anomalies de démo : caisse non saisie à Djerba le ${forgottenDay}, gros achat de produits à Sousse`);
}

// Exécution directe : npm run db:seed:finance (sur l'organisation de démo existante).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/seed-finance.ts")) {
  (async () => {
    await connectDB();
    const org = await Organization.findOne({ slug: "salon-yasmine" }).lean();
    if (!org) throw new Error("Organisation de démo introuvable : lancez d'abord npm run db:seed");
    await seedFinance(org._id);
    console.log("✔ Données financières de démo créées");
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
