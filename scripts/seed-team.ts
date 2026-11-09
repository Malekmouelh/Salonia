// Données d'équipe de démonstration (Module 4) — AJOUT SEULEMENT, aucune suppression, aucune modification de l'existant.
// Cible : uniquement l'organisation de démo « salon-yasmine » (autre organisation : jamais touchée).
//   npm run db:seed:team            → simulation : affiche ce qui serait ajouté, n'écrit rien
//   npm run db:seed:team -- --apply → écrit
// Rejouable : chaque étape saute ce qui existe déjà. Ce que le script ajoute :
//   1. poste, compétences et horaires des comptes de démo qui n'en ont pas (jamais d'écrasement d'une valeur existante) ;
//   2. quelques congés et absences, reconnaissables au motif « … [démo] » (sans chevaucher un rendez-vous) ;
//   3. quelques rendez-vous à venir (planning), reconnaissables à la note « Démo équipe ».
// Pour retirer ce qui a été ajouté : StaffTimeOff.deleteMany({ reason: /\[démo\]$/ }) et Booking.deleteMany({ notes: "Démo équipe" }).
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/db";
import { addDays, addMinutes, dayKey, fromLocal, hoursForDay, parseRange, toLocal, WEEKDAYS } from "../lib/booking/time";
import { AvailabilityBlock, Booking, Customer } from "../lib/models/booking";
import { Service } from "../lib/models/catalog";
import { Center, Organization, User } from "../lib/models/core";
import { StaffTimeOff } from "../lib/models/team";

const APPLY = process.argv.includes("--apply");
const ORG_SLUG = "salon-yasmine";
const REASON_TAG = "[démo]";
const BOOKING_NOTE = "Démo équipe";

// Générateur pseudo-aléatoire reproductible.
let seed = 20261108;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

type Hours = Record<string, string | null>;
// Rôles prédéfinis de lib/team/roles.ts (le libellé est le poste enregistré). hours : jours qui diffèrent du centre.
const PROFILES: Record<string, { jobTitle: string; skills?: string[]; hours?: Hours }> = {
  "staff@salonia.tn": { jobTitle: "Coiffeur / Coiffeuse", skills: ["Coiffure"] },
  "nour@salonia.tn": { jobTitle: "Esthéticienne", skills: ["Esthétique", "Maquillage"], hours: { mercredi: null } },
  "ines@salonia.tn": { jobTitle: "Maquilleuse", skills: ["Maquillage"] },
  "youssef@salonia.tn": { jobTitle: "Coiffeur / Coiffeuse", skills: ["Barbier", "Coiffure"], hours: { samedi: "09:00-14:00" } },
  "leila@salonia.tn": { jobTitle: "Prothésiste ongulaire", skills: ["Onglerie"], hours: { jeudi: "12:00-19:00" } },
  "fatma@salonia.tn": { jobTitle: "Masseuse", skills: ["Esthétique"] },
  "manager@salonia.tn": { jobTitle: "Gérant(e) de centre" },
};

// Absences : décalage en jours par rapport à aujourd'hui (minuit, heure de Tunis).
const TIMEOFF: { email: string; kind: "LEAVE" | "ABSENCE"; from: number; to: number; range?: [number, number]; reason: string }[] = [
  { email: "youssef@salonia.tn", kind: "LEAVE", from: -6, to: -4, reason: "Congé annuel" }, // passé : aucun rendez-vous sur ces jours
  { email: "leila@salonia.tn", kind: "ABSENCE", from: -3, to: -3, reason: "Démarche administrative" },
  { email: "leila@salonia.tn", kind: "ABSENCE", from: 2, to: 2, reason: "Formation" },
  { email: "nour@salonia.tn", kind: "ABSENCE", from: 3, to: 3, range: [14 * 60, 17 * 60], reason: "Rendez-vous personnel" },
  { email: "ines@salonia.tn", kind: "ABSENCE", from: 5, to: 5, reason: "Formation" },
  { email: "staff@salonia.tn", kind: "LEAVE", from: 10, to: 14, reason: "Congé annuel" },
  { email: "fatma@salonia.tn", kind: "LEAVE", from: 20, to: 24, reason: "Congé annuel" },
  { email: "youssef@salonia.tn", kind: "LEAVE", from: 40, to: 46, reason: "Congé annuel" },
];

