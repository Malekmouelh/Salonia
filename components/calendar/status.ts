import type { BookingStatus } from "@/lib/enums";

export const STATUS_META: Record<BookingStatus, { label: string; chip: string; card: string }> = {
  PENDING: { label: "En attente", chip: "bg-amber-400/15 text-amber-200", card: "bg-amber-400/10 border-amber-300/40" },
  CONFIRMED: { label: "Confirmé", chip: "bg-emerald-400/15 text-emerald-200", card: "bg-white/[0.08] border-white/15" },
  COMPLETED: { label: "Terminé", chip: "bg-sky-400/15 text-sky-200", card: "bg-sky-400/10 border-sky-300/25" },
  CANCELLED: { label: "Annulé", chip: "bg-white/10 text-white/50", card: "bg-white/[0.03] border-white/10 opacity-50 line-through" },
  NO_SHOW: { label: "Absent", chip: "bg-red-400/15 text-red-200", card: "bg-red-500/10 border-red-300/30" },
};

export const RISK_META = {
  low: { label: "Risque faible", dot: "bg-emerald-400", text: "text-emerald-300" },
  medium: { label: "Risque moyen", dot: "bg-amber-400", text: "text-amber-300" },
  high: { label: "Risque élevé", dot: "bg-red-400", text: "text-red-300" },
} as const;

export const BLOCK_LABELS = { BREAK: "Pause", CLOSURE: "Fermeture", BLOCK: "Créneau bloqué" } as const;

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60 focus:bg-white/[0.08]";

export const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/45";
