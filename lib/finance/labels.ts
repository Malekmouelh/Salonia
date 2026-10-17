// Libellés du Module 6 (français = clé de traduction arabe). Utilisables côté client.
import type { ExpenseCategory, InvoiceStatus, PaymentKind, PaymentMethod, PaymentStatus } from "@/lib/enums";

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  CARD: "Carte bancaire",
  MOBILE: "Paiement mobile",
  ONLINE: "Paiement en ligne",
};

export const EXPENSE_METHOD_LABELS: Record<string, string> = {
  ...METHOD_LABELS,
  TRANSFER: "Virement",
  CHECK: "Chèque",
};

export const KIND_LABELS: Record<PaymentKind, string> = {
  DEPOSIT: "Acompte",
  PAYMENT: "Encaissement",
  REFUND: "Remboursement",
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; chip: string }> = {
  PENDING: { label: "En attente", chip: "bg-amber-400/15 text-amber-200" },
  PAID: { label: "Payé", chip: "bg-emerald-400/15 text-emerald-200" },
  FAILED: { label: "Échoué", chip: "bg-red-400/15 text-red-200" },
  CANCELLED: { label: "Annulé", chip: "bg-white/10 text-white/50" },
};

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; chip: string }> = {
  ISSUED: { label: "À régler", chip: "bg-amber-400/15 text-amber-200" },
  PAID: { label: "Payée", chip: "bg-emerald-400/15 text-emerald-200" },
  CANCELLED: { label: "Annulée", chip: "bg-white/10 text-white/50 line-through" },
};

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Loyer",
  PRODUCTS: "Produits",
  SALARIES: "Salaires",
  UTILITIES: "Eau, électricité, internet",
  MARKETING: "Marketing",
  EQUIPMENT: "Matériel",
  OTHER: "Autre",
};
