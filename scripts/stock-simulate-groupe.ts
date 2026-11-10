// Historique de consommation SIMULÉ sur PLUSIEURS centres, pour utiliser l'onglet « Analyses IA » (Module 5) dans l'application normale.
//
// AJOUT SEULEMENT : le script ne modifie et ne supprime rien de ce qui existe déjà. Il crée 6 NOUVEAUX produits préfixés « [Démo] » (Coloration 7.0,
// Oxydant 30 vol, Shampoing doux, Gants latex, Spray fixateur, Lotion tonique), les active dans trois centres de l'organisation, puis y écrit
// 84 jours de mouvements du journal (note « Simulation de démonstration », rendez-vous FICTIFS). Aucun rendez-vous, aucune facture, aucun autre module.
// Un produit « [Démo] » qui a déjà des mouvements est refusé : on ne mélange jamais de fausses données à de vraies.
//
// Usage (racine du projet, Windows PowerShell) — TOUJOURS commencer par --dry-run, qui n'écrit rien :
//   npx.cmd tsx scripts/stock-simulate-groupe.ts --dry-run
//   npx.cmd tsx scripts/stock-simulate-groupe.ts                       (affiche la base, demande d'en retaper le nom)
// Options : --org "Nom"  (si plusieurs organisations) · --tunis "Nom" --sousse "Nom" --djerba "Nom" (si les noms des centres ne contiennent pas ces mots)
//           --days 84 (28 à 120) · --yes (sans confirmation)
// Pour retirer la simulation : --undo (supprime uniquement les mouvements simulés des produits « [Démo] » ; les produits restent, archivez-les dans l'application).
//
// La base est celle de votre .env (comme `npm run db:seed`) ; le script en AFFICHE le nom et exige de le retaper avant d'écrire.
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Center, Organization, User } from "@/lib/models/core";
import { StockLevel, StockMovement, StockProduct } from "@/lib/models/stock";
import { DEMO_SCENARIO, planScenario, writeScenario } from "@/lib/stock/simulate-centers";
import { SIMULATION_NOTE, SimulationError, assertSimulationTarget, undoSimulation } from "@/lib/stock/simulate-history";
import { verifyLedger } from "@/lib/stock/ledger";
import { activateProductInCenter, createProduct } from "@/lib/stock/service";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const PREFIX = "[Démo] ";
const norm = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fail = (message: string): never => {
  throw new SimulationError(message);
};

