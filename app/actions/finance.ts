"use server";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/actions/finance.ts — LES « SERVER ACTIONS » DU MODULE 6
// ═══════════════════════════════════════════════════════════════════════════
// QU'EST-CE QU'UNE SERVER ACTION ? (nouveauté de Next.js)
//   Une fonction qui s'exécute sur le SERVEUR mais qu'un composant du navigateur peut appeler
//   comme une fonction ordinaire (ex. `await checkoutAction({...})`). Next.js gère l'appel réseau
//   en coulisse. La ligne "use server" ci-dessus marque TOUT ce fichier comme code serveur.
//
// RÔLE DU FICHIER : c'est la « porte d'entrée » sécurisée entre l'interface et la logique métier.
//   Chaque action suit le même schéma en 5 étapes :
//     1. getCurrentUser()  : QUI appelle ? (lu depuis le cookie de session signé)
//     2. contrôle du rôle  : a-t-il le droit d'utiliser cette fonction ?
//     3. validation Zod    : les données reçues ont-elles la bonne forme ? (on ne fait JAMAIS
//                            confiance au navigateur : un pirate peut envoyer n'importe quoi)
//     4. appel du service  : lib/finance/service.ts applique les règles métier
//     5. journal + rafraîchissement : on trace l'opération (logEvent) puis on recharge les pages
//
// DEUX NIVEAUX DE SÉCURITÉ : ici (rôle + format des données) ET dans service.ts (périmètre
// organisation/centre). Même si l'un était contourné, l'autre protège.
// ═══════════════════════════════════════════════════════════════════════════

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Types } from "mongoose";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import { whatsappLink } from "@/lib/booking/messages";
import { parseDayKey } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import { getCurrentUser } from "@/lib/dal";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/lib/enums";
import { financeAssistantReply, type FinanceReply } from "@/lib/finance/assistant";
import { closeCash, reopenCash } from "@/lib/finance/closing";
import { getGateway } from "@/lib/finance/gateway";
import { roundTnd } from "@/lib/finance/money";
import { financeScope } from "@/lib/finance/reports";
import { saveFinanceSettings } from "@/lib/finance/settings";
import {
  FinanceError,
  assertCenter,
  canCollect,
  canViewFinance,
  cancelInvoice,
  cancelPendingPayment,
  checkoutBooking,
  confirmOnlinePayment,
  createPaymentLink,
  directSale,
  findPendingOnlinePayment,
  invoiceSettledBooking,
  loadBookingForCheckout,
  recordDeposit,
  refundPayment,
  registerFailedAttempt,
} from "@/lib/finance/service";
import { Customer } from "@/lib/models/booking";
import { Expense } from "@/lib/models/finance";

// Server Actions du Module 6. Entrées validées avec Zod, droits revérifiés dans lib/finance/service.ts.

// Format UNIQUE de réponse de toutes les actions : succès (`ok: true`) avec un message et des
// identifiants utiles (pour ouvrir le PDF), OU échec avec un message d'erreur lisible.
// L'interface n'a qu'à regarder `error` pour savoir quoi afficher.
export type FinanceResult = {
  ok?: true;
  error?: string;
  message?: string;
  receiptId?: string; // identifiant du reçu → bouton « Voir le reçu »
  invoiceId?: string; // identifiant de la facture → bouton « Voir la facture »
  link?: string; // lien de paiement en ligne créé
  whatsapp?: string; // lien WhatsApp prérempli
  attemptsLeft?: number; // paiement en ligne : essais de carte restants avant verrouillage du lien
  closingId?: string; // clôture de caisse créée → bouton « Voir le rapport »
};

// ─────────── Schémas de validation Zod ───────────
// Zod décrit la forme attendue d'une donnée et la VÉRIFIE à l'exécution (TypeScript, lui, ne vérifie
// qu'à la compilation). `safeParse` renvoie soit les données validées, soit la liste des erreurs.

