// Module 5 — Garde-fous du bac à sable (scripts/stock-sandbox.ts) et de l'intégration de l'interface. Test STRUCTUREL : il lit le code
// source ; il ne lance ni serveur ni base. Il protège les promesses d'isolation contre une modification accidentelle du script.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const code = (path: string) => read(path).replace(/^\s*\/\/.*$/gm, "");

describe("bac à sable du Module 5 : isolation", () => {
  const script = code("scripts/stock-sandbox.ts");

  it("ne lit jamais un fichier .env et ne copie aucun .env* (exclusion + contrôle de la copie)", () => {
    assert.doesNotMatch(script, /readFileSync\([^)]*\.env|dotenv|loadEnvFile|process\.loadEnvFile/);
    assert.match(script, /"\.env\*"/);
    assert.match(script, /startsWith\("\.env"\)/);
  });

  it("impose MONGODB_URI et MONGODB_DB AVANT le premier import de l'application, puis contrôle la connexion réellement ouverte", () => {
    const setUri = script.indexOf("process.env.MONGODB_URI = uri");
    const firstAppImport = script.indexOf('await import("@/lib/db")');
    assert.ok(setUri > 0 && firstAppImport > setUri);
    assert.doesNotMatch(script.slice(0, setUri), /from "@\/lib\//); // aucun import statique de l'application avant l'imposition
    assert.match(script, /LOCAL_HOSTS\.has\(conn\.host\)/);
    assert.match(script, /conn\.name !== dbName/);
    assert.match(script, /MongoMemoryServer\.create\(\{ instance: \{ ip: "127\.0\.0\.1" \} \}\)/);
  });

  it("construit l'environnement du serveur de zéro (aucun spread de process.env) avec ses propres secrets aléatoires", () => {
    const envBlock = script.slice(script.indexOf("env: {"), script.indexOf("child.on") > 0 ? script.indexOf("server.on") : undefined);
    assert.doesNotMatch(envBlock, /\.\.\.process\.env/);
    assert.match(envBlock, /AUTH_SECRET: randomBytes\(32\)/);
    assert.match(envBlock, /ANTHROPIC_API_KEY: ""/);
    assert.match(envBlock, /MONGODB_URI: uri/);
  });

  it("refuse le port 3000, un port occupé, et ne tue que son propre groupe de processus enfant", () => {
    assert.match(script, /PORT === 3000/);
    assert.match(script, /isPortFree\(PORT\)/);
    assert.match(script, /detached: true/);
    assert.match(script, /process\.kill\(-child\.pid/);
    assert.doesNotMatch(script, /pkill|killall|lsof|kill -9|execSync\(|3000/.test(script) ? /^$/ : /\bpkill\b|\bkillall\b|\blsof\b/);
    for (const kill of script.matchAll(/process\.kill\(([^,]+),/g)) assert.equal(kill[1].trim(), "-child.pid");
  });

  it("supprime uniquement le dossier temporaire qu'il a créé, ne touche ni .next ni node_modules du projet", () => {
    assert.match(script, /includes\("salonia-stock-sandbox-"\)/);
    assert.match(script, /startsWith\(resolve\(tmpdir\(\)\)/);
    const removals = [...script.matchAll(/rmSync\(([^,]+),/g)].map((m) => m[1].trim());
    assert.deepEqual(removals, ["copyDir"]);
    assert.match(script, /cp", \["-Rc", join\(source, "node_modules"\), join\(target, "node_modules"\)\]/); // lecture de l'original, écriture dans la copie
  });

  it("ne modifie ni local-db.ts ni les scripts de seed existants (aucune référence)", () => {
    assert.doesNotMatch(script, /local-db|seed-finance|scripts\/seed\.ts|db:seed/);
  });

  it("les comptes de démonstration sont de vrais comptes hachés (bcrypt) ; aucun contournement d'authentification", () => {
    assert.match(script, /bcrypt\.hash\(DEMO_PASSWORD, 12\)/);
    assert.doesNotMatch(script, /AUTH_BYPASS|skipAuth|bypass/i);
  });
});

describe("intégration de l'interface du stock", () => {
  it("la navigation du tableau de bord expose « Matériel & stock » au propriétaire et au gérant seulement", () => {
    const nav = read("components/dashboard/nav.tsx");
    assert.match(nav, /href: "\/dashboard\/stock", label: "Matériel & stock", icon: BoxIcon, roles: \["OWNER", "MANAGER"\]/);
  });

  it("la carte « Matériel & stock » de l'accueil est active et ne devient un lien que pour le propriétaire et le gérant", () => {
    const page = read("app/dashboard/page.tsx");
    assert.match(page, /name: "Matériel & stock"[^}]*status: "Actif"[^}]*href: "\/dashboard\/stock"/);
    assert.doesNotMatch(page, /name: "Matériel & stock"[^}]*"Bientôt"/);
    assert.match(page, /user\.role === "OWNER" \|\| user\.role === "MANAGER"/);
  });

  it("chaque page du stock exige un rôle côté serveur ; les recettes sont réservées au propriétaire ; aucune page n'accède aux collections", () => {
    const pages: [string, string][] = [
      ["app/dashboard/stock/page.tsx", 'requireRole("OWNER", "MANAGER")'],
      ["app/dashboard/stock/materiel/page.tsx", 'requireRole("OWNER", "MANAGER")'],
      ["app/dashboard/stock/fournisseurs/page.tsx", 'requireRole("OWNER", "MANAGER")'],
      ["app/dashboard/stock/commandes/page.tsx", 'requireRole("OWNER", "MANAGER")'],
      ["app/dashboard/stock/recettes/page.tsx", 'requireRole("OWNER")'],
    ];
    for (const [path, guard] of pages) {
      const source = read(path);
      assert.ok(source.includes(guard), `${path} : ${guard} manquant`);
      assert.match(source, /<Suspense/);
      assert.doesNotMatch(source, /@\/lib\/models\//);
    }
    assert.doesNotMatch(read("app/dashboard/stock/recettes/page.tsx"), /"MANAGER"/);
  });

  it("les composants client n'importent jamais de modèle ni de code serveur : seulement des actions, des étiquettes et des types", () => {
    for (const file of ["stock-hub", "stock-modals", "stock-shared", "materiel-manager", "suppliers-manager", "orders-manager", "recipes-manager"]) {
      const source = read(`components/stock/${file}.tsx`);
      assert.doesNotMatch(source, /@\/lib\/models\/|server-only|@\/lib\/db|@\/lib\/dal/, file);
      for (const m of source.matchAll(/^import (?!type)[^;]*from "(@\/lib\/stock\/[^"]+)"/gm)) assert.match(m[1], /labels$/, `${file} : import non-type de ${m[1]}`);
    }
  });

  it("la lecture des pages passe par lib/data/stock.ts, qui n'appelle que des services du stock et programme la réparation APRÈS la réponse", () => {
    const data = code("lib/data/stock.ts");
    assert.doesNotMatch(data, /@\/lib\/models\/(?!stock)/);
    assert.doesNotMatch(data, /\b[A-Z][A-Za-z]+\.(find|findOne|findById|aggregate|countDocuments|exists)\(/); // aucune requête de modèle (Mongoose) dans la couche de lecture
    assert.match(data, /after\(async \(\) => \{[\s\S]*repairStockLevels\(user, stale\)/);
  });
});
