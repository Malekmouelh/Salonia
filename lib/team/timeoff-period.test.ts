// F4 — Affichage de la période d'une absence (français et arabe RTL) : parties à afficher et structure du rendu.
// Test STRUCTUREL : on appelle le composant (fonction pure) et on sérialise l'arbre d'éléments obtenu pour vérifier que
// chaque date est isolée, qu'aucune direction n'est imposée au conteneur et que la flèche suit le sens de la page.
// (react-dom/server n'est pas utilisable ici : `npm test` s'exécute avec la condition « react-server », sous laquelle
// il est volontairement désactivé.) Le rendu visuel réel (ordre d'affichage des chiffres, des mois et de la flèche)
// se vérifie dans un navigateur ; voir le rapport de cette étape. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReactNode } from "react";
import { TimeOffPeriod } from "@/components/team/timeoff-period";
import { fromLocal } from "@/lib/booking/time";
import { timeOffPeriodParts, timeOffPeriodText } from "./timeoff-period";

const iso = (d: Date) => d.toISOString();
const oneDay = { start: iso(fromLocal(2030, 1, 8)), end: iso(fromLocal(2030, 1, 9)), allDay: true };
const severalDays = { start: iso(fromLocal(2030, 1, 8)), end: iso(fromLocal(2030, 1, 11)), allDay: true }; // 8 au 10 inclus
const yearBoundary = { start: iso(fromLocal(2030, 12, 30)), end: iso(fromLocal(2031, 1, 3)), allDay: true }; // 30 déc. au 2 janv.
const range = { start: iso(fromLocal(2030, 1, 8, 9, 0)), end: iso(fromLocal(2030, 1, 8, 13, 0)), allDay: false };

const ARABIC = /\p{Script=Arabic}/u;
// Sérialise un arbre d'éléments React en balisage (éléments HTML, fragments, textes) pour pouvoir le comparer.
function toMarkup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toMarkup).join("");
  const element = node as { type: unknown; props: Record<string, unknown> };
  const { children, className, ...rest } = element.props;
  if (typeof element.type !== "string") return toMarkup(children as ReactNode); // fragment
  const attrs = [className ? ` class="${className}"` : "", ...Object.entries(rest).map(([k, v]) => ` ${k}="${v}"`)].join("");
  return `<${element.type}${attrs}>${toMarkup(children as ReactNode)}</${element.type}>`;
}
const render = (entry: typeof oneDay, lang: string) => toMarkup(TimeOffPeriod({ parts: timeOffPeriodParts(entry, lang) }));
// Squelette du rendu : les balises seules, sans le texte (identique en français et en arabe).
const skeleton = (html: string) => html.replace(/>[^<]+</g, "><");