// Un montant : converti en nombre (`coerce`, accepte « 12.5 » en texte), fini, entre 0 et 1 000 000,
// puis arrondi au millime (`transform(roundTnd)`).
const amount = z.coerce.number().finite().min(0).max(1_000_000).transform(roundTnd);
// Un règlement saisi à la caisse : moyen (liste autorisée), montant, référence facultative (80 caractères max).
const TenderSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountTnd: amount,
  reference: z.string().trim().max(80).optional(),
});

// Demande à Next.js de « recharger » les pages concernées pour qu'elles affichent les nouvelles données
// (sinon l'utilisateur verrait d'anciens chiffres en cache). « layout » = toutes les pages sous /finances.
const refresh = () => {
  revalidatePath("/dashboard/finances", "layout");
  revalidatePath("/dashboard/calendar");
};

// « Enveloppe » commune d'exécution : attrape les erreurs et les transforme en réponse propre.
//   • FinanceError (règle métier non respectée) → son message est affiché tel quel à l'utilisateur.
//   • Toute autre erreur (bug, base indisponible) → message GÉNÉRIQUE pour l'utilisateur ; le détail
//     technique va seulement dans la console du serveur (on ne révèle jamais les détails internes).
async function run<T>(fn: () => Promise<T>): Promise<T | FinanceResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FinanceError) return { error: e.message };
    console.error("Module finances :", e);
    return { error: "Une erreur est survenue. Réessayez." };
  }
}

// ── F6.1 Acompte ──
const DepositSchema = z.object({ bookingId: z.string().min(1), tender: TenderSchema });

// `z.input<…>` = le type des données AVANT validation (ce que le navigateur envoie).
export async function recordDepositAction(input: z.input<typeof DepositSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser(); // 1. qui ?
  if (!canCollect(user)) return { error: "Accès refusé." }; // 2. rôle
  const parsed = DepositSchema.safeParse(input); // 3. validation
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  // Le paiement « en ligne » passe par un lien de paiement, pas par la caisse.
  if (parsed.data.tender.method === "ONLINE") return { error: "Pour un paiement en ligne, envoyez un lien de paiement au client." };
  return run(async () => {
    const payment = await recordDeposit(user, parsed.data.bookingId, parsed.data.tender); // 4. service
    // 5. journal de sécurité (traçabilité) + rechargement des pages
    await logEvent("PAYMENT_RECORDED", { userId: user.id, organizationId: user.organization?.id, detail: `${payment.receiptNumber} acompte ${payment.amountTnd} DT` });
    refresh();
    // `true as const` : donne à TypeScript le type exact « true » (et non « boolean »).
    return { ok: true as const, message: `Acompte encaissé · reçu ${payment.receiptNumber}`, receiptId: String(payment._id) };
  });
}

// ── F6.1 Encaissement d'un rendez-vous ──
const CheckoutSchema = z.object({
  bookingId: z.string().min(1),
  // 1 à 4 règlements (paiement fractionné), au moins un.
  tenders: z.array(TenderSchema).min(1, "Ajoutez un moyen de paiement.").max(4),
  discountTnd: amount.default(0), // remise facultative (0 par défaut)
});

export async function checkoutAction(input: z.input<typeof CheckoutSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user)) return { error: "Accès refusé." };
  const parsed = CheckoutSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  if (parsed.data.tenders.some((t) => t.method === "ONLINE")) return { error: "Pour un paiement en ligne, envoyez un lien de paiement au client." };
  return run(async () => {
    const { payments, invoice } = await checkoutBooking(user, parsed.data.bookingId, parsed.data.tenders, parsed.data.discountTnd);
    const organizationId = user.organization?.id;
    // Une ligne de journal par paiement enregistré, plus une pour la facture si elle a été émise.
    for (const p of payments) {
      await logEvent("PAYMENT_RECORDED", { userId: user.id, organizationId, detail: `${p.receiptNumber} ${p.method} ${p.amountTnd} DT` });
    }
    if (invoice) await logEvent("INVOICE_ISSUED", { userId: user.id, organizationId, detail: `${invoice.number} ${invoice.totalTnd} DT` });
    refresh();
    return {
      ok: true as const,
      // Message différent selon que le solde est réglé (facture émise) ou non (paiement partiel).
      message: invoice ? `Encaissé · facture ${invoice.number} émise` : `Paiement partiel enregistré · reçu ${payments[0]?.receiptNumber}`,
      invoiceId: invoice ? String(invoice._id) : undefined,
      receiptId: payments[0] ? String(payments[0]._id) : undefined,
    };
  });
}

