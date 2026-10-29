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
  // Module 2 : catalogue
  "SERVICE_CREATED", "SERVICE_UPDATED", "SERVICE_DELETED",
  "PACK_CREATED", "PACK_UPDATED", "PACK_DELETED",
  "PROMOTION_CREATED", "PROMOTION_UPDATED", "PROMOTION_DELETED",
  // Module 3
  "BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED", "REMINDERS_SENT",
  // Module 6
  "PAYMENT_RECORDED", "PAYMENT_REFUNDED", "INVOICE_ISSUED", "INVOICE_CANCELLED",
  "EXPENSE_CREATED", "EXPENSE_DELETED", "FINANCE_EXPORTED",
  // Module 4 : équipe
  "STAFF_CREATED", "STAFF_HOURS_UPDATED", "STAFF_TIMEOFF_CREATED", "STAFF_TIMEOFF_UPDATED", "STAFF_TIMEOFF_DELETED",
  // Module 5 : matériel et stock
  "STOCK_PRODUCT_CREATED", "STOCK_PRODUCT_UPDATED", "STOCK_PRODUCT_ARCHIVED", "STOCK_LEVEL_UPDATED", "STOCK_MOVEMENT_RECORDED",
  "STOCK_ORDER_RECEIVED",
  "EQUIPMENT_CREATED", "EQUIPMENT_UPDATED", "EQUIPMENT_ARCHIVED", "MAINTENANCE_SCHEDULED", "MAINTENANCE_RECORDED",
  "SUPPLIER_CREATED", "SUPPLIER_UPDATED", "SUPPLIER_ARCHIVED", "PURCHASE_ORDER_CREATED", "PURCHASE_ORDER_UPDATED", "PURCHASE_ORDER_PLACED", "PURCHASE_ORDER_CANCELLED",
  "STOCK_RECIPE_ADDED", "STOCK_RECIPE_UPDATED", "STOCK_RECIPE_REMOVED",
  "STOCK_TRANSFERRED", "EQUIPMENT_TRANSFERRED",
  // Module 1 : vitrine et personnalisation
  "THEME_UPDATED", "FEATURES_UPDATED", "REVIEW_MODERATED", "REALIZATION_CREATED", "REALIZATION_DELETED",
] as const;
export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

// Module 4 : congés et absences du personnel (LEAVE = congé, ABSENCE = absence exceptionnelle)
export const TIMEOFF_KINDS = ["LEAVE", "ABSENCE"] as const;
export type TimeOffKind = (typeof TIMEOFF_KINDS)[number];

// Module 2 : catalogue & promotions
export const PROMOTION_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

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

// Module 5 : matériel et stock
export const EQUIPMENT_STATUSES = ["IN_SERVICE", "IN_MAINTENANCE", "OUT_OF_SERVICE"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

// Quantités entières dans l'unité de base : 1 litre = 1 000 ML.
export const STOCK_UNITS = ["PIECE", "ML", "G"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

// OPENING = stock initial d'un niveau · IN/OUT = entrée/sortie manuelle · ADJUSTMENT = correction · CONSUMPTION = prestation
// RECEIPT = réception d'une commande d'achat (une seule par commande et par produit)
// TRANSFER_OUT / TRANSFER_IN = les deux faces d'un transfert de produit entre centres (un seul de chaque par transfert)
export const STOCK_MOVEMENT_KINDS = ["OPENING", "IN", "OUT", "ADJUSTMENT", "CONSUMPTION", "RECEIPT", "TRANSFER_OUT", "TRANSFER_IN"] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

// Transferts entre centres (F5.6) : un produit (journal de stock) ou un équipement (changement de centre).
// PENDING = enregistré, pas encore terminé (reprise possible) · COMPLETED = terminé · CANCELLED = abandonné sans effet sur le stock.
export const STOCK_TRANSFER_KINDS = ["PRODUCT", "EQUIPMENT"] as const;
export type StockTransferKind = (typeof STOCK_TRANSFER_KINDS)[number];
export const STOCK_TRANSFER_STATUSES = ["PENDING", "COMPLETED", "CANCELLED"] as const;
export type StockTransferStatus = (typeof STOCK_TRANSFER_STATUSES)[number];

// Commandes d'achat de réapprovisionnement. RECEIVED est réservé à l'étape de réception (non disponible : voir lib/stock/orders.ts).
export const PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
