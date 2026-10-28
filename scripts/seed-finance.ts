// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : scripts/seed-finance.ts — LES DONNÉES DE DÉMONSTRATION DU MODULE 6
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE : une application vide est impossible à démontrer (pas de graphique, pas d'alerte). Ce script
// FABRIQUE un historique financier réaliste à partir des rendez-vous existants (créés par le seed du
// module 3) : paiements, acomptes, factures, remboursements, ventes directes et dépenses.
//
// IL RESTE COHÉRENT AVEC LES RÈGLES MÉTIER : montants calculés avec les mêmes fonctions que
// l'application (computeTotals, roundTnd), numérotation séquentielle FAC-/REC- dans l'ordre
// chronologique, compteurs enregistrés pour que les NOUVEAUX numéros continuent la suite.
//
// DONNÉES « DÉTERMINISTES » : le générateur pseudo-aléatoire est initialisé avec une graine fixe
// (`seed`), donc on obtient EXACTEMENT les mêmes données à chaque exécution → démonstrations et tests
// reproductibles.
//
// COMMENT L'EXÉCUTER : `npm run db:seed` (le seed complet l'appelle à la fin), ou seul :
// `npm run db:seed:finance`.
// ═══════════════════════════════════════════════════════════════════════════

// Données de démonstration du Module 6 (paiements, factures, dépenses), dérivées des rendez-vous du seed.
// Appelé à la fin de scripts/seed.ts ; peut aussi être relancé seul : npm run db:seed:finance
// Deux anomalies sont volontairement présentes pour la démonstration de l'IA :
//  - Djerba : un jour récent sans encaissement saisi (oubli de caisse) ;
//  - Sousse : un achat de produits exceptionnel ce mois-ci.
import "dotenv/config"; // charge le fichier .env (adresse de la base MongoDB…)
import mongoose, { Types } from "mongoose";
import { connectDB } from "../lib/db";
import { addDays, addMinutes, dayKey, fromLocal, startOfLocalDay, toLocal } from "../lib/booking/time";
import { computeTotals, formatDocNumber, roundTnd, VAT_RATE } from "../lib/finance/money";
import { Booking, Customer } from "../lib/models/booking";
import { Center, Organization, User } from "../lib/models/core";
import { CashClosing, Expense, FinanceCounter, FinanceSettings, Invoice, Payment } from "../lib/models/finance";
import { cashVariance } from "../lib/finance/money";

// GÉNÉRATEUR PSEUDO-ALÉATOIRE reproductible (« générateur congruentiel linéaire »).
// Formule classique : suivant = (a × précédent + c) mod m. Avec la même graine de départ, la suite de
// nombres est toujours la même. `rand()` renvoie un nombre entre 0 et 1, comme Math.random() mais prévisible.
let seed = 6062026;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
// Choisit un élément au hasard dans une liste (avec le générateur ci-dessus).
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

// Un document « générique » (objet clé → valeur) : on construit les données à la volée, avant insertion.
type Doc = Record<string, unknown>;

export async function seedFinance(organizationId: Types.ObjectId) {
  const orgKey = String(organizationId);
  // ── 1. Nettoyage : on supprime les anciennes données financières de CE salon (pas celles des autres). ──
  await Promise.all([
    Payment.deleteMany({ organizationId }),
    Invoice.deleteMany({ organizationId }),
    Expense.deleteMany({ organizationId }),
    CashClosing.deleteMany({ organizationId }),
    FinanceSettings.deleteMany({ organizationId }),
    FinanceCounter.deleteMany({ _id: { $regex: `^${orgKey}:` } }), // compteurs dont l'identifiant commence par l'id du salon
  ]);
  // Crée les index déclarés dans le modèle (unicité des numéros de facture/reçu…) s'ils n'existent pas.
  await Promise.all([Payment, Invoice, Expense, FinanceCounter, CashClosing, FinanceSettings].map((m) => m.createIndexes()));

  // ── 2. Lecture des données existantes (centres, propriétaire, gérants, rendez-vous, clients). ──
  const [centers, owner, managers, bookings] = await Promise.all([
    Center.find({ organizationId }).sort({ createdAt: 1 }).lean(),
    User.findOne({ organizationId, role: "OWNER" }).lean(),
    User.find({ organizationId, role: "MANAGER" }).lean(),
    Booking.find({ organizationId, status: { $in: ["COMPLETED", "CONFIRMED", "PENDING"] } }).sort({ start: 1 }).lean(),
  ]);
  // Dictionnaire id client → fiche client, pour retrouver rapidement le nom (évite une requête par facture).
  const customers = new Map(
    (await Customer.find({ organizationId }).select("firstName lastName phone").lean()).map((c) => [String(c._id), c]),
  );
  const now = new Date();
  const today = startOfLocalDay(now);
  // « Caissier » d'un centre : son gérant s'il en a un, sinon le propriétaire.
  const cashier = (centerId: unknown) => managers.find((m) => m.centerIds.some((id) => String(id) === String(centerId)))?._id ?? owner?._id ?? null;

  // ── 3. Anomalie volontaire n°1 : un jour récent (en semaine, il y a 5 à 11 jours) où la caisse de
  //       Djerba n'a rien enregistré → l'IA doit détecter « chiffre d'affaires anormalement bas ». ──
  // Jour sans saisie de caisse à Djerba (anomalie « CA anormalement bas »).
  const djerba = centers.find((c) => c.governorate === "MEDENINE");
  let forgottenDay: string | null = null;
  for (let d = 5; d < 12 && djerba; d++) {
    const day = addDays(today, -d);
    // On évite dimanche (0) et samedi (6) : jours atypiques, ça rendrait la détection moins nette.
    if (toLocal(day).weekday !== 0 && toLocal(day).weekday !== 6) {
      forgottenDay = dayKey(day);
      break;
    }
  }

  const payments: Doc[] = [];
  const invoices: Doc[] = [];
  // Moyen de paiement au hasard : 55 % espèces, 30 % carte, 15 % mobile (reflète les usages locaux).
  const method = () => {
    const r = rand();
    return r < 0.55 ? "CASH" : r < 0.85 ? "CARD" : "MOBILE";
  };

  // ── 4. Pour chaque rendez-vous, on génère acompte + paiement + facture. ──
  for (const b of bookings) {
    const customer = customers.get(String(b.customerId));
    const by = cashier(b.centerId);
    // Champs communs à tous les paiements de ce rendez-vous.
    const base = { organizationId, centerId: b.centerId, bookingId: b._id, customerId: b.customerId, status: "PAID", receivedBy: by };
    // Acompte pris à la réservation pour les prestations chères.
    // 1 prestation sur 2 à partir de 80 DT : acompte de 30 % (arrondi au dinar supérieur).
    const deposit = b.totalTnd >= 80 && rand() < 0.5 ? Math.ceil(b.totalTnd * 0.3) : 0;
    // Date de l'acompte : 10 minutes après la réservation, mais au plus tard 1 h avant le rendez-vous.
    const depositAt = new Date(Math.min((b.createdAt as Date).getTime() + 10 * 60_000, b.start.getTime() - 3600_000));
    // Hors des heures d'ouverture, l'acompte ne peut avoir été réglé qu'en ligne.
    const hour = toLocal(depositAt).hour;
    const depositMethod = hour < 9 || hour >= 20 || rand() < 0.4 ? "ONLINE" : method();
    // On n'enregistre l'acompte que s'il est dans le passé (un acompte « futur » n'existe pas encore).
    if (deposit && depositAt < now) payments.push({ ...base, _id: new Types.ObjectId(), kind: "DEPOSIT", method: depositMethod, amountTnd: deposit, paidAt: depositAt, reference: depositMethod === "ONLINE" ? `SBX-${Math.floor(rand() * 1e10).toString(16).toUpperCase()}` : undefined });

    // Seules les prestations TERMINÉES et passées sont encaissées/facturées ; les autres s'arrêtent ici.
    if (b.status !== "COMPLETED" || b.end > now) continue;
    const isForgotten = djerba && String(b.centerId) === String(djerba._id) && dayKey(b.start) === forgottenDay;
    // Quelques prestations récentes restent à encaisser (liste « Impayés » de la caisse).
    // Impayé si c'est le jour « oublié » de Djerba, ou (12 % de chance) pour une prestation des 3 derniers jours.
    const unpaid = isForgotten || (b.start > addDays(today, -3) && rand() < 0.12);
    if (unpaid) continue;

    // Remise : 6 % des prestations bénéficient de 10, 15 ou 20 %.
    const discount = rand() < 0.06 ? roundTnd(b.totalTnd * pick([0.1, 0.15, 0.2])) : 0;
    // Reste à payer à la fin de la prestation = total − remise − acompte déjà versé.
    const due = roundTnd(b.totalTnd - discount - deposit);
    const paidAt = addMinutes(b.end, Math.floor(rand() * 10)); // payé 0 à 9 minutes après la fin
    const invoiceId = new Types.ObjectId();
    // 10 % des gros règlements (> 60 DT) sont fractionnés en deux paiements (deux moyens différents possibles).
    const split = due > 60 && rand() < 0.1;
    const parts = split ? [roundTnd(due / 2), roundTnd(due - roundTnd(due / 2))] : [due];
    for (const amount of parts) {
      const m = method();
      payments.push({ ...base, _id: new Types.ObjectId(), invoiceId, kind: "PAYMENT", method: m, amountTnd: amount, paidAt, reference: m === "CARD" ? `TPE-${Math.floor(rand() * 900000 + 100000)}` : undefined });
    }
    // On rattache l'éventuel acompte à la facture (comme le fait l'application).
    if (deposit) payments.filter((p) => String(p.bookingId) === String(b._id) && p.kind === "DEPOSIT").forEach((p) => (p.invoiceId = invoiceId));
    // Lignes de facture : une ligne au prix du pack, ou une ligne par service.
    const lines = b.packId
      ? [{ label: b.packName ?? "Pack", quantity: 1, unitPriceTnd: b.totalTnd }]
      : b.items.map((i) => ({ label: i.name, quantity: 1, unitPriceTnd: i.priceTnd, serviceId: String(i.serviceId) }));
    const totals = computeTotals(lines, discount); // MÊME fonction que l'application
    invoices.push({
      _id: invoiceId,
      organizationId,
      centerId: b.centerId,
      bookingId: b._id,
      customerId: b.customerId,
      customerName: customer ? `${customer.firstName} ${customer.lastName}` : "Client",
      customerPhone: customer?.phone,
      ...totals,
      // Les identifiants de service doivent être de vrais ObjectId MongoDB (et non du texte).
      lines: totals.lines.map((l) => ({ ...l, serviceId: l.serviceId ? new Types.ObjectId(l.serviceId) : null })),
      vatRate: VAT_RATE,
      paidTnd: totals.totalTnd,
      status: "PAID",
      issuedAt: paidAt,
      issuedBy: by,
    });
  }

  // ── 5. Ventes directes (sans rendez-vous). ──
  // Ventes directes (produits revendus, clients de passage) : 2 à 4 par semaine et par centre.
  const PRODUCTS: [string, number][] = [["Shampooing professionnel", 28], ["Masque kératine", 45], ["Sérum pointes", 38], ["Vernis semi-permanent", 18], ["Coupe homme (sans RDV)", 20]];
  for (const c of centers) {
    // Pour chacun des 70 derniers jours : 45 % de chance d'une vente.
    for (let d = -70; d < 0; d++) {
      if (rand() > 0.45) continue;
      const day = addDays(today, d);
      // Fermé le dimanche, sauf à Djerba (ouvert le dimanche).
      if (toLocal(day).weekday === 0 && c.governorate !== "MEDENINE") continue;
      const [label, price] = pick(PRODUCTS);
      const quantity = rand() < 0.2 ? 2 : 1;
      const totals = computeTotals([{ label, quantity, unitPriceTnd: price }]);
      // Heure de la vente : entre 11 h et 18 h.
      const paidAt = addMinutes(day, 11 * 60 + Math.floor(rand() * 420));
      const invoiceId = new Types.ObjectId();
      invoices.push({ _id: invoiceId, organizationId, centerId: c._id, customerName: "Client de passage", ...totals, vatRate: VAT_RATE, paidTnd: totals.totalTnd, status: "PAID", issuedAt: paidAt, issuedBy: cashier(c._id) });
      payments.push({ _id: new Types.ObjectId(), organizationId, centerId: c._id, invoiceId, kind: "PAYMENT", method: method(), status: "PAID", amountTnd: totals.totalTnd, paidAt, receivedBy: cashier(c._id) });
    }
  }

  // ── 6. Remboursements. ──
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
      method: p.method === "ONLINE" ? "CASH" : p.method, // un paiement en ligne est remboursé en espèces
      status: "PAID",
      amountTnd: roundTnd((p.amountTnd as number) * 0.5), // remboursement de la moitié
      paidAt: addDays(p.paidAt as Date, 1), // le lendemain du paiement
      receivedBy: cashier(p.centerId),
      note: "Geste commercial (client insatisfait)",
      refundOf: p._id, // lien vers le paiement d'origine
    });
  }

  // ── 7. Numérotation séquentielle. ──
  // Numérotation séquentielle par année, dans l'ordre chronologique.
  // Même logique que nextNumber() dans service.ts, mais en mémoire (on numérote en bloc avant l'insertion).
  const counters = new Map<string, number>();
  const number = (prefix: "FAC" | "REC", at: Date) => {
    const year = toLocal(at).year;
    const key = `${orgKey}:${prefix}:${year}`;
    const seq = (counters.get(key) ?? 0) + 1;
    counters.set(key, seq);
    return formatDocNumber(prefix, year, seq);
  };
  // On TRIE par date puis on numérote dans l'ordre : la plus ancienne facture est la n° 1, etc.
  invoices.sort((a, b) => (a.issuedAt as Date).getTime() - (b.issuedAt as Date).getTime()).forEach((i) => (i.number = number("FAC", i.issuedAt as Date)));
  payments.sort((a, b) => (a.paidAt as Date).getTime() - (b.paidAt as Date).getTime()).forEach((p) => (p.receiptNumber = number("REC", p.paidAt as Date)));

  // Insertion en masse (`insertMany` : beaucoup plus rapide que des milliers d'insertions séparées).
  await Invoice.insertMany(invoices);
  await Payment.insertMany(payments);
  // On enregistre l'état final des compteurs : la prochaine facture créée par l'application recevra le numéro suivant.
  await FinanceCounter.insertMany([...counters].map(([_id, seq]) => ({ _id, seq })));

  // ── 7 bis. Paramètres financiers du salon de démonstration (matricule fiscal et mentions légales des factures). ──
  await FinanceSettings.create({
    organizationId,
    vatRate: 0.19,
    taxId: "1234567/A/M/000",
    invoiceFooter: "Paiement à réception de la facture. RIB : 08 123 4567890 12 · Banque de Tunisie.",
    defaultDepositPercent: 30,
    staffCanCollect: true,
    onlinePaymentsEnabled: true,
  });

  // ── 7 ter. Clôtures de caisse des 12 derniers jours (la journée d'aujourd'hui reste ouverte pour la démo). ──
  // Le système « attend » les espèces réellement encaissées ce jour-là ; le gérant « compte » le tiroir.
  // Écarts volontaires pour la démonstration de l'IA :
  //  - Tunis : 3 manques (−18, −35, −12 DT) → alerte « écarts de caisse répétés » ;
  //  - Sousse : 1 excédent de +14 DT → alerte simple.
  // Les autres clôtures sont justes ou ont un écart minime (pièces), sous le seuil de 10 DT.
  // Les écarts sont placés sur le n-ième jour OUVRÉ (au moins 60 DT d'espèces attendues) : sur un jour
  // fermé, un manque de 18 DT serait impossible (on ne peut pas compter moins que zéro).
  const DEMO_VARIANCES: Record<string, Record<number, number>> = {
    TUNIS: { 1: -18, 3: -35, 5: -12 },
    SOUSSE: { 2: 14 },
  };
  const closings: Doc[] = [];
  for (const c of centers) {
    let openDays = 0; // nombre de jours ouvrés rencontrés pour ce centre
    for (let back = 1; back <= 12; back++) {
      const dayStart = addDays(today, -back);
      const key = dayKey(dayStart);
      // Totaux NETS par moyen de paiement ce jour-là pour ce centre (remboursements déduits).
      const byMethod = new Map<string, number>();
      for (const pay of payments) {
        if (String(pay.centerId) !== String(c._id) || pay.status !== "PAID" || dayKey(pay.paidAt as Date) !== key) continue;
        const signed = pay.kind === "REFUND" ? -(pay.amountTnd as number) : (pay.amountTnd as number);
        byMethod.set(pay.method as string, roundTnd((byMethod.get(pay.method as string) ?? 0) + signed));
      }
      const expected = [...byMethod].map(([method, amountTnd]) => ({ method, amountTnd }));
      const expectedCashTnd = byMethod.get("CASH") ?? 0;
      const isOpenDay = expectedCashTnd >= 60;
      const planned = isOpenDay ? DEMO_VARIANCES[c.governorate]?.[openDays] : undefined;
      if (isOpenDay) openDays++;
      const tiny = planned === undefined && rand() < 0.2 ? pick([-3, -2, -1, 1, 2]) : 0; // pièces mal rendues, sous le seuil
      const variance = planned ?? tiny;
      const counted = Math.max(0, roundTnd(expectedCashTnd + variance));
      closings.push({
        organizationId,
        centerId: c._id,
        day: key,
        expected,
        expectedCashTnd,
        countedCashTnd: counted,
        varianceTnd: cashVariance(expectedCashTnd, counted),
        note: variance < -10 ? "Écart constaté à la fermeture, vérification en cours." : undefined,
        closedBy: cashier(c._id),
        closedAt: addMinutes(dayStart, 19 * 60 + 30),
      });
    }
  }
  await CashClosing.insertMany(closings);

  // ── 8. Dépenses : 4 mois (mois en cours compris) ──
  const p = toLocal(now);
  // Loyer mensuel par gouvernorat (Tunis est plus cher que Sousse ou Djerba).
  const RENT: Record<string, number> = { TUNIS: 2400, SOUSSE: 1700, MEDENINE: 1500 };
  // Effectif par centre (gérant + staff) pour estimer la masse salariale.
  const staffCount = new Map<string, number>();
  for (const u of await User.find({ organizationId, role: { $in: ["STAFF", "MANAGER"] } }).select("centerIds").lean()) {
    for (const id of u.centerIds) staffCount.set(String(id), (staffCount.get(String(id)) ?? 0) + 1);
  }
  const expenses: Doc[] = [];
  // m = 3, 2, 1, 0 : il y a 3 mois, 2 mois, 1 mois, ce mois-ci.
  for (let m = 3; m >= 0; m--) {
    // Calcul du mois cible en gérant le passage d'une année à l'autre (ex. janvier − 2 → novembre de l'année précédente).
    const month = p.month - m <= 0 ? p.month - m + 12 : p.month - m;
    const year = p.month - m <= 0 ? p.year - 1 : p.year;
    const first = fromLocal(year, month, 1); // 1er jour de ce mois
    // `at(n)` : date du n-ième jour du mois, ou null si elle est dans le futur (on ne crée pas de dépense future).
    const at = (day: number) => {
      const d = addDays(first, day - 1);
      return d <= today ? d : null;
    };
    const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Africa/Tunis" }).format(addDays(first, 3)); // « octobre »
    for (const c of centers) {
      // Ajoute une dépense à ce centre à un jour donné du mois (ignorée si la date est future).
      const add = (day: number, category: string, label: string, amountTnd: number, extra: Doc = {}) => {
        const date = at(day);
        if (date) expenses.push({ organizationId, centerId: c._id, category, label, amountTnd: roundTnd(amountTnd), date, createdBy: owner?._id, ...extra });
      };
      // Charges FIXES chaque mois (loyer le 1er, salaires le 28 à 1 150 DT par personne), et charges
      // VARIABLES avec un peu de hasard (électricité, eau, produits, publicité, petit matériel).
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
  // ── 9. Anomalie volontaire n°2 : un achat de 2 650 DT à Sousse il y a 2 jours (≈ 9 fois la dépense
  //       habituelle en produits) → l'IA doit détecter « dépense inhabituelle » et « catégorie en hausse ». ──
  // Achat exceptionnel à Sousse ce mois-ci (anomalie « dépense inhabituelle »).
  const sousse = centers.find((c) => c.governorate === "SOUSSE");
  if (sousse) {
    expenses.push({ organizationId, centerId: sousse._id, category: "PRODUCTS", label: "Stock annuel kératine et lisseurs", amountTnd: 2650, date: addDays(today, -2), method: "CHECK", supplier: "Distributeur Kératine Pro", createdBy: owner?._id });
  }
  await Expense.insertMany(expenses);

  // ── 10. Résumé affiché dans la console. ──
  const revenue = payments.reduce((n, x) => n + (x.kind === "REFUND" ? -(x.amountTnd as number) : (x.amountTnd as number)), 0);
  console.log(`  Clôtures de caisse : ${closings.length} (écarts de démo à Tunis et Sousse)`);
  console.log(`  Finances : ${payments.length} paiements (${Math.round(revenue)} DT), ${invoices.length} factures, ${expenses.length} dépenses`);
  if (forgottenDay) console.log(`  Anomalies de démo : caisse non saisie à Djerba le ${forgottenDay}, gros achat de produits à Sousse`);
}

// Exécution directe : npm run db:seed:finance (sur l'organisation de démo existante).
// Ce bloc ne s'exécute QUE si ce fichier est lancé directement (et non quand seed.ts l'importe) :
// on compare le fichier lancé (`process.argv[1]`) à ce script. Le `replace` convertit les « \ » de
// Windows en « / » pour que la comparaison marche sur tous les systèmes.
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
      process.exitCode = 1; // signale l'échec au système (code de sortie ≠ 0)
    })
    .finally(() => mongoose.disconnect()); // ferme la connexion à la base dans tous les cas
}