// Émet la facture d'un rendez-vous déjà entièrement réglé (bouton « Émettre la facture »).
export async function invoiceBookingAction(bookingId: string): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user)) return { error: "Accès refusé." };
  return run(async () => {
    const invoice = await invoiceSettledBooking(user, bookingId);
    await logEvent("INVOICE_ISSUED", { userId: user.id, organizationId: user.organization?.id, detail: `${invoice.number} ${invoice.totalTnd} DT` });
    refresh();
    return { ok: true as const, message: `Facture ${invoice.number} émise`, invoiceId: String(invoice._id) };
  });
}

// ── F6.1 Vente directe ──
const SaleSchema = z.object({
  centerId: z.string().min(1),
  customerId: z.string().optional(),
  customerName: z.string().trim().max(80).optional(),
  // Lignes de la vente : 1 à 30, chacune avec libellé, quantité entière 1–99 et prix.
  lines: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Libellé manquant.").max(120),
        quantity: z.coerce.number().int().min(1).max(99),
        unitPriceTnd: amount,
        serviceId: z.string().optional().nullable(),
      }),
    )
    .min(1, "Ajoutez au moins une prestation.")
    .max(30),
  tenders: z.array(TenderSchema).min(1).max(4),
  discountTnd: amount.default(0),
});

export async function directSaleAction(input: z.input<typeof SaleSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  // La vente directe est réservée à la gestion (propriétaire, gérant) : contrôle plus strict que la caisse.
  if (!canViewFinance(user)) return { error: "La vente directe est réservée au gérant et au propriétaire." };
  const parsed = SaleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  if (parsed.data.tenders.some((t) => t.method === "ONLINE")) return { error: "Moyen de paiement non disponible au comptoir." };
  return run(async () => {
    const { invoice, payments } = await directSale(user, parsed.data);
    const organizationId = user.organization?.id;
    for (const p of payments) await logEvent("PAYMENT_RECORDED", { userId: user.id, organizationId, detail: `${p.receiptNumber} ${p.method} ${p.amountTnd} DT` });
    await logEvent("INVOICE_ISSUED", { userId: user.id, organizationId, detail: `${invoice.number} ${invoice.totalTnd} DT` });
    refresh();
    return { ok: true as const, message: `Vente enregistrée · facture ${invoice.number}`, invoiceId: String(invoice._id) };
  });
}

// ── Remboursement et annulation ──
// Le motif (3 à 200 caractères) est OBLIGATOIRE : il sert de justification en cas de contrôle.
const RefundSchema = z.object({ paymentId: z.string().min(1), amountTnd: amount, reason: z.string().trim().min(3, "Indiquez le motif.").max(200) });

export async function refundAction(input: z.input<typeof RefundSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  const parsed = RefundSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  // Le contrôle du rôle se fait dans refundPayment (service.ts) : gérant et propriétaire uniquement.
  return run(async () => {
    const refund = await refundPayment(user, parsed.data.paymentId, parsed.data.amountTnd, parsed.data.reason);
    await logEvent("PAYMENT_REFUNDED", { userId: user.id, organizationId: user.organization?.id, detail: `${refund.receiptNumber} ${refund.amountTnd} DT · ${parsed.data.reason}` });
    refresh();
    return { ok: true as const, message: `Remboursement enregistré · ${refund.receiptNumber}`, receiptId: String(refund._id) };
  });
}