describe("timeOffPeriodParts", () => {
  for (const lang of ["fr", "ar"]) {
    describe(`langue ${lang}`, () => {
      it("un jour : une seule date, sans plage horaire", () => {
        const p = timeOffPeriodParts(oneDay, lang);
        assert.equal(p.dates.length, 1);
        assert.equal(p.times, null);
        assert.match(p.dates[0], /8/);
        assert.match(p.dates[0], /2030/);
      });

      it("plusieurs jours : deux dates, le dernier jour inclus (la fin enregistrée est exclusive)", () => {
        const p = timeOffPeriodParts(severalDays, lang);
        assert.equal(p.dates.length, 2);
        assert.match(p.dates[0], /\b8\b/);
        assert.match(p.dates[1], /\b10\b/); // pas 11
        assert.equal(p.times, null);
      });

      it("à cheval sur deux mois et deux années", () => {
        const p = timeOffPeriodParts(yearBoundary, lang);
        assert.equal(p.dates.length, 2);
        assert.match(p.dates[0], /30/);
        assert.match(p.dates[0], /2030/);
        assert.match(p.dates[1], /\b2\b/);
        assert.match(p.dates[1], /2031/);
      });

      it("plage horaire : une date et deux heures à l'heure de Tunis", () => {
        const p = timeOffPeriodParts(range, lang);
        assert.equal(p.dates.length, 1);
        assert.deepEqual(p.times?.map((t) => t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))), ["09:00", "13:00"]);
      });
    });
  }

  it("les mois sont écrits dans la langue demandée", () => {
    assert.ok(!ARABIC.test(timeOffPeriodParts(severalDays, "fr").dates.join(" ")));
    assert.ok(ARABIC.test(timeOffPeriodParts(severalDays, "ar").dates.join(" ")));
  });

  it("le texte brut (étiquettes d'accessibilité) joint les parties sans mise en forme", () => {
    const fr = timeOffPeriodParts(severalDays, "fr");
    assert.equal(timeOffPeriodText(fr), `${fr.dates[0]} → ${fr.dates[1]}`);
    const single = timeOffPeriodParts(oneDay, "ar");
    assert.equal(timeOffPeriodText(single), single.dates[0]);
    const r = timeOffPeriodParts(range, "fr");
    assert.equal(timeOffPeriodText(r), `${r.dates[0]} · ${r.times![0]} → ${r.times![1]}`);
  });
});

describe("<TimeOffPeriod> : structure du rendu", () => {
  for (const lang of ["fr", "ar"]) {
    it(`[${lang}] plusieurs jours : chaque date dans son <bdi>, une flèche entre les deux`, () => {
      const html = render(severalDays, lang);
      const [first, last] = timeOffPeriodParts(severalDays, lang).dates as [string, string];
      assert.equal((html.match(/<bdi>/g) ?? []).length, 2);
      assert.ok(html.includes(`<bdi>${first}</bdi>`));
      assert.ok(html.includes(`<bdi>${last}</bdi>`));
      assert.equal((html.match(/→/g) ?? []).length, 1);
      // La flèche est entre les deux dates, dans l'ordre du document (l'ordre visuel suit le sens de la page).
      assert.ok(html.indexOf(first) < html.indexOf("→") && html.indexOf("→") < html.indexOf(last));
    });

    it(`[${lang}] une flèche inversée en RTL, et aucune direction imposée au conteneur`, () => {
      const html = render(severalDays, lang);
      assert.match(html, /<span class="[^"]*rtl:-scale-x-100[^"]*">→<\/span>/);
      const rootTag = html.match(/^<span[^>]*>/)![0];
      assert.doesNotMatch(rootTag, /\bdir=/); // le sens vient de la page, pas du composant
      assert.doesNotMatch(html, /<bdi dir="rtl"/);
    });

    it(`[${lang}] un jour : une seule date isolée, sans flèche`, () => {
      const html = render(oneDay, lang);
      assert.equal((html.match(/<bdi/g) ?? []).length, 1);
      assert.ok(!html.includes("→"));
    });

    it(`[${lang}] plage horaire : date isolée, heures isolées en gauche-à-droite, flèche entre les heures`, () => {
      const html = render(range, lang);
      assert.equal((html.match(/<bdi>/g) ?? []).length, 1); // la date
      assert.equal((html.match(/<bdi dir="ltr">/g) ?? []).length, 2); // les deux heures
      assert.equal((html.match(/→/g) ?? []).length, 1);
      assert.match(html, /aria-hidden="true"[^>]*>·</);
    });
  }

  it("la structure est identique en français et en arabe : seuls les textes changent", () => {
    for (const entry of [oneDay, severalDays, yearBoundary, range]) {
      assert.equal(skeleton(render(entry, "fr")), skeleton(render(entry, "ar")));
    }
  });

  it("n'utilise plus un conteneur forcé en gauche-à-droite pour toute la période", () => {
    for (const lang of ["fr", "ar"]) assert.doesNotMatch(render(severalDays, lang), /^<span dir="ltr"/);
  });
});
