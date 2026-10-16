import type { Governorate } from "@/lib/enums";
import { AR } from "@/lib/i18n-ar";
import type { SetupProposal } from "./setup-schema";

// Version de repli sans IA (cahier des charges §13) : analyse par mots-clés.
// Utilisée quand aucune clé d'API n'est configurée ou si l'appel échoue.

const PLACES: [RegExp, Governorate, string][] = [
  [/djerba|جربة|houmt/i, "MEDENINE", "Djerba"],
  [/sousse|سوسة/i, "SOUSSE", "Sousse"],
  [/sfax|صفاقس/i, "SFAX", "Sfax"],
  [/monastir|المنستير/i, "MONASTIR", "Monastir"],
  [/nabeul|hammamet|نابل|الحمامات/i, "NABEUL", "Nabeul"],
  [/bizerte|بنزرت/i, "BIZERTE", "Bizerte"],
  [/ariana|أريانة/i, "ARIANA", "Ariana"],
  [/ben arous|بن عروس/i, "BEN_AROUS", "Ben Arous"],
  [/mahdia|المهدية/i, "MAHDIA", "Mahdia"],
  [/kairouan|القيروان/i, "KAIROUAN", "Kairouan"],
  [/gab[eè]s|قابس/i, "GABES", "Gabès"],
  [/tozeur|توزر/i, "TOZEUR", "Tozeur"],
  [/tunis|تونس|lac|marsa|menzah/i, "TUNIS", "Tunis"],
];

const CATALOG: [RegExp, SetupProposal["services"]][] = [
  [/coiff|cheveu|brushing|شعر|حلاقة/i, [
    { name: "Coupe femme", category: "Coiffure", durationMinutes: 45, priceTnd: 35 },
    { name: "Brushing", category: "Coiffure", durationMinutes: 30, priceTnd: 25 },
    { name: "Coloration", category: "Coiffure", durationMinutes: 90, priceTnd: 90 },
    { name: "Soin kératine", category: "Coiffure", durationMinutes: 120, priceTnd: 180 },
  ]],
  [/ongl|manucure|p[ée]dicure|أظافر/i, [
    { name: "Manucure", category: "Onglerie", durationMinutes: 40, priceTnd: 30 },
    { name: "Pose gel", category: "Onglerie", durationMinutes: 75, priceTnd: 60 },
    { name: "Pédicure spa", category: "Onglerie", durationMinutes: 50, priceTnd: 40 },
  ]],
  [/maquill|mari[ée]e|mariage|مكياج|عروس/i, [
    { name: "Maquillage soirée", category: "Maquillage", durationMinutes: 60, priceTnd: 80 },
    { name: "Forfait mariée", category: "Maquillage", durationMinutes: 180, priceTnd: 450 },
  ]],
  [/barb|homme|رجال/i, [
    { name: "Coupe homme", category: "Barbier", durationMinutes: 30, priceTnd: 20 },
    { name: "Taille de barbe", category: "Barbier", durationMinutes: 20, priceTnd: 15 },
  ]],
  [/soin|visage|esth[ée]ti|épil|epil|بشرة|تجميل/i, [
    { name: "Soin visage éclat", category: "Esthétique", durationMinutes: 60, priceTnd: 70 },
    { name: "Épilation jambes complètes", category: "Esthétique", durationMinutes: 45, priceTnd: 35 },
  ]],
  [/spa|hammam|massage|حمام|تدليك/i, [
    { name: "Hammam traditionnel", category: "Spa", durationMinutes: 60, priceTnd: 50 },
    { name: "Massage relaxant", category: "Spa", durationMinutes: 60, priceTnd: 90 },
  ]],
];

function parseHours(text: string) {
  const m = text.match(/(\d{1,2})\s*(?:h|:)?\s*(\d{2})?\s*(?:-|à|a|إلى|حتى)\s*(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/i);
  const pad = (h: string, mm?: string) => `${h.padStart(2, "0")}:${mm ?? "00"}`;
  return m ? `${pad(m[1], m[2])}-${pad(m[3], m[4])}` : "09:00-19:00";
}

export function offlineSetup(description: string): SetupProposal {
  const arabic = /[؀-ۿ]/.test(description);
  const brand =
    description.match(/(?:salon|institut|spa|studio)\s+[A-ZÀ-ÿ][\wÀ-ÿ'-]+/i)?.[0] ??
    description.match(/(?:صالون|معهد|سبا)\s+[؀-ۿ]+/)?.[0] ??
    (arabic ? "صالوني" : "Mon salon");
  const found = PLACES.filter(([re]) => re.test(description));
  const places = found.length ? found : [PLACES[PLACES.length - 1]];
  const range = parseHours(description);
  // « fermé le dimanche » l'emporte ; sinon ouvert le dimanche seulement si c'est dit explicitement.
  const sundayClosed =
    /ferm[ée]\w*\s+(?:le\s+)?dimanche|مغلق[^،.]*الأحد/i.test(description) ||
    !/7\s*j|7j\/7|tous les jours|dimanche|كل (?:الأيام|يوم)|طيلة الأسبوع|الأحد/i.test(description);

  const services = CATALOG.filter(([re]) => re.test(description)).flatMap(([, s]) => s);

  return {
    summary: `${places.length} centre(s) proposés avec horaires et catalogue de départ.`,
    centers: places.map(([, governorate, city]) => ({
      name: `${brand} ${arabic ? (AR[city] ?? city) : city}`,
      governorate,
      openingHours: {
        lundi: range, mardi: range, mercredi: range, jeudi: range, vendredi: range,
        samedi: range,
        dimanche: sundayClosed ? null : range,
      },
    })),
    services: services.length ? services : CATALOG[0][1],
    team: [
      { title: "Gérant(e) de centre", role: "MANAGER", count: places.length },
      { title: "Coiffeuse / Esthéticienne", role: "STAFF", count: places.length * 2 },
      { title: "Réceptionniste", role: "STAFF", count: places.length },
    ],
  };
}
