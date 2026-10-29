import { startOfLocalDay } from "@/lib/booking/time";

// Module 5 (F5.4) — État d'une échéance de maintenance. Calcul à la lecture ; aucun rappel en arrière-plan ni cron :
// l'application affiche simplement les échéances dépassées ou du jour.
export type MaintenanceState = "NONE" | "OVERDUE" | "DUE_TODAY" | "SCHEDULED";

export function maintenanceState(nextMaintenanceAt: Date | null | undefined, now = new Date()): MaintenanceState {
  if (!nextMaintenanceAt) return "NONE";
  const today = startOfLocalDay(now).getTime();
  const due = startOfLocalDay(nextMaintenanceAt).getTime();
  return due < today ? "OVERDUE" : due === today ? "DUE_TODAY" : "SCHEDULED";
}
