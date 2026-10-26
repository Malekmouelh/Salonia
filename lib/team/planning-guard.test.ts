// F4 (étape 6) — Garde-fous STRUCTURELS du planning personnel : lecture seule, droits exigés côté serveur, aucune donnée sensible
// lue. Ces tests lisent le code source (la page et les composants ne peuvent pas être exécutés hors d'une requête Next.js) ;
// ils complètent les tests de comportement de planning-data.test.ts. Lancer : npm test
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = read("app/dashboard/planning/page.tsx");
const data = read("lib/data/planning.ts");
const view = read("components/team/planning-view.tsx");
const nav = read("components/dashboard/nav.tsx");
const teamList = read("components/team/team-list.tsx");

describe("planning personnel : page", () => {
  it("exige un rôle côté serveur avant toute lecture, et renvoie propriétaire/gérant vers l'équipe sans employé choisi", () => {
    const role = page.indexOf('requireRole("STAFF", "OWNER", "MANAGER")');
    assert.ok(role >= 0, "requireRole manquant");
    assert.ok(role < page.indexOf("getStaffPlanning("), "la lecture précède la vérification du rôle");
    assert.match(page, /user\.role !== "STAFF" && !staffId\) redirect\("\/dashboard\/equipe"\)/);
  });

  it("n'importe aucune Server Action et n'écrit rien", () => {
    assert.doesNotMatch(page, /@\/app\/actions|"use server"/);
    assert.doesNotMatch(view, /@\/app\/actions|"use server"/);
  });
});

describe("planning personnel : lecture serveur", () => {
  it("ne contient aucune opération d'écriture en base", () => {
    assert.doesNotMatch(data, /\.(create|insertMany|insertOne|updateOne|updateMany|deleteOne|deleteMany|save|findOneAndUpdate|findByIdAndUpdate|findOneAndDelete|bulkWrite|replaceOne)\(/);
  });

  it("n'importe aucune action et n'appelle ni le moteur de réservation ni l'audit", () => {
    assert.doesNotMatch(data, /@\/app\/actions|@\/lib\/booking\/(availability|create|reminders)|logEvent/);
  });

  it("ne lit jamais le téléphone, les notes, les prix, le risque ni le motif des absences et des blocs", () => {
    const selects = [...data.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1]);
    assert.ok(selects.length >= 4, "sélections attendues introuvables");
    for (const s of selects) assert.doesNotMatch(s, /phone|notes|totalTnd|reason|reminder|promo|risk|email/i, s);
    const populate = [...data.matchAll(/\.populate<[^>]*>\([^)]*\)/g)].map((m) => m[0]);
    for (const p of populate) assert.doesNotMatch(p, /phone|email|notes/i, p);
  });

  it("filtre chaque requête par organisation", () => {
    for (const model of ["Booking", "StaffTimeOff", "AvailabilityBlock", "Center", "User"]) {
      const call = data.match(new RegExp(`${model}\\.find(One)?\\(\\{[\\s\\S]*?\\}\\)`));
      assert.ok(call, model);
      assert.match(call![0], /organizationId/, `${model} sans organizationId`);
    }
  });
});

describe("planning personnel : vue en lecture seule", () => {
  it("n'a ni bouton, ni formulaire, ni transition : uniquement des liens de navigation", () => {
    assert.doesNotMatch(view, /<button|<form|useTransition|onSubmit|onClick/);
    assert.doesNotMatch(view, /setBookingStatus|cancelBooking|rescheduleBooking|createStaffBooking/);
  });

  it("isole les dates et les heures (bdi) et inverse les flèches en RTL", () => {
    assert.match(view, /<bdi dir="ltr">/);
    assert.match(view, /rtl:-scale-x-100/);
  });
});

describe("planning personnel : accès", () => {
  it("le lien « Mon planning » de la navigation est réservé aux STAFF", () => {
    assert.match(nav, /\{ href: "\/dashboard\/planning", label: "Mon planning", icon: \w+, roles: \["STAFF"\] \}/);
  });

  it("la carte de l'équipe (propriétaire et gérants) contient un lien vers le planning de l'employé", () => {
    assert.match(teamList, /href=\{`\/dashboard\/planning\?staff=\$\{m\.id\}`\}/);
  });

  it("aucune nouvelle Server Action n'a été ajoutée pour le planning", () => {
    const files = readdirSync(join(process.cwd(), "app/actions"));
    assert.ok(!files.some((f) => /planning/i.test(f)), files.join(", "));
    assert.ok(!/planning/i.test(read("app/actions/team.ts")));
    assert.ok(existsSync(join(process.cwd(), "lib/data/planning.ts")));
  });
});
