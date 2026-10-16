// Formatage des dates et montants (heure de Tunis, français ou arabe). Utilisable côté client.
import { TZ } from "./time";

const locale = (lang: string) => (lang === "ar" ? "ar-TN" : "fr-TN");

export function fmtTime(iso: string | Date, lang = "fr") {
  return new Intl.DateTimeFormat(locale(lang), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso));
}

export function fmtDay(iso: string | Date, lang = "fr", opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat(locale(lang), { ...opts, timeZone: TZ }).format(new Date(iso));
}

export function fmtShortDay(iso: string | Date, lang = "fr") {
  return fmtDay(iso, lang, { weekday: "short", day: "numeric" });
}

export function fmtMonth(iso: string | Date, lang = "fr") {
  return fmtDay(iso, lang, { month: "long", year: "numeric" });
}

export function fmtMoney(value: number, lang = "fr") {
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 3 }).format(value)} ${lang === "ar" ? "د.ت" : "DT"}`;
}

export function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`;
}
