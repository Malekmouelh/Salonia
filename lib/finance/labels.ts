// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/labels.ts — LES TEXTES AFFICHÉS À L'UTILISATEUR
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE DU FICHIER
//   En base de données, on stocke des CODES techniques (« CASH », « CARD », « RENT »…).
//   Ce fichier fait la correspondance code → texte lisible en français. Ces textes
//   servent aussi de CLÉS pour la traduction arabe (fonction t() de l'interface, qui
//   cherche le texte français dans lib/i18n-ar.ts).
//   Il ne contient aucun import serveur : il peut donc être utilisé côté navigateur.
// ═══════════════════════════════════════════════════════════════════════════

// Libellés du Module 6 (français = clé de traduction arabe). Utilisables côté client.
import type { ExpenseCategory, InvoiceStatus, PaymentKind, PaymentMethod, PaymentStatus } from "@/lib/enums";

// `Record<PaymentMethod, string>` = un objet qui DOIT avoir une entrée pour chaque moyen de
// paiement possible : si on ajoute un moyen dans enums.ts et qu'on oublie son libellé ici,
// TypeScript signale l'erreur à la compilation.
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  CARD: "Carte bancaire",
  MOBILE: "Paiement mobile",
  ONLINE: "Paiement en ligne",
};

// Moyens utilisables pour une DÉPENSE : ceux des paiements + virement + chèque.
// `...METHOD_LABELS` recopie toutes les entrées de l'objet précédent (opérateur « spread »).
export const EXPENSE_METHOD_LABELS: Record<string, string> = {
  ...METHOD_LABELS,
  TRANSFER: "Virement",
  CHECK: "Chèque",
};

// Nature d'un mouvement d'argent.
export const KIND_LABELS: Record<PaymentKind, string> = {
  DEPOSIT: "Acompte",
  PAYMENT: "Encaissement",
  REFUND: "Remboursement",
};

// Statut d'un paiement : le texte (`label`) + les classes CSS Tailwind de la pastille colorée
// (`chip`) : ambre = en attente, vert = ok, rouge = échec, gris = annulé.
export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; chip: string }> = {
  PENDING: { label: "En attente", chip: "bg-amber-400/15 text-amber-200" },
  PAID: { label: "Payé", chip: "bg-emerald-400/15 text-emerald-200" },
  FAILED: { label: "Échoué", chip: "bg-red-400/15 text-red-200" },
  CANCELLED: { label: "Annulé", chip: "bg-white/10 text-white/50" },
};

// Statut d'une facture (même principe). `line-through` = texte barré pour une facture annulée.
export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; chip: string }> = {
  ISSUED: { label: "À régler", chip: "bg-amber-400/15 text-amber-200" },
  PAID: { label: "Payée", chip: "bg-emerald-400/15 text-emerald-200" },
  CANCELLED: { label: "Annulée", chip: "bg-white/10 text-white/50 line-through" },
};

// Catégories de dépenses.
export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Loyer",
  PRODUCTS: "Produits",
  SALARIES: "Salaires",
  UTILITIES: "Eau, électricité, internet",
  MARKETING: "Marketing",
  EQUIPMENT: "Matériel",
  OTHER: "Autre",
};
