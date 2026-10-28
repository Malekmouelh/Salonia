// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/models/finance.ts — LE MODÈLE DE DONNÉES DU MODULE 6
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   Ce fichier décrit comment les données financières sont rangées dans MongoDB.
//   Avec Mongoose, un « schéma » (Schema) décrit les champs d'un document (≈ une ligne
//   d'une table SQL), et un « modèle » (Model) est l'objet qu'on utilise dans le code pour
//   lire/écrire cette collection (ex. Payment.find(...), Invoice.create(...)).
//
// LES 4 COLLECTIONS DU MODULE
//   1. payments        : chaque mouvement d'argent (encaissement, acompte, remboursement)
//   2. invoices        : les factures numérotées
//   3. expenses        : les dépenses du salon (loyer, produits, salaires…)
//   4. financecounters : des compteurs pour numéroter les factures/reçus sans doublon
//
// RELATIONS (voir le cahier des charges §9) :
//   Organisation → Centre → { Payment, Invoice, Expense } ; un Payment peut référencer
//   une Réservation (Booking du module 3), un Client (Customer) et une Facture (Invoice).
//
// RÈGLE D'OR MULTI-SALONS : TOUS les documents portent `organizationId` (l'identifiant du
//   salon/de la marque). Chaque requête filtre dessus → un salon ne voit jamais les
//   données d'un autre (exigence « isolation multi-tenant » du cahier des charges §7).
// ═══════════════════════════════════════════════════════════════════════════
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
// Les listes de valeurs autorisées (enums) sont définies une seule fois dans lib/enums.ts
// et réutilisées ici (validation en base) et dans l'interface (listes déroulantes).
import {
  EXPENSE_CATEGORIES,
  INVOICE_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from "@/lib/enums";

// Module 6 : Paiements, factures et pilotage financier (Salsabil).
// Collections : payments, invoices, expenses, financecounters.
// Montants en dinars tunisiens (3 décimales : millimes), toujours arrondis avec roundTnd().
// (roundTnd est dans lib/finance/money.ts : il évite les erreurs d'arrondi des nombres à virgule.)

// `ObjectId` est le type Mongo des identifiants (clés étrangères entre collections).
const { ObjectId } = Schema.Types;

// Fabrique un modèle Mongoose en évitant de le déclarer deux fois.
// POURQUOI : en développement, Next.js recharge les fichiers à chaud ; sans cette précaution,
// Mongoose lèverait l'erreur « Cannot overwrite model once compiled ». On réutilise donc le
// modèle déjà enregistré (mongoose.models[name]) s'il existe, sinon on le crée.
// `InferSchemaType` déduit automatiquement les types TypeScript à partir du schéma.
function model<T extends Schema>(name: string, schema: T) {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

// ───────────────────────────── PAYMENT ─────────────────────────────
// F6.1 / F6.2 — Encaissement, acompte ou remboursement.
// Un « Payment » = UN mouvement d'argent. Un client qui paie en deux fois (espèces + carte)
// génère donc DEUX documents Payment. Un remboursement est aussi un Payment (kind = REFUND)
// avec un montant POSITIF : c'est le champ `kind` qui dit qu'on doit le soustraire.
const PaymentSchema = new Schema(
  {
    // À quel salon (organisation) et à quel centre appartient ce paiement.
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    // Liens facultatifs (default: null) : une vente directe n'a pas de réservation,
    // un client de passage n'a pas de fiche client, et la facture n'existe pas encore pour un acompte.
    bookingId: { type: ObjectId, ref: "Booking", default: null },
    customerId: { type: ObjectId, ref: "Customer", default: null },
    invoiceId: { type: ObjectId, ref: "Invoice", default: null },
    // Nature du mouvement : DEPOSIT (acompte), PAYMENT (encaissement), REFUND (remboursement).
    kind: { type: String, enum: PAYMENT_KINDS, required: true },
    // Moyen : CASH (espèces), CARD (carte), MOBILE (paiement mobile), ONLINE (en ligne).
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    // PENDING = lien de paiement créé mais pas encore payé ; PAID = argent reçu ;
    // FAILED / CANCELLED = échec ou lien remplacé. Seuls les PAID comptent dans les chiffres.
    status: { type: String, enum: PAYMENT_STATUSES, default: "PAID" },
    // Montant en DT. `min: 0` : jamais négatif (le sens est porté par `kind`).
    amountTnd: { type: Number, required: true, min: 0 },
    // Reçu numéroté (REC-2026-00001), attribué quand le paiement est confirmé.
    receiptNumber: { type: String, default: null },
    // Référence externe : n° de transaction TPE, D17, Flouci, passerelle en ligne…
    reference: String,
    // Motif libre (utilisé pour les remboursements : « geste commercial »…).
    note: String,
    // Qui a encaissé (utilisateur connecté) : sert à limiter le staff à SES encaissements.
    receivedBy: { type: ObjectId, ref: "User", default: null },
    // Date/heure où l'argent a été reçu (null tant que le paiement est PENDING).
    paidAt: { type: Date, default: null },
    // Paiement en ligne : jeton (haché) du lien envoyé au client et date d'expiration.
    // On ne stocke JAMAIS le jeton en clair, seulement son empreinte SHA-256 : si la base fuite,
    // personne ne peut reconstituer les liens de paiement. `default: undefined` évite d'enregistrer
    // un champ vide pour les paiements au comptoir (nécessaire pour l'index « sparse » plus bas).
    gatewayTokenHash: { type: String, default: undefined },
    gatewayExpiresAt: Date,
    // Remboursement : paiement d'origine.
    refundOf: { type: ObjectId, ref: "Payment", default: null },
    // Sécurité du paiement en ligne : nombre d'essais de carte ratés sur ce lien. Au-delà de
    // MAX_ONLINE_ATTEMPTS (service.ts), le lien est verrouillé (protection contre le test de cartes volées).
    gatewayAttempts: { type: Number, default: 0 },
  },
  // `timestamps: true` ajoute automatiquement createdAt et updatedAt.
  { timestamps: true },
);
// INDEX : ils accélèrent les requêtes fréquentes (comme un index de livre).
// 1) Tableau de bord : paiements d'un salon, par statut, du plus récent au plus ancien.
PaymentSchema.index({ organizationId: 1, status: 1, paidAt: -1 });
// 2) Caisse : paiements d'un centre par date.
PaymentSchema.index({ centerId: 1, paidAt: -1 });
// 3) Retrouver les paiements d'une réservation (calcul du solde).
PaymentSchema.index({ bookingId: 1 });
// 4) Retrouver un paiement par le jeton de son lien. `unique` = pas deux liens identiques ;
//    `sparse` = les paiements SANS jeton (comptoir) sont ignorés par l'index.
PaymentSchema.index({ gatewayTokenHash: 1 }, { unique: true, sparse: true });
// 5) Unicité du numéro de reçu dans un salon. L'index est « partiel » : il ne s'applique qu'aux
//    documents dont le numéro est une chaîne (les paiements PENDING ont receiptNumber = null).
PaymentSchema.index({ organizationId: 1, receiptNumber: 1 }, { unique: true, partialFilterExpression: { receiptNumber: { $type: "string" } } });
export const Payment = model("Payment", PaymentSchema);

// ───────────────────────────── INVOICE ─────────────────────────────
// Une ligne de facture (« sous-document » : elle vit à l'intérieur de la facture, pas dans sa
// propre collection). `_id: false` : pas besoin d'identifiant propre pour chaque ligne.
const InvoiceLineSchema = new Schema(
  {
    label: { type: String, required: true },
    serviceId: { type: ObjectId, ref: "Service", default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceTnd: { type: Number, required: true, min: 0 },
    totalTnd: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// F6.3 — Facture numérotée (FAC-2026-00001). Les montants sont TTC ; la TVA incluse est recalculée à l'affichage.
// TTC = toutes taxes comprises. On ne stocke que le TTC ; le HT et la TVA se déduisent par calcul
// (voir vatBreakdown dans money.ts), ce qui évite toute incohérence entre les trois montants.
const InvoiceSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    // Numéro lisible et unique (FAC-2026-00042), généré par nextNumber() dans service.ts.
    number: { type: String, required: true },
    bookingId: { type: ObjectId, ref: "Booking", default: null },
    customerId: { type: ObjectId, ref: "Customer", default: null },
    // Copie au moment de l'émission : la facture ne change pas si la fiche client change.
    // (Une facture est un document légal : elle doit rester figée.)
    customerName: { type: String, required: true },
    customerPhone: String,
    lines: { type: [InvoiceLineSchema], required: true },
    // sous-total = somme des lignes ; total = sous-total − remise.
    subtotalTnd: { type: Number, required: true },
    discountTnd: { type: Number, default: 0 },
    totalTnd: { type: Number, required: true },
    // Taux de TVA appliqué au moment de l'émission (19 % en Tunisie), conservé sur la facture.
    vatRate: { type: Number, default: 0.19 },
    // Montant réellement réglé à ce jour (utile pour l'affichage « Reste à payer »).
    paidTnd: { type: Number, default: 0 },
    // ISSUED = émise mais pas soldée ; PAID = soldée ; CANCELLED = annulée (jamais supprimée).
    status: { type: String, enum: INVOICE_STATUSES, default: "ISSUED" },
    issuedAt: { type: Date, required: true },
    issuedBy: { type: ObjectId, ref: "User", default: null },
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true },
);
// Le numéro de facture est unique PAR SALON (deux salons peuvent avoir chacun leur FAC-2026-00001).
InvoiceSchema.index({ organizationId: 1, number: 1 }, { unique: true });
// Liste des factures du plus récent au plus ancien.
InvoiceSchema.index({ organizationId: 1, issuedAt: -1 });
// Retrouver la facture d'une réservation.
InvoiceSchema.index({ bookingId: 1 });
export const Invoice = model("Invoice", InvoiceSchema);

// ───────────────────────────── EXPENSE ─────────────────────────────
// F6.4 — Dépense d'un centre (loyer, produits, salaires…).
const ExpenseSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    // Catégorie (loyer, produits, salaires…) : sert à la répartition du tableau de bord.
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    // Description libre (« Loyer octobre », « Colorations L'Oréal »…). `trim` retire les espaces superflus.
    label: { type: String, required: true, trim: true },
    amountTnd: { type: Number, required: true, min: 0 },
    // Date de la dépense (pas la date de saisie) : sert au calcul par mois/période.
    date: { type: Date, required: true },
    // Moyen de règlement : ceux des paiements + virement et chèque (fréquents pour les charges).
    method: { type: String, enum: [...PAYMENT_METHODS, "TRANSFER", "CHECK"], default: "CASH" },
    supplier: String,
    createdBy: { type: ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
// Dépenses d'un salon / d'un centre, de la plus récente à la plus ancienne.
ExpenseSchema.index({ organizationId: 1, date: -1 });
ExpenseSchema.index({ centerId: 1, date: -1 });
export const Expense = model("Expense", ExpenseSchema);

// ───────────────────────────── COMPTEURS ─────────────────────────────
// Compteurs de numérotation séquentielle (incrément atomique) : _id = "<organisation>:<FAC|REC>:<année>".
// Exemple de document : { _id: "64ab…:FAC:2026", seq: 42 } = la 42e facture de 2026 de ce salon.
// « Atomique » = MongoDB garantit que deux encaissements simultanés recevront deux numéros
// DIFFÉRENTS (voir nextNumber() dans service.ts, qui utilise $inc).
const FinanceCounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
export const FinanceCounter = model("FinanceCounter", FinanceCounterSchema);

// ───────────────────────────── PARAMÈTRES FINANCIERS ─────────────────────────────
// Un seul document par salon (index unique sur organizationId). Il regroupe les réglages que le
// propriétaire peut modifier : taux de TVA, mentions légales des factures, droits du staff, etc.
// Si aucun document n'existe, les valeurs par défaut (ci-dessous) s'appliquent : voir settings.ts.
const FinanceSettingsSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true, unique: true },
    // Taux de TVA appliqué aux NOUVELLES factures (0.19 = 19 %). Les factures déjà émises gardent le leur.
    vatRate: { type: Number, default: 0.19, min: 0, max: 0.5 },
    // Matricule fiscal du salon, imprimé sur les factures (obligation légale en Tunisie).
    taxId: { type: String, trim: true, maxlength: 40 },
    // Texte libre en pied de facture (mentions légales, conditions de paiement, RIB…).
    invoiceFooter: { type: String, trim: true, maxlength: 300 },
    // Pourcentage d'acompte proposé par défaut à la caisse (cahier §4 : acomptes de réservation).
    defaultDepositPercent: { type: Number, default: 30, min: 0, max: 100 },
    // Le staff a-t-il le droit d'encaisser ? (cahier §4 : « encaisser selon ses droits »)
    staffCanCollect: { type: Boolean, default: true },
    // Le salon propose-t-il le paiement en ligne ? (cahier F1.2 : fonctionnalités activables)
    onlinePaymentsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const FinanceSettings = model("FinanceSettings", FinanceSettingsSchema);

// ───────────────────────────── CLÔTURE DE CAISSE ─────────────────────────────
// En fin de journée, le gérant compte les espèces du tiroir-caisse et les compare à ce que le système
// attend : c'est la « clôture de caisse ». La différence s'appelle l'ÉCART DE CAISSE ; des écarts
// répétés sont un signal de vol, d'erreur de rendu de monnaie ou d'oubli d'enregistrement.
const CashClosingSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    centerId: { type: ObjectId, ref: "Center", required: true },
    // Jour clôturé au format « 2026-10-27 » (heure de Tunis). Texte plutôt que Date : pas d'ambiguïté de fuseau.
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // Totaux NETS attendus par moyen de paiement ce jour-là (remboursements déduits), figés à la clôture.
    expected: {
      type: [new Schema({ method: { type: String, enum: PAYMENT_METHODS, required: true }, amountTnd: { type: Number, required: true } }, { _id: false })],
      default: [],
    },
    expectedCashTnd: { type: Number, required: true }, // espèces attendues dans le tiroir
    countedCashTnd: { type: Number, required: true, min: 0 }, // espèces réellement comptées
    varianceTnd: { type: Number, required: true }, // écart = compté − attendu (négatif = il manque de l'argent)
    note: { type: String, trim: true, maxlength: 300 },
    closedBy: { type: ObjectId, ref: "User", default: null },
    closedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
// Une seule clôture par centre et par jour : une deuxième tentative est refusée par la base elle-même.
CashClosingSchema.index({ centerId: 1, day: 1 }, { unique: true });
CashClosingSchema.index({ organizationId: 1, day: -1 });
export const CashClosing = model("CashClosing", CashClosingSchema);
