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
