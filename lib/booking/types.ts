// Types partagés entre le serveur et les composants du Module 3 (données sérialisables).
import type { BlockKind, BookingSource, BookingStatus } from "@/lib/enums";

export type CalendarView = "day" | "week" | "month";

export type RiskInfo = {
  probability: number;
  level: "low" | "medium" | "high";
  factors: { label: string; impact: number }[];
};

export type CalendarBooking = {
  id: string;
  start: string;
  end: string;
  status: BookingStatus;
  source: BookingSource;
  staffId: string;
  customer: { id: string; name: string; phone: string; remindersConsent: boolean };
  services: string[];
  packName: string | null;
  totalTnd: number;
  notes: string | null;
  reminderSentAt: string | null;
  risk: RiskInfo | null;
};

export type CalendarBlock = {
  id: string;
  start: string;
  end: string;
  kind: BlockKind;
  staffId: string | null;
  reason: string | null;
};

export type PractitionerInfo = { id: string; firstName: string; lastName: string; color: string };

export type CalendarData = {
  view: CalendarView;
  date: string; // jour de référence YYYY-MM-DD
  rangeStart: string;
  rangeEnd: string;
  center: { id: string; name: string; openingHours: Record<string, string | null> | null };
  centers: { id: string; name: string }[];
  practitioners: PractitionerInfo[];
  staffFilter: string | null;
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
  canManage: boolean; // propriétaire ou gérant : bloquer des créneaux, voir tout le centre
  model: { source: "trained" | "prior"; trainedOn: number; accuracy: number | null; baseRate: number };
};

export type ServiceOption = {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  priceTnd: number;
  description?: string;
  photos?: string[];
  options?: {
    name: string;
    values: { label: string; extraPriceTnd: number; extraDurationMinutes: number }[];
  }[];
};
export type PackOption = {
  id: string;
  name: string;
  priceTnd: number;
  durationMinutes: number;
  serviceIds: string[];
  serviceNames: string[];
  description?: string;
  photos?: string[];
  savingsTnd?: number;
  savingsPercent?: number;
};

export type FillSuggestion = {
  day: string;
  start: string;
  end: string;
  staffId: string;
  staffName: string;
  minutes: number;
  candidates: { customerId: string; name: string; phone: string; reason: string; waitlistId?: string }[];
};