const CancelInvoiceSchema = z.object({ invoiceId: z.string().min(1), reason: z.string().trim().min(3, "Indiquez le motif.").max(200) });

export async function cancelInvoiceAction(input: z.input<typeof CancelInvoiceSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  const parsed = CancelInvoiceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  // Propriétaire uniquement : vérifié dans cancelInvoice (service.ts).
  return run(async () => {
    const invoice = await cancelInvoice(user, parsed.data.invoiceId, parsed.data.reason);
    await logEvent("INVOICE_CANCELLED", { userId: user.id, organizationId: user.organization?.id, detail: `${invoice.number} · ${parsed.data.reason}` });
    refresh();
    return { ok: true as const, message: `Facture ${invoice.number} annulée` };
  });
}

// ── F6.2 Lien de paiement en ligne ──

// Reconstitue l'adresse du site (« https://monsalon.tn ») à partir des en-têtes de la requête.
// Nécessaire pour fabriquer un lien ABSOLU à envoyer au client. Derrière un proxy (Vercel…), l'adresse
// d'origine se trouve dans « x-forwarded-host » / « x-forwarded-proto » ; en local, on utilise http.
async function baseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const LinkSchema = z.object({ bookingId: z.string().min(1), amountTnd: amount, kind: z.enum(["DEPOSIT", "PAYMENT"]) });

export async function createPaymentLinkAction(input: z.input<typeof LinkSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user) || !user.organization) return { error: "Accès refusé." };
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return run(async () => {
    const booking = await loadBookingForCheckout(user, parsed.data.bookingId);
    if (!booking) throw new FinanceError("Rendez-vous introuvable.");
    // Le service crée le paiement « en attente » et renvoie le jeton secret (une seule fois).
    const token = await createPaymentLink(user, parsed.data.bookingId, parsed.data.amountTnd, parsed.data.kind);
    const link = `${await baseUrl()}/paiement/${token}`;
    // Message WhatsApp prérempli, prêt à envoyer au client.
    const customer = await Customer.findById(booking.customerId).select("firstName phone").lean();
    const message =
      `Bonjour ${customer?.firstName ?? ""}, voici le lien pour régler ${parsed.data.kind === "DEPOSIT" ? "l'acompte de" : ""} ` +
      `${parsed.data.amountTnd} DT pour votre rendez-vous chez ${user.organization!.name} le ${fmtDay(booking.start)} à ${fmtTime(booking.start)} : ${link}`;
    refresh();
    return {
      ok: true as const,
      message: "Lien de paiement créé (valable 48 h).",
      link,
      // `\s+` → un seul espace : nettoie les espaces multiples du message avant de le mettre dans l'URL WhatsApp.
      whatsapp: customer?.phone ? whatsappLink(customer.phone, message.replace(/\s+/g, " ")) : undefined,
    };
  });
}

// Paiement par le client sur la page publique /paiement/[jeton] (aucune session requise).
// ATTENTION : cette action est appelée par un visiteur NON connecté. La sécurité repose sur le
// jeton secret (impossible à deviner) et sur la validation stricte des champs de carte.
const CardSchema = z.object({
  token: z.string().min(10).max(100),
  cardNumber: z.string().trim().min(12).max(23),
  expiry: z.string().trim().max(7),
  cvc: z.string().trim().max(4),
  holder: z.string().trim().min(2, "Nom du titulaire manquant.").max(80),
});

