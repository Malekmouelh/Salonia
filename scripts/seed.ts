// Données de démonstration Salonia (MongoDB).
// Une marque avec 3 centres (Tunis, Sousse, Djerba), un compte par rôle, un catalogue,
// des clients et ~10 semaines d'historique de rendez-vous pour entraîner la prédiction des absences.
// Mot de passe commun : Demo1234
import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../lib/db";
import { addDays, addMinutes, fromLocal, hhmmToMinutes, toLocal, WEEKDAYS, type Weekday } from "../lib/booking/time";
import { AvailabilityBlock, Booking, Customer, Notification, WaitlistEntry } from "../lib/models/booking";
import { Pack, Promotion, Service } from "../lib/models/catalog";
import { AuthEvent, Center, Organization, PasswordResetToken, User } from "../lib/models/core";
import { Expense, Invoice, Payment } from "../lib/models/finance";
import { seedFinance } from "./seed-finance";

// Générateur pseudo-aléatoire reproductible : le même jeu de données à chaque exécution.
let seed = 20261016;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];

const HOURS_TUNIS: Record<Weekday, string | null> = {
  lundi: "09:00-19:00", mardi: "09:00-19:00", mercredi: "09:00-19:00", jeudi: "09:00-19:00",
  vendredi: "09:00-19:00", samedi: "09:00-20:00", dimanche: null,
};
const HOURS_DJERBA: Record<Weekday, string | null> = {
  lundi: "10:00-19:00", mardi: "10:00-19:00", mercredi: "10:00-19:00", jeudi: "10:00-19:00",
  vendredi: "10:00-19:00", samedi: "10:00-20:00", dimanche: "10:00-17:00",
};

const FIRST = ["Sarra", "Mariem", "Nour", "Ines", "Rim", "Amel", "Hiba", "Yasmine", "Asma", "Wiem", "Emna", "Olfa",
  "Khaoula", "Rania", "Salma", "Molka", "Chaima", "Aya", "Dorra", "Fatma", "Mohamed", "Ahmed", "Youssef", "Karim", "Aziz"];
const LAST = ["Ben Ali", "Trabelsi", "Gharbi", "Jaziri", "Mansouri", "Hamdi", "Ayari", "Bouaziz", "Chaabane", "Dridi",
  "Ferchichi", "Haddad", "Jlassi", "Khelifi", "Mejri", "Nasri", "Riahi", "Sassi", "Toumi", "Zouari"];

