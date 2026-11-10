// Historique de consommation SIMULÉ pour voir et tester la prévision de stock (IA du Module 5) dans l'application normale.
//
// 1) Dans l'application : créez un produit (avec son fournisseur habituel), puis activez-le dans un centre avec un seuil d'alerte
//    et un stock initial de 0 (le script refuse un produit qui a déjà des mouvements).
// 2) Lancez (depuis la racine du projet, sous Windows PowerShell) :
//      npx.cmd tsx scripts/stock-simulate-history.ts --product "[Démo] Shampoing" --center "Tunis" --per-day 70 --stock 300
//    Options : --days 56 (14 à 120) · --flat (consommation identique tous les jours) · --dry-run (affiche sans écrire) · --yes (sans confirmation)
// 3) Rechargez la page « Matériel et stock » : la carte de prévision apparaît. Changez ensuite seuil, entrées, sorties, commandes depuis l'application.
// 4) Pour retirer la simulation d'un produit :
//      npx.cmd tsx scripts/stock-simulate-history.ts --product "[Démo] Shampoing" --center "Tunis" --undo
//
// Ce que le script écrit : uniquement les mouvements et le niveau de CE produit dans CE centre (voir lib/stock/simulate-history.ts). Aucun rendez-vous,
// aucune facture, aucun autre module. Il lit la base indiquée par votre .env (comme `npm run db:seed`) et AFFICHE son nom avant d'écrire : tapez ce
// nom pour confirmer. Les consommations simulées pointent vers des rendez-vous fictifs ; elles portent la note « Simulation de démonstration ».
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Center, Organization } from "@/lib/models/core";
import { StockProduct } from "@/lib/models/stock";
import { SIMULATION_NOTE, SimulationError, applySimulation, assertSimulationTarget, planHistory, undoSimulation } from "@/lib/stock/simulate-history";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const intOption = (name: string, fallback?: number) => {
  const raw = option(name);
  if (raw === undefined) return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
};

const USAGE = `Usage : npx.cmd tsx scripts/stock-simulate-history.ts --product "NOM" --center "CENTRE" --per-day 70 --stock 300 [--days 56] [--flat] [--dry-run] [--yes]
        npx.cmd tsx scripts/stock-simulate-history.ts --product "NOM" --center "CENTRE" --undo [--yes]`;

const fail = (message: string): never => {
  throw new SimulationError(message);
};
const norm = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function main() {
  const productName = option("product");
  const centerName = option("center");
  if (!productName || !centerName) fail(`Il faut --product et --center.\n${USAGE}`);
  const undo = flag("undo");
  const perDay = intOption("per-day");
  const stock = intOption("stock");
  const days = intOption("days", 56);
  if (!undo && (perDay === undefined || stock === undefined)) fail(`Il faut --per-day et --stock (le stock final voulu, par exemple 300).\n${USAGE}`);

  await connectDB();
  const connection = mongoose.connection;
  const local = ["127.0.0.1", "localhost", "::1"].includes(connection.host);

  // Produit (insensible à la casse), parmi les produits actifs.
  const products = await StockProduct.find({ name: productName, active: true }).collation({ locale: "fr", strength: 2 }).lean();
  if (products.length === 0) {
    const names = (await StockProduct.find({ active: true }).select("name").sort({ name: 1 }).limit(15).lean()).map((p) => p.name);
    fail(`Produit « ${productName} » introuvable parmi les produits actifs.${names.length ? `\nProduits existants : ${names.join(", ")}` : ""}`);
  }
  const organizations = await Organization.find({ _id: { $in: products.map((p) => p.organizationId) } }).select("name").lean();
  if (products.length > 1) fail(`Plusieurs produits portent ce nom (organisations : ${organizations.map((o) => o.name).join(", ")}). Utilisez un nom unique.`);
  const product = products[0];
  const organization = organizations[0];

  // Centre : nom exact, sinon une partie du nom si elle désigne un seul centre de l'organisation du produit.
  const centers = await Center.find({ organizationId: product.organizationId }).select("name").lean();
  const wanted = norm(centerName!);
  const exact = centers.filter((c) => norm(c.name) === wanted);
  const partial = centers.filter((c) => norm(c.name).includes(wanted));
  const matches = exact.length === 1 ? exact : partial;
  if (matches.length !== 1) fail(`Centre « ${centerName} » ${matches.length === 0 ? "introuvable" : "ambigu"}. Centres de ${organization?.name ?? "l'organisation"} : ${centers.map((c) => c.name).join(" | ")}`);
  const center = matches[0];

  const key = { organizationId: String(product.organizationId), productId: String(product._id), centerId: String(center._id) };
  console.log(`\nBase : ${connection.name} (${local ? "locale" : `distante : ${connection.host}`})`);
  console.log(`Organisation : ${organization?.name ?? "?"} · Produit : ${product.name} · Centre : ${center.name}`);
  if (!local) console.log("⚠ Base distante : si elle est partagée avec votre équipe, ces mouvements seront visibles de tous les membres de cette organisation.");

  let plan: ReturnType<typeof planHistory> | null = null;
  if (undo) {
    console.log(`\nAction : RETIRER la simulation (mouvements portant la note « ${SIMULATION_NOTE} »). Un produit qui a de vrais mouvements est refusé.`);
  } else {
    plan = planHistory({ perDay: perDay!, days: days!, stock: stock!, flat: flag("flat") });
    const weeks: number[] = [];
    for (let w = 0; w < Math.floor(plan.days.length / 7); w++) weeks.unshift(plan.days.slice(plan.days.length - (w + 1) * 7, plan.days.length - w * 7).reduce((s, d) => s + d.quantity, 0));
    console.log(`\nAction : ÉCRIRE ${plan.days.length + 1} mouvements (1 stock initial antidaté + ${plan.days.length} jours de consommation).`);
    console.log(`Consommation totale simulée : ${plan.total} · Stock final : ${plan.stock} · Totaux hebdomadaires (du plus ancien au plus récent) : ${weeks.join(", ")}`);
    // Mêmes contrôles que l'écriture : un produit non activé ou déjà utilisé est refusé dès le test à blanc.
    await assertSimulationTarget(key);
    console.log("Contrôles : produit activé dans ce centre, journal vide : OK.");
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
    const { removed } = await undoSimulation(key);
    console.log(`\nSimulation retirée : ${removed} mouvements supprimés, niveau remis à zéro.`);
    return;
  }
  const result = await applySimulation(key, plan!);
  console.log(`\nSimulation écrite : ${result.movements} mouvements, stock final ${result.stock}.`);
  console.log(result.issues.length === 0 ? "Contrôle du journal : aucune anomalie." : `⚠ Contrôle du journal : ${result.issues.map((i) => i.message).join(" ; ")}`);
  console.log("Rechargez « Matériel et stock » : la prévision de ce produit est visible.");
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof SimulationError ? "Refusé" : "Erreur"} : ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