export async function payOnlineAction(input: z.input<typeof CardSchema>): Promise<FinanceResult> {
  const parsed = CardSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const { token, cardNumber, expiry, cvc } = parsed.data;
  try {
    // 1. Le jeton correspond-il à un paiement en attente ?
    const pending = await findPendingOnlinePayment(token);
    if (!pending) return { error: "Lien de paiement invalide." };
    // Déjà payé (double clic) : on répond « succès » sans rien refaire.
    if (pending.status === "PAID") return { ok: true, message: "Ce paiement a déjà été effectué." };
    // Lien verrouillé après trop d'essais ratés (voir registerFailedAttempt).
    if (pending.status === "FAILED") return { error: "Trop de tentatives échouées : ce lien est verrouillé. Demandez un nouveau lien au salon." };
    // Lien remplacé, annulé ou expiré.
    if (pending.status !== "PENDING" || (pending.gatewayExpiresAt && pending.gatewayExpiresAt < new Date())) {
      return { error: "Ce lien de paiement a expiré. Demandez-en un nouveau au salon." };
    }
    // 2. On demande l'autorisation à la passerelle de paiement. Le numéro de carte n'est envoyé qu'à elle.
    const result = await getGateway().authorize({ amountTnd: pending.amountTnd, cardNumber, expiry, cvc });
    // Un refus ne grille pas immédiatement le lien : le client peut réessayer avec une autre carte, mais
    // seulement 5 fois (protection contre quelqu'un qui testerait des numéros de carte volés).
    if (!result.ok) {
      const attempt = await registerFailedAttempt(token);
      if (attempt.locked) return { error: "Trop de tentatives échouées : ce lien est verrouillé. Demandez un nouveau lien au salon." };
      return { error: result.error, attemptsLeft: attempt.remaining };
    }
    // 3. Autorisation obtenue : on confirme le paiement (reçu, facture éventuelle).
    const payment = await confirmOnlinePayment(token, result.reference);
    await logEvent("PAYMENT_RECORDED", { organizationId: String(payment.organizationId), detail: `${payment.receiptNumber} en ligne ${payment.amountTnd} DT (${result.reference})` });
    refresh();
    return { ok: true, message: `Paiement accepté · reçu ${payment.receiptNumber}` };
  } catch (e) {
    // Ici l'enveloppe `run` n'est pas utilisée : le flux est différent (pas de session, retours anticipés).
    if (e instanceof FinanceError) return { error: e.message };
    console.error("Paiement en ligne :", e);
    return { error: "Le paiement n'a pas pu aboutir. Réessayez." };
  }
}

// ── F6.4 Dépenses ──
// Le même schéma sert à la création ET à la modification (`id` présent = modification).
const ExpenseSchema = z.object({
  id: z.string().optional(),
  centerId: z.string().min(1, "Choisissez un centre."),
  category: z.enum(EXPENSE_CATEGORIES),
  label: z.string().trim().min(2, "Libellé trop court.").max(120),
  // `.refine` ajoute une règle personnalisée : le montant doit être strictement positif.
  amountTnd: amount.refine((v) => v > 0, "Le montant doit être positif."),
  // Date au format AAAA-MM-JJ vérifié par une expression régulière (\d = un chiffre).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  method: z.enum([...PAYMENT_METHODS, "TRANSFER", "CHECK"]).default("CASH"),
  supplier: z.string().trim().max(80).optional(),
});