const log = (message: string) => console.log(message);

async function main() {
  await connectDB();
  const host = mongoose.connection.host ?? "?";
  log(`→ Base : ${/mongodb\.net$/.test(host) ? "Atlas (cloud)" : host} / ${mongoose.connection.name}`);
  log(APPLY ? "→ MODE ÉCRITURE (--apply)" : "→ SIMULATION : rien n'est écrit (ajoute --apply pour écrire)");

  const org = await Organization.findOne({ slug: ORG_SLUG }).lean();
  if (!org) {
    log(`✖ Organisation « ${ORG_SLUG} » introuvable : rien n'est fait.`);
    return;
  }
  const f = { organizationId: org._id };
  const centers = await Center.find(f).lean();
  const centerById = new Map(centers.map((c) => [String(c._id), c]));
  const users = await User.find({ ...f, email: { $in: Object.keys(PROFILES) } }).lean();
  const byEmail = new Map(users.map((u) => [u.email!, u]));
  log(`→ ${org.name} : ${centers.length} centres, ${users.length}/${Object.keys(PROFILES).length} comptes de démo trouvés`);

  // 1) Fiches : on ne remplit que les champs vides.
  let profileUpdates = 0;
  for (const [email, profile] of Object.entries(PROFILES)) {
    const user = byEmail.get(email);
    if (!user) continue;
    const set: Record<string, unknown> = {};
    if (!user.jobTitle) set.jobTitle = profile.jobTitle;
    if (profile.skills && !(user.skills ?? []).length) set.skills = profile.skills;
    if (profile.hours && !user.workingHours) set.workingHours = profile.hours;
    if (Object.keys(set).length === 0) continue;
    profileUpdates++;
    log(`  fiche ${email} : ${Object.keys(set).join(", ")}`);
    if (APPLY) await User.updateOne({ _id: user._id, organizationId: org._id }, { $set: set });
    Object.assign(user, set); // l'étape des rendez-vous tient compte des horaires qui viennent d'être posés
  }
  log(`✔ Fiches : ${profileUpdates} compte(s) complété(s)`);

  // 2) Congés et absences : un compte qui a déjà des absences « démo » est sauté ; jamais sur un rendez-vous existant.
  const today = fromLocal(toLocal(new Date()).year, toLocal(new Date()).month, toLocal(new Date()).day);
  let timeOffAdded = 0;
  const newTimeOff: { userId: unknown; start: Date; end: Date }[] = [];
  // Comptes qui ont déjà des absences « démo » : sautés (rejouable sans doublon).
  const alreadySeeded = new Set<string>();
  for (const user of users) {
    if (await StaffTimeOff.exists({ ...f, userId: user._id, reason: /\[démo\]$/ })) alreadySeeded.add(user.email!);
  }
  for (const t of TIMEOFF) {
    const user = byEmail.get(t.email);
    if (!user || alreadySeeded.has(t.email)) continue;
    const day = addDays(today, t.from);
    const start = t.range ? addMinutes(day, t.range[0]) : day;
    const end = t.range ? addMinutes(day, t.range[1]) : addDays(today, t.to + 1);
    const clash =
      (await Booking.exists({ ...f, staffId: user._id, status: { $in: ["PENDING", "CONFIRMED", "COMPLETED"] }, start: { $lt: end }, end: { $gt: start } })) ||
      (await StaffTimeOff.exists({ ...f, userId: user._id, start: { $lt: end }, end: { $gt: start } }));
    if (clash) {
      log(`  absence ${t.email} (${t.from}→${t.to}) ignorée : chevauche un rendez-vous ou une absence`);
      continue;
    }
    timeOffAdded++;
    newTimeOff.push({ userId: user._id, start, end });
    log(`  absence ${t.email} : ${t.kind} ${dayKey(start)} → ${dayKey(addMinutes(end, -1))}`);
    if (APPLY) await StaffTimeOff.create({ ...f, userId: user._id, kind: t.kind, start, end, allDay: !t.range, reason: `${t.reason} ${REASON_TAG}` });
  }
  log(`✔ Absences : ${timeOffAdded} ajoutée(s)`);

  // 3) Rendez-vous à venir (planning) : 13 jours, au plus 2 par personne et par jour, sans conflit.
  if (await Booking.exists({ ...f, notes: BOOKING_NOTE })) {
    log("✔ Rendez-vous : déjà ajoutés (note « Démo équipe » présente), étape sautée");
  } else {
    const services = await Service.find(f).lean();
    const customers = await Customer.find(f).select("_id").lean();
    const windowStart = addDays(today, 1);
    const windowEnd = addDays(today, 14);
    const staffIds = users.filter((u) => u.role === "STAFF").map((u) => u._id);
    const [busy, blocks, absences] = await Promise.all([
      Booking.find({ ...f, staffId: { $in: staffIds }, status: { $in: ["PENDING", "CONFIRMED"] }, start: { $lt: windowEnd }, end: { $gt: windowStart } }).select("staffId start end").lean(),
      AvailabilityBlock.find({ ...f, start: { $lt: windowEnd }, end: { $gt: windowStart } }).select("centerId staffId start end").lean(),
      StaffTimeOff.find({ ...f, userId: { $in: staffIds }, start: { $lt: windowEnd }, end: { $gt: windowStart } }).select("userId start end").lean(),
    ]);
    type Span = { start: Date; end: Date };
    const spans = new Map<string, Span[]>(); // par employé : tout ce qui est occupé
    const add = (id: unknown, s: Span) => spans.set(String(id), [...(spans.get(String(id)) ?? []), s]);
    for (const b of busy) add(b.staffId, b);
    for (const a of absences) add(a.userId, a);
    for (const a of newTimeOff) add(a.userId, a); // absences simulées en mode simulation
    if (APPLY) newTimeOff.length = 0; // déjà lues en base : pas de doublon dans la liste
    const bookings: Record<string, unknown>[] = [];

    for (const user of users.filter((u) => u.role === "STAFF")) {
      const center = centerById.get(String(user.centerIds?.[0]));
      if (!center) continue;
      const eligible = services.filter((s) => s.durationMinutes <= 120 && (!(s.centerIds ?? []).length || (s.centerIds ?? []).some((c) => String(c) === String(center._id))));
      if (eligible.length === 0 || customers.length === 0) continue;
      for (let d = 1; d <= 13; d++) {
        const day = addDays(today, d);
        const weekday = WEEKDAYS[toLocal(day).weekday];
        const centerHours = hoursForDay(center.openingHours as Hours, day);
        const own = (user.workingHours ?? null) as Hours | null;
        const hours = own && weekday in own ? parseRange(own[weekday]) : centerHours;
        if (!hours || !centerHours) continue;
        const open = Math.max(hours.open, centerHours.open);
        const close = Math.min(hours.close, centerHours.close);
        let cursor = open + Math.floor(rand() * 4) * 15;
        let made = 0;
        while (made < 2 && cursor < close - 30) {
          const service = pick(eligible);
          const start = addMinutes(day, cursor);
          const end = addMinutes(start, service.durationMinutes);
          const free =
            cursor + service.durationMinutes <= close &&
            !(spans.get(String(user._id)) ?? []).some((s) => s.start < end && start < s.end) &&
            !blocks.some((b) => String(b.centerId) === String(center._id) && (!b.staffId || String(b.staffId) === String(user._id)) && b.start < end && start < b.end);
          if (free && rand() < 0.75) {
            bookings.push({
              organizationId: org._id,
              centerId: center._id,
              customerId: pick(customers)._id,
              staffId: user._id,
              items: [{ serviceId: service._id, name: service.name, durationMinutes: service.durationMinutes, priceTnd: service.priceTnd }],
              totalTnd: service.priceTnd,
              start,
              end,
              status: rand() < 0.15 ? "PENDING" : "CONFIRMED",
              source: rand() < 0.5 ? "ONLINE" : "STAFF",
              notes: BOOKING_NOTE,
            });
            add(user._id, { start, end });
            made++;
            cursor += service.durationMinutes + 30 + Math.floor(rand() * 4) * 30;
          } else {
            cursor += 45;
          }
        }
      }
    }
    log(`✔ Rendez-vous à venir : ${bookings.length} à ajouter (du ${dayKey(addDays(today, 1))} au ${dayKey(addDays(today, 13))})`);
    if (APPLY && bookings.length > 0) await Booking.insertMany(bookings);
  }

  log(APPLY ? "✔ Terminé." : "ℹ Simulation terminée : relance avec --apply pour écrire.");
}

main()
  .catch((error) => {
    console.error("✖ Erreur :", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
