// Module 5 — Chaque texte visible de l'interface du stock a sa traduction arabe. Test pur (lecture du code source).
// Convention vérifiée : tout texte passe par t("…"), <T>…</T> ou par une prop texte des composants d'aide (label, title, subtitle,
// empty, hint, accent). Les messages renvoyés par les actions sont déjà couverts par lib/stock/i18n.test.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AR } from "@/lib/i18n-ar";

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}
const FILES = [...sourceFiles("components/stock"), ...sourceFiles("app/dashboard/stock")];

const literals = (text: string) => [...text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));

// Textes affichés d'un fichier : arguments de t(…) (parenthèses équilibrées, ternaires compris), props texte, libellés, <T>.
function uiStrings(source: string) {
  const found = new Set<string>();
  for (const m of source.matchAll(/\bt\(/g)) {
    let depth = 1;
    let j = m.index! + m[0].length;
    const start = j;
    while (j < source.length && depth > 0) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") depth--;
      j++;
    }
    literals(source.slice(start, j - 1)).forEach((x) => found.add(x));
  }
  for (const m of source.matchAll(/\b(?:label|title|subtitle|empty|hint|accent)="((?:[^"\\\n]|\\.)*)"/g)) found.add(m[1]);
  for (const m of source.matchAll(/\blabel:\s*"((?:[^"\\\n]|\\.)*)"/g)) found.add(m[1]);
  for (const m of source.matchAll(/\[\s*"(?:levels|products)"\s*,\s*"([^"]+)"\s*\]/g)) found.add(m[1]);
  for (const m of source.matchAll(/<T>([^<{]+)<\/T>/g)) found.add(m[1].trim());
  // Ni clés techniques (une seule « parole » en minuscules sans accent, hors prop accent) ni classes CSS.
  return [...found].filter((x) => /[A-Za-zÀ-ÿ]/.test(x));
}

describe("interface du stock : traductions arabes", () => {
  it("les fichiers de l'interface sont bien trouvés", () => {
    assert.ok(FILES.length >= 12, FILES.join(", "));
  });

  it("les fenêtres et l'historique des transferts (F5.6) sont couverts par ces contrôles, avec des classes logiques pour le sens de lecture", () => {
    const file = "components/stock/transfer-modals.tsx";
    assert.ok(FILES.map((f) => f.replaceAll("\\", "/")).includes(file), "transfer-modals.tsx absent de la liste contrôlée");
    const source = readFileSync(join(root, file), "utf8");
    assert.match(source, /rtl:rotate-180/); // la flèche source → destination est inversée en arabe
    assert.match(source, /<DateText value=\{x\.createdAt\} withTime \/>/); // date isolée (<bdi>) dans DateText
    assert.match(source, /disabled=\{pending\}|SubmitButton pending=\{pending\}/); // pas de double envoi
  });

  it("chaque texte visible a une traduction (clé présente dans AR)", () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of FILES) {
      for (const text of uiStrings(readFileSync(join(root, file), "utf8"))) {
        total++;
        if (!(text in AR)) missing.push(`${file} : « ${text} »`);
      }
    }
    assert.ok(total > 150, `extraction suspecte : ${total} textes`);
    assert.deepEqual(missing, []);
  });

  it("aucune traduction n'est vide, hormis l'article « Les » (supprimé volontairement en arabe)", () => {
    const empty: string[] = [];
    for (const file of FILES) for (const text of uiStrings(readFileSync(join(root, file), "utf8"))) if (text in AR && AR[text].trim() === "" && text !== "Les") empty.push(text);
    assert.deepEqual(empty, []);
  });

  it("l'interface n'utilise que des classes logiques pour l'orientation (RTL) : pas de ml-/mr-/pl-/pr-/left-/right-/text-left/text-right", () => {
    const physical = /(?:^|[\s"'`])(?:-?(?:ml|mr|pl|pr)-\d|left-\d|right-\d|text-left|text-right|border-l(?:-|\s|")|border-r(?:-|\s|")|rounded-l(?:-|\s|")|rounded-r(?:-|\s|"))/;
    const offenders = FILES.filter((file) => physical.test(readFileSync(join(root, file), "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("aucun texte visible n'est écrit en dur hors t(), <T> ou prop texte : pas de JSX « >Texte français< » direct", () => {
    // Un texte JSX direct ressemble à >Mot suivi de lettres< ; les nombres, symboles et {expressions} sont exclus.
    const direct = /<(?:p|span|h[1-6]|li|button|label|legend|option|dt|dd|a)\b[^>]*>\s*[A-ZÀ-Ý][a-zà-ÿ]{2,}[^<{]*</;
    const offenders = FILES.filter((file) => direct.test(readFileSync(join(root, file), "utf8")));
    assert.deepEqual(offenders, []);
  });
});
