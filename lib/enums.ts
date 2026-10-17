// Valeurs fixes partagées par la base (Mongoose) et l'interface.

export const ROLES = ["SUPER_ADMIN", "OWNER", "MANAGER", "STAFF", "CLIENT"] as const;
export type Role = (typeof ROLES)[number];

export const GOVERNORATE_CODES = [
  "TUNIS", "ARIANA", "BEN_AROUS", "MANOUBA", "NABEUL", "ZAGHOUAN", "BIZERTE", "BEJA",
  "JENDOUBA", "KEF", "SILIANA", "SOUSSE", "MONASTIR", "MAHDIA", "SFAX", "KAIROUAN",
  "KASSERINE", "SIDI_BOUZID", "GABES", "MEDENINE", "TATAOUINE", "GAFSA", "TOZEUR", "KEBILI",
] as const;
export type Governorate = (typeof GOVERNORATE_CODES)[number];

export const AUTH_EVENT_TYPES = [
  "LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_LOCKED", "LOGOUT", "REGISTER",
  "PASSWORD_RESET_REQUEST", "PASSWORD_RESET", "CENTER_CREATED", "AI_SETUP_APPLIED",
  // Module 3
  "BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "REMINDERS_SENT",
  // Module 6
  "PAYMENT_RECORDED", "PAYMENT_REFUNDED", "INVOICE_ISSUED", "INVOICE_CANCELLED",
  "EXPENSE_CREATED", "EXPENSE_DELETED", "FINANCE_EXPORTED",
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

// Module 3 : réservations
export const BOOKING_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_SOURCES = ["ONLINE", "STAFF", "CHATBOT", "WAITLIST"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const BLOCK_KINDS = ["BREAK", "CLOSURE", "BLOCK"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const WAITLIST_STATUSES = ["WAITING", "OFFERED", "BOOKED", "CANCELLED"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

// Module 6 : paiements, factures et finances
export const PAYMENT_METHODS = ["CASH", "CARD", "MOBILE", "ONLINE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// DEPOSIT = acompte de réservation · PAYMENT = encaissement · REFUND = remboursement (montant positif, soustrait)
export const PAYMENT_KINDS = ["DEPOSIT", "PAYMENT", "REFUND"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED", "CANCELLED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVOICE_STATUSES = ["ISSUED", "PAID", "CANCELLED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EXPENSE_CATEGORIES = ["RENT", "PRODUCTS", "SALARIES", "UTILITIES", "MARKETING", "EQUIPMENT", "OTHER"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
