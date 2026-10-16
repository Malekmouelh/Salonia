// Messages envoyés aux clients (confirmation, rappel, annulation, liste d'attente).
// Texte prêt pour WhatsApp / SMS, avec lien wa.me pour un envoi en un clic par le salon.
import { TZ } from "./time";

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("fr-TN", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("fr-TN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);

type Ctx = { firstName: string; salon: string; center: string; start: Date; services: string; manageUrl?: string };

export function confirmationMessage(c: Ctx) {
  return [
    `Bonjour ${c.firstName} 👋`,
    `Votre rendez-vous chez ${c.salon} (${c.center}) est confirmé :`,
    `📅 ${fmtDate(c.start)} à ${fmtTime(c.start)}`,
    `💇 ${c.services}`,
    c.manageUrl ? `Modifier ou annuler : ${c.manageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function reminderMessage(c: Ctx) {
  return [
    `Rappel ⏰ Bonjour ${c.firstName}, nous vous attendons ${fmtDate(c.start)} à ${fmtTime(c.start)}`,
    `chez ${c.salon} (${c.center}) pour : ${c.services}.`,
    c.manageUrl ? `Un empêchement ? Prévenez-nous ici : ${c.manageUrl}` : "Un empêchement ? Merci de nous prévenir.",
  ].join("\n");
}

export function cancellationMessage(c: Ctx) {
  return `Bonjour ${c.firstName}, votre rendez-vous du ${fmtDate(c.start)} à ${fmtTime(c.start)} chez ${c.salon} a bien été annulé.`;
}

export function waitlistOfferMessage(c: Ctx) {
  return [
    `Bonne nouvelle ${c.firstName} ✨ Un créneau s'est libéré chez ${c.salon} (${c.center}) :`,
    `📅 ${fmtDate(c.start)} à ${fmtTime(c.start)} — ${c.services}.`,
    `Répondez « OUI » pour le réserver.`,
  ].join("\n");
}

// Lien WhatsApp avec message pré-rempli (numéro tunisien → +216).
export function whatsappLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 8 ? `216${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}