async function main() {
  await connectDB();
  console.log(`→ Connexion : ${mongoose.connection.host} / ${mongoose.connection.name}`);
  const passwordHash = await bcrypt.hash("Demo1234", 12);

  // Nettoyage des données de démo précédentes (uniquement l'organisation de démo).
  const old = await Organization.findOne({ slug: "salon-yasmine" }).lean();
  if (old) {
    const filter = { organizationId: old._id };
    await Promise.all([
      Center.deleteMany(filter), Service.deleteMany(filter), Pack.deleteMany(filter), Promotion.deleteMany(filter), Customer.deleteMany(filter),
      Booking.deleteMany(filter), AvailabilityBlock.deleteMany(filter), WaitlistEntry.deleteMany(filter),
      Notification.deleteMany(filter), AuthEvent.deleteMany(filter),
      Payment.deleteMany(filter), Invoice.deleteMany(filter), Expense.deleteMany(filter),
    ]);
    await Organization.deleteOne({ _id: old._id });
  }
  const demoUsers = await User.find({ email: { $regex: /@salonia\.tn$/ } }).select("_id").lean();
  await PasswordResetToken.deleteMany({ userId: { $in: demoUsers.map((u) => u._id) } });
  await AuthEvent.deleteMany({ userId: { $in: demoUsers.map((u) => u._id) } });
  await User.deleteMany({ _id: { $in: demoUsers.map((u) => u._id) } });

  // Index déclarés dans les modèles (uniques, TTL…).
  await Promise.all(
    [Organization, Center, User, PasswordResetToken, AuthEvent, Service, Pack, Customer, Booking,
      AvailabilityBlock, WaitlistEntry, Notification].map((m) => m.createIndexes()),
  );
  // syncIndexes remplace l'ancien index unique des codes promo (sparse) par la version partielle.
  await Promotion.syncIndexes();

  // ── Organisation et centres ──
  const org = await Organization.create({ name: "Salon Yasmine", slug: "salon-yasmine" });
  // insertMany conserve l'ordre (Tunis, Sousse, Djerba) : create() enregistre en parallèle.
  const [tunis, sousse, djerba] = await Center.insertMany([
    { organizationId: org._id, name: "Yasmine Tunis — Lac 2", governorate: "TUNIS", openingHours: HOURS_TUNIS, phone: "71 123 456" },
    { organizationId: org._id, name: "Yasmine Sousse — Corniche", governorate: "SOUSSE", openingHours: HOURS_TUNIS, phone: "73 123 456" },
    { organizationId: org._id, name: "Yasmine Djerba — Houmt Souk", governorate: "MEDENINE", openingHours: HOURS_DJERBA, phone: "75 123 456" },
  ]);
  const centers = [tunis, sousse, djerba];

  // ── Comptes (un par rôle) et praticiens ──
  const base = { organizationId: org._id, passwordHash };
  await User.create([
    { firstName: "Admin", lastName: "Plateforme", email: "admin@salonia.tn", role: "SUPER_ADMIN" as const, passwordHash },
    { ...base, firstName: "Yasmine", lastName: "Ben Ali", email: "owner@salonia.tn", phone: "98123456", role: "OWNER" as const, centerIds: centers.map((c) => c._id) },
    { ...base, firstName: "Karim", lastName: "Trabelsi", email: "manager@salonia.tn", role: "MANAGER" as const, centerIds: [sousse._id] },
    { ...base, firstName: "Sarra", lastName: "Mansouri", email: "client@salonia.tn", phone: "55123456", role: "CLIENT" as const },
  ]);
  const staffDefs = [
    { firstName: "Amira", lastName: "Gharbi", email: "staff@salonia.tn", phone: "22345678", center: tunis },
    { firstName: "Nour", lastName: "Hamdi", email: "nour@salonia.tn", center: tunis },
    { firstName: "Ines", lastName: "Jaziri", email: "ines@salonia.tn", center: sousse },
    { firstName: "Youssef", lastName: "Ayari", email: "youssef@salonia.tn", center: sousse },
    { firstName: "Leila", lastName: "Ben Salem", email: "leila@salonia.tn", center: djerba },
    { firstName: "Fatma", lastName: "Mzoughi", email: "fatma@salonia.tn", center: djerba },
  ];
  const staff = await User.create(
    staffDefs.map(({ center, ...s }) => ({ ...base, ...s, role: "STAFF" as const, centerIds: [center._id] })),
  );

  // ── Catalogue (contrat Module 2) ──
  const SERVICES: [string, string, number, number][] = [
      ["Coupe femme", "Coiffure", 45, 35],
      ["Brushing", "Coiffure", 30, 25],
      ["Coloration", "Coiffure", 90, 90],
      ["Balayage", "Coiffure", 120, 140],
      ["Soin kératine", "Coiffure", 120, 180],
      ["Coupe homme", "Barbier", 30, 20],
      ["Taille de barbe", "Barbier", 20, 15],
      ["Manucure", "Onglerie", 40, 30],
      ["Pose gel", "Onglerie", 75, 60],
      ["Soin visage éclat", "Esthétique", 60, 70],
      ["Maquillage soirée", "Maquillage", 60, 80],
  ];
  const services = await Service.create(
    SERVICES.map(([name, category, durationMinutes, priceTnd]) => {
      const extra: Record<string, unknown> = {};
      if (name === "Brushing") {
        extra.description = "Brushing lisse ou wavy haute brillance adapté à la nature de vos cheveux.";
        extra.options = [
          {
            name: "Longueur des cheveux",
            values: [
              { label: "Cheveux courts", extraPriceTnd: 0, extraDurationMinutes: 0 },
              { label: "Cheveux mi-longs", extraPriceTnd: 5, extraDurationMinutes: 10 },
              { label: "Cheveux longs", extraPriceTnd: 10, extraDurationMinutes: 15 },
            ],
          },
        ];
        extra.requiredSkills = ["Coiffure"];
      } else if (name === "Coupe femme") {
        extra.description = "Diagnostic morphologique, shampoing traitant, coupe stylisée et séchage.";
        extra.requiredSkills = ["Coiffure"];
      } else if (name === "Coloration" || name === "Balayage") {
        extra.description = "Coloration lumineuse respectant la fibre capillaire avec produits professionnels.";
        extra.requiredSkills = ["Coloriste"];
        extra.requiredEquipment = ["Bac shampoing", "Casque chauffant"];
      }
      return {
        organizationId: org._id,
        name,
        category,
        durationMinutes,
        priceTnd,
        ...extra,
      };
    }),
  );
  const byName = (n: string) => services.find((s) => s.name === n)!;
  await Pack.create([
    {
      organizationId: org._id,
      name: "Pack Mariée Royale",
      description: "La formule prestige pour briller lors du plus beau jour de votre vie.",
      serviceIds: [byName("Soin visage éclat")._id, byName("Maquillage soirée")._id, byName("Brushing")._id],
      priceTnd: 160,
    },
    {
      organizationId: org._id,
      name: "Pack Détente & Beauté",
      description: "Pause bien-être complète comprenant manucure soignée et soin visage coup d'éclat.",
      serviceIds: [byName("Manucure")._id, byName("Soin visage éclat")._id],
      priceTnd: 85,
    },
  ]);

  // Promotion de lancement
  const promoStart = new Date();
  const promoEnd = new Date();
  promoEnd.setDate(promoStart.getDate() + 30);
  await Promotion.create({
    organizationId: org._id,
    name: "Offre Bienvenue Salonia",
    code: "BIENVENUE20",
    type: "PERCENTAGE",
    value: 20,
    startsAt: promoStart,
    endsAt: promoEnd,
    maxUses: 100,
    usedCount: 14,
    active: true,
  });

  // ── Clients : 15 % « à risque » (absences fréquentes) ──
  const usedPhones = new Set<string>();
  const customers = await Customer.create(
    Array.from({ length: 320 }, () => {
      let phone: string;
      do phone = `${pick(["2", "5", "9"])}${Math.floor(1000000 + rand() * 8999999)}`; while (usedPhones.has(phone));
      usedPhones.add(phone);
      const firstName = pick(FIRST);
      return {
        organizationId: org._id,
        firstName,
        lastName: pick(LAST),
        phone,
        email: rand() < 0.5 ? `${firstName.toLowerCase()}.${Math.floor(rand() * 900 + 100)}@example.tn` : undefined,
        remindersConsent: rand() > 0.15,
      };
    }),
  );
  // La cliente de démo (client@salonia.tn) a aussi une fiche client, reliée à son compte.
  const clientUser = await User.findOne({ email: "client@salonia.tn" }).lean();
  customers.unshift(
    await Customer.create({ organizationId: org._id, firstName: "Sarra", lastName: "Mansouri", phone: "55123456", email: "client@salonia.tn", userId: clientUser?._id, remindersConsent: true }),
  );
  const risky = new Set(customers.filter(() => rand() < 0.15).map((c) => String(c._id)));

  // ── Rendez-vous : 10 semaines passées + 2 semaines à venir ──
  const now = new Date();
  const today = fromLocal(toLocal(now).year, toLocal(now).month, toLocal(now).day);
  const bookings: Record<string, unknown>[] = [];

  for (let d = -70; d <= 14; d++) {
    const day = addDays(today, d);
    const weekday = WEEKDAYS[toLocal(day).weekday];
    for (const center of centers) {
      const range = (center.openingHours as Record<string, string | null>)[weekday];
      if (!range) continue;
      const [open, close] = range.split("-").map(hhmmToMinutes);
      for (const member of staff.filter((s) => String(s.centerIds[0]) === String(center._id))) {
        // Remplissage plus faible pour les jours à venir (le calendrier se remplit au fil de l'eau).
        const fill = d > 0 ? 0.55 - d * 0.03 : 0.75;
        let cursor = open + Math.floor(rand() * 3) * 15;
        while (cursor < close - 30) {
          const service = pick(services);
          if (cursor + service.durationMinutes > close) break;
          if (rand() < fill) {
            const customer = pick(customers);
            const start = addMinutes(day, cursor);
            const end = addMinutes(start, service.durationMinutes);
            const leadDays = rand() < 0.25 ? rand() * 0.4 : rand() * 20;
            const createdAt = new Date(Math.min(start.getTime() - leadDays * 86_400_000, now.getTime()));
            const source = rand() < 0.55 ? "ONLINE" : "STAFF";
            let status = "CONFIRMED";
            if (end < now) {
              const hour = toLocal(start).hour;
              let pNoShow = risky.has(String(customer._id)) ? 0.35 : 0.04;
              if (hour < 10) pNoShow += 0.05;
              if (leadDays > 10) pNoShow += 0.05;
              if (!customer.remindersConsent) pNoShow += 0.08;
              if (source === "ONLINE") pNoShow += 0.03;
              const r = rand();
              status = r < 0.05 ? "CANCELLED" : r < 0.05 + pNoShow ? "NO_SHOW" : "COMPLETED";
            } else if (rand() < 0.12) {
              status = "PENDING";
            }
            bookings.push({
              organizationId: org._id,
              centerId: center._id,
              customerId: customer._id,
              staffId: member._id,
              items: [{ serviceId: service._id, name: service.name, durationMinutes: service.durationMinutes, priceTnd: service.priceTnd }],
              totalTnd: service.priceTnd,
              start,
              end,
              status,
              source,
              createdAt,
              updatedAt: createdAt,
              reminderSentAt: end < now && customer.remindersConsent ? addDays(start, -1) : undefined,
              ...(status === "CANCELLED" ? { cancelledAt: addDays(start, -1), cancelReason: "Empêchement" } : {}),
            });
            cursor += service.durationMinutes;
          }
          cursor += 15;
        }
      }
    }
  }
  // insertMany avec timestamps:false pour conserver les dates de création historiques.
  await Booking.insertMany(bookings, { timestamps: false } as never);

  // ── Pauses, fermeture et liste d'attente ──
  const nextMonday = addDays(today, ((8 - toLocal(today).weekday) % 7) || 7);
  await AvailabilityBlock.create([
    { organizationId: org._id, centerId: tunis._id, staffId: staff[0]._id, kind: "BREAK", start: addMinutes(addDays(today, 1), 13 * 60), end: addMinutes(addDays(today, 1), 14 * 60), reason: "Pause déjeuner" },
    { organizationId: org._id, centerId: sousse._id, staffId: null, kind: "CLOSURE", start: addDays(nextMonday, 3), end: addDays(nextMonday, 4), reason: "Inventaire annuel" },
    { organizationId: org._id, centerId: tunis._id, staffId: staff[1]._id, kind: "BLOCK", start: addMinutes(nextMonday, 9 * 60), end: addMinutes(nextMonday, 11 * 60), reason: "Formation balayage" },
  ]);
  await WaitlistEntry.create(
    [1, 2, 3, 5].map((d, i) => ({
      organizationId: org._id,
      centerId: i % 2 ? sousse._id : tunis._id,
      customerId: customers[i]._id,
      serviceId: pick(services)._id,
      desiredDate: addDays(today, d),
    })),
  );

  // ── Module 6 : paiements, factures et dépenses ──
  await seedFinance(org._id);

  const past = bookings.filter((b) => (b.end as Date) < now);
  const noShows = past.filter((b) => b.status === "NO_SHOW").length;
  console.log("✔ Données de démo créées (mot de passe : Demo1234)");
  console.log(`  3 centres · ${staff.length} praticiens · ${services.length} services · ${customers.length} clients`);
  console.log(`  ${bookings.length} rendez-vous (${past.length} passés dont ${noShows} absences, ${bookings.length - past.length} à venir)`);
  console.log("  Comptes : owner@ · manager@ · staff@ (ou 22 345 678) · client@ · admin@salonia.tn");
  console.log(`  Lien de réservation publique : /reserver/salon-yasmine`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