export async function saveExpenseAction(input: z.input<typeof ExpenseSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization) return { error: "Accès refusé." };
  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const d = parsed.data;
  return run(async () => {
    assertCenter(user, d.centerId); // le centre doit être dans le périmètre de l'utilisateur
    // Le gérant ne saisit pas les salaires : donnée réservée au propriétaire.
    if (d.category === "SALARIES" && user.role !== "OWNER") throw new FinanceError("Les salaires sont gérés par le propriétaire.");
    const date = parseDayKey(d.date)!;
    // Refuse une date à plus de 31 jours dans le futur (probable faute de frappe sur l'année).
    if (date > new Date(Date.now() + 31 * 86_400_000)) throw new FinanceError("Date trop lointaine.");
    await connectDB();
    const data = { centerId: d.centerId, category: d.category, label: d.label, amountTnd: d.amountTnd, date, method: d.method, supplier: d.supplier || undefined };
    // ── Modification d'une dépense existante ──
    if (d.id) {
      if (!Types.ObjectId.isValid(d.id)) throw new FinanceError("Dépense introuvable.");
      // On la cherche dans CE salon uniquement (isolation).
      const existing = await Expense.findOne({ _id: d.id, organizationId: user.organization!.id });
      if (!existing) throw new FinanceError("Dépense introuvable.");
      assertCenter(user, String(existing.centerId));
      if (existing.category === "SALARIES" && user.role !== "OWNER") throw new FinanceError("Les salaires sont gérés par le propriétaire.");
      existing.set(data); // applique les nouvelles valeurs…
      await existing.save(); // …puis enregistre (la validation du schéma est rejouée)
      refresh();
      return { ok: true as const, message: "Dépense modifiée." };
    }
    // ── Création d'une nouvelle dépense ──
    const expense = await Expense.create({ ...data, organizationId: user.organization!.id, createdBy: user.id });
    await logEvent("EXPENSE_CREATED", { userId: user.id, organizationId: user.organization!.id, detail: `${expense.label} ${expense.amountTnd} DT` });
    refresh();
    return { ok: true as const, message: "Dépense enregistrée." };
  });
}

export async function deleteExpenseAction(id: string): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization || !Types.ObjectId.isValid(id)) return { error: "Accès refusé." };
  return run(async () => {
    await connectDB();
    const expense = await Expense.findOne({ _id: id, organizationId: user.organization!.id });
    if (!expense) throw new FinanceError("Dépense introuvable.");
    assertCenter(user, String(expense.centerId));
    if (expense.category === "SALARIES" && user.role !== "OWNER") throw new FinanceError("Les salaires sont gérés par le propriétaire.");
    await expense.deleteOne();
    // La suppression est tracée dans le journal de sécurité (qui, quoi, combien).
    await logEvent("EXPENSE_DELETED", { userId: user.id, organizationId: user.organization!.id, detail: `${expense.label} ${expense.amountTnd} DT` });
    refresh();
    return { ok: true as const, message: "Dépense supprimée." };
  });
}


// ── IA : assistant d'analyse financière ──
// Conversation envoyée par l'interface : 1 à 12 messages, chacun de 1 à 1000 caractères
// (limite la taille des requêtes, donc le coût et les abus).
const ChatSchema = z.object({
  centerId: z.string().optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(12),
});

// LIMITE DE DÉBIT (« rate limiting ») : au plus 30 questions par heure et par utilisateur, pour éviter
// qu'un script ou un utilisateur n'épuise le quota (payant) de l'API d'IA.
// `questions` mémorise, pour chaque utilisateur, les heures de ses dernières questions.
// (Stocké en mémoire du serveur : suffisant ici ; une version de production utiliserait Redis ou la base.)
const MAX_QUESTIONS_PER_HOUR = 30;
const questions = new Map<string, number[]>();

function allowQuestion(userId: string) {
  const now = Date.now();
  // On ne garde que les questions de moins d'une heure (3 600 000 ms).
  const recent = (questions.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_QUESTIONS_PER_HOUR) return false; // quota atteint
  questions.set(userId, [...recent, now]); // on enregistre cette question
  return true;
}

export async function askFinanceAssistantAction(input: z.input<typeof ChatSchema>): Promise<FinanceReply | { error: string }> {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization) return { error: "Accès refusé." };
  const parsed = ChatSchema.safeParse(input);
  // Le dernier message doit être une QUESTION de l'utilisateur (pas un message « assistant » forgé).
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return { error: "Question invalide." };
  // Périmètre calculé CÔTÉ SERVEUR à partir du rôle : le navigateur ne peut pas élargir ses droits.
  const scope = financeScope(user, parsed.data.centerId);
  if (!scope) return { error: "Aucun centre accessible." };
  if (!allowQuestion(user.id)) return { error: "Limite atteinte : réessayez dans une heure." };
  try {
    // On ne transmet que les 10 derniers messages (limite le contexte envoyé à l'IA).
    return await financeAssistantReply(scope, user.organization.name, parsed.data.messages.slice(-10));
  } catch (e) {
    console.error("Assistant financier :", e);
    return { error: "L'assistant est momentanément indisponible." };
  }
}