async function main() {
  const days = option("days") === undefined ? 84 : Number(option("days"));
  if (!Number.isInteger(days) || days < 28 || days > 120) fail("--days doit être un entier de 28 à 120.");
  const undo = flag("undo");

  await connectDB();
  const connection = mongoose.connection;
  const local = ["127.0.0.1", "localhost", "::1"].includes(connection.host);
  console.log(`\nBase : ${connection.name} (${local ? "locale" : `distante : ${connection.host}`})`);
  if (!local) console.log("⚠ Base distante : si elle est partagée avec votre équipe, ces produits et mouvements seront visibles de tous les membres de l'organisation.");

  // Organisation.
  const organizations = await Organization.find({}).select("name slug").lean();
  const wantedOrg = option("org");
  const pool = wantedOrg ? organizations.filter((o) => norm(o.name) === norm(wantedOrg) || norm(o.name).includes(norm(wantedOrg))) : organizations;
  if (pool.length !== 1) fail(`${pool.length === 0 ? "Aucune organisation trouvée" : "Plusieurs organisations"} : précisez --org "Nom". Organisations : ${organizations.map((o) => o.name).join(" | ") || "(aucune)"}`);
  const org = pool[0];

  // Centres : un par profil du scénario (nom exact, sinon une partie du nom qui ne désigne qu'un centre).
  const centers = await Center.find({ organizationId: org._id }).select("name governorate").lean();
  const pick = (profile: string) => {
    const wanted = norm(option(profile) ?? profile);
    const exact = centers.filter((c) => norm(c.name) === wanted);
    const partial = centers.filter((c) => norm(c.name).includes(wanted));
    const found = exact.length === 1 ? exact : partial;
    if (found.length !== 1) fail(`Centre « ${option(profile) ?? profile} » ${found.length === 0 ? "introuvable" : "ambigu"} dans ${org.name}. Centres : ${centers.map((c) => c.name).join(" | ")}. Utilisez --${profile} "Nom du centre".`);
    return found[0];
  };
  const chosen = { tunis: pick("tunis"), sousse: pick("sousse"), djerba: pick("djerba") };
  if (new Set(Object.values(chosen).map((c) => String(c._id))).size !== 3) fail("Les trois profils doivent désigner trois centres différents.");

  // Propriétaire de l'organisation : les services appliquent les mêmes droits et la même isolation que l'application.
  const ownerDoc = await User.findOne({ organizationId: org._id, role: "OWNER" }).sort({ createdAt: 1 }).lean();
  if (!ownerDoc) fail(`Aucun propriétaire trouvé pour ${org.name}.`);
  const owner = {
    id: String(ownerDoc!._id),
    role: "OWNER" as const,
    centerIds: (ownerDoc!.centerIds ?? []).map(String),
    organization: { id: String(org._id), name: org.name, slug: org.slug, centers: centers.map((c) => ({ id: String(c._id), name: c.name, governorate: c.governorate })) },
  };
  const centerIds: Record<string, string> = { tunis: String(chosen.tunis._id), sousse: String(chosen.sousse._id), djerba: String(chosen.djerba._id) };

  console.log(`Organisation : ${org.name}`);
  console.log(`Centres : tunis → ${chosen.tunis.name} · sousse → ${chosen.sousse.name} · djerba → ${chosen.djerba.name}`);

  // Produits du scénario : déjà présents (à réutiliser s'ils sont vides) ou à créer.
  const existing = new Map<string, string>();
  for (const p of DEMO_SCENARIO.products) {
    const found = await StockProduct.find({ organizationId: org._id, name: `${PREFIX}${p.name}` }).select("_id").lean();
    if (found.length > 1) fail(`Plusieurs produits « ${PREFIX}${p.name} » existent : nettoyez-les d'abord dans l'application.`);
    if (found.length === 1) existing.set(p.key, String(found[0]._id));
  }
  const keyOf = (center: string, productKey: string, productId: string) => ({ organizationId: String(org._id), productId, centerId: centerIds[center] });

  if (undo) {
    console.log(`\nAction : RETIRER les mouvements simulés des produits « ${PREFIX}… » (les vrais mouvements ne sont jamais supprimés ; un produit contenant un vrai mouvement est refusé).`);
  } else {
    const plan = planScenario(DEMO_SCENARIO, days);
    const total = plan.pairs.reduce((s, p) => s + p.events.length + 1, 0);
    console.log(`\nAction : ÉCRIRE ${total} mouvements sur ${plan.pairs.length} couples produit/centre, ${days} jours d'historique (${Object.entries(plan.bookingsByCenter).map(([k, n]) => `${n} rendez-vous fictifs ${k}`).join(", ")}).`);
    console.log(`Produits à créer : ${DEMO_SCENARIO.products.filter((p) => !existing.has(p.key)).map((p) => PREFIX + p.name).join(", ") || "aucun"}`);
    console.log(`Produits « ${PREFIX}… » déjà présents (réutilisés) : ${DEMO_SCENARIO.products.filter((p) => existing.has(p.key)).map((p) => PREFIX + p.name).join(", ") || "aucun"}`);
    // Les produits existants doivent être activés et sans mouvement dans les trois centres.
    for (const [productKey, productId] of existing) {
      for (const center of Object.keys(centerIds)) {
        const key = keyOf(center, productKey, productId);
        if (await StockMovement.exists(key)) fail(`« ${PREFIX}${DEMO_SCENARIO.products.find((p) => p.key === productKey)!.name} » a déjà des mouvements dans ${center} : le script ne travaille que sur des produits neufs. Lancez --undo ou supprimez ce produit dans l'application.`);
      }
    }
    console.log("Contrôles : aucun produit « [Démo] » ne contient déjà de mouvements : OK. Rien d'existant n'est modifié.");
    if (flag("dry-run")) {
      console.log("\n--dry-run : rien n'a été écrit.");
      return;
    }
  }

  if (!flag("yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\nTapez le nom de la base (${connection.name}) pour confirmer, autre chose pour annuler : `)).trim();
    rl.close();
    if (answer !== connection.name) {
      console.log("Annulé : rien n'a été écrit.");
      return;
    }
  }

  if (undo) {
    let removed = 0;
    for (const [productKey, productId] of existing) {
      for (const center of Object.keys(centerIds)) {
        try {
          removed += (await undoSimulation(keyOf(center, productKey, productId))).removed;
        } catch (error) {
          if (!(error instanceof SimulationError) || !/Aucune simulation/.test(error.message)) throw error;
        }
      }
    }
    console.log(`\nSimulation retirée : ${removed} mouvements supprimés. Les produits « ${PREFIX}… » restent : archivez-les depuis l'application si vous le souhaitez.`);
    return;
  }

  // Écriture : produits neufs (via le service, mêmes règles que l'application), activation à 0, puis journal.
  const products: Record<string, string> = {};
  for (const p of DEMO_SCENARIO.products) {
    if (existing.has(p.key)) products[p.key] = existing.get(p.key)!;
    else {
      const created = await createProduct(owner, { name: `${PREFIX}${p.name}`, unit: p.unit });
      if (!created.ok) fail(`Création de « ${PREFIX}${p.name} » refusée : ${created.message}`);
      else products[p.key] = created.product.id;
    }
    for (const center of Object.keys(centerIds)) {
      const level = await StockLevel.exists({ organizationId: org._id, productId: products[p.key], centerId: centerIds[center] });
      if (!level) {
        const activated = await activateProductInCenter(owner, { productId: products[p.key], centerId: centerIds[center], alertThreshold: p.threshold, initialQuantity: 0 });
        if (!activated.ok) fail(`Activation de « ${PREFIX}${p.name} » dans ${center} refusée : ${activated.message}`);
      }
      await assertSimulationTarget(keyOf(center, p.key, products[p.key]));
    }
  }
  const written = await writeScenario(planScenario(DEMO_SCENARIO, days), (center, productKey) => keyOf(center, productKey, products[productKey]));
  let anomalies = 0;
  for (const p of DEMO_SCENARIO.products) for (const center of Object.keys(centerIds)) anomalies += (await verifyLedger(keyOf(center, p.key, products[p.key]))).issues.length;
  console.log(`\nSimulation écrite : ${written.movements} mouvements sur ${written.pairs} couples produit/centre (note « ${SIMULATION_NOTE} »).`);
  console.log(anomalies === 0 ? "Contrôle du journal : aucune anomalie." : `⚠ Contrôle du journal : ${anomalies} anomalie(s).`);
  console.log("Ouvrez Matériel et stock → Analyses IA (en propriétaire).");
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof SimulationError ? "Refusé" : "Erreur"} : ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