// ── Annulation d'un lien de paiement en attente ──
export async function cancelPaymentLinkAction(paymentId: string): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canCollect(user)) return { error: "Accès refusé." };
  return run(async () => {
    const payment = await cancelPendingPayment(user, paymentId);
    await logEvent("PAYMENT_LINK_CANCELLED", { userId: user.id, organizationId: user.organization?.id, detail: `${payment.amountTnd} DT` });
    refresh();
    return { ok: true as const, message: "Lien de paiement annulé." };
  });
}

// ── Clôture de caisse ──
// Le comptage des espèces est saisi par le gérant ; le montant ATTENDU est recalculé par le serveur
// (on ne fait pas confiance au navigateur pour ce chiffre).
const CloseSchema = z.object({
  centerId: z.string().min(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  countedCashTnd: amount,
  note: z.string().trim().max(300).optional(),
});

export async function closeCashAction(input: z.input<typeof CloseSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (!canViewFinance(user)) return { error: "Seuls le gérant et le propriétaire peuvent clôturer la caisse." };
  const parsed = CloseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  return run(async () => {
    const closing = await closeCash(user, parsed.data);
    await logEvent("CASH_CLOSED", {
      userId: user.id,
      organizationId: user.organization?.id,
      detail: `${closing.day} · compté ${closing.countedCashTnd} DT · écart ${closing.varianceTnd} DT`,
    });
    refresh();
    return {
      ok: true as const,
      message: closing.varianceTnd === 0 ? "Caisse clôturée : aucun écart." : `Caisse clôturée · écart de ${closing.varianceTnd} DT`,
      closingId: String(closing._id),
    };
  });
}

export async function reopenCashAction(closingId: string): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (user.role !== "OWNER") return { error: "Seul le propriétaire peut rouvrir une caisse." };
  return run(async () => {
    const closing = await reopenCash(user, closingId);
    await logEvent("CASH_REOPENED", { userId: user.id, organizationId: user.organization?.id, detail: closing.day });
    refresh();
    return { ok: true as const, message: "Caisse rouverte." };
  });
}

// ── Paramètres financiers (propriétaire) ──
// La TVA est saisie en pourcentage (19) et stockée en fraction (0.19).
const SettingsSchema = z.object({
  vatPercent: z.coerce.number().min(0, "TVA invalide.").max(50, "TVA invalide."),
  taxId: z.string().trim().max(40).default(""),
  invoiceFooter: z.string().trim().max(300).default(""),
  defaultDepositPercent: z.coerce.number().int().min(0).max(100),
  staffCanCollect: z.boolean(),
  onlinePaymentsEnabled: z.boolean(),
});

export async function saveFinanceSettingsAction(input: z.input<typeof SettingsSchema>): Promise<FinanceResult> {
  const user = await getCurrentUser();
  if (user.role !== "OWNER" || !user.organization) return { error: "Seul le propriétaire peut modifier les paramètres financiers." };
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const { vatPercent, ...rest } = parsed.data;
  return run(async () => {
    await saveFinanceSettings(user.organization!.id, { ...rest, vatRate: Math.round(vatPercent * 100) / 10000 });
    await logEvent("FINANCE_SETTINGS_UPDATED", { userId: user.id, organizationId: user.organization!.id, detail: `TVA ${vatPercent} %` });
    refresh();
    return { ok: true as const, message: "Paramètres enregistrés. Ils s'appliquent aux prochaines factures." };
  });
}
