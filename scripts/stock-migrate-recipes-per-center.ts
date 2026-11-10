// Migration UNIQUE : les recettes de consommation deviennent propres à chaque centre (ServiceRecipe.centerId).
//
// Avant : une recette valait pour tous les centres de l'organisation (clé unique service + produit, sans centre).
// Après : une recette appartient à un centre (clé unique centre + service + produit). Les anciennes lignes, sans centre, ne sont plus lues
// par la consommation : ce script les COPIE dans chaque centre de leur organisation (même quantité au départ, que le propriétaire ajuste
// ensuite centre par centre dans « Recettes »), puis supprime les lignes sans centre et remplace l'ancien index unique.
//
// Lancer (depuis la racine, PowerShell) :
//   npx.cmd tsx scripts/stock-migrate-recipes-per-center.ts --dry-run   (affiche ce qui serait fait, n'écrit rien)
//   npx.cmd tsx scripts/stock-migrate-recipes-per-center.ts             (demande de retaper le nom de la base, puis écrit)
// Il lit la base indiquée par votre .env et AFFICHE son nom avant d'écrire. Rejouable : sans ligne sans centre, il ne fait que resynchroniser les index.
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Center } from "@/lib/models/core";
import { ServiceRecipe } from "@/lib/models/stock";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await connectDB();
  const dbName = mongoose.connection.name;
  console.log(`Base visée : ${dbName}${dryRun ? " (simulation, aucune écriture)" : ""}`);

  const legacy = await ServiceRecipe.collection.find({ centerId: { $exists: false } }).toArray();
  const centers = await Center.find({}).select("organizationId").lean();
  const centersByOrg = new Map<string, string[]>();
  for (const c of centers) centersByOrg.set(String(c.organizationId), [...(centersByOrg.get(String(c.organizationId)) ?? []), String(c._id)]);

  const copies = legacy.flatMap((r) => (centersByOrg.get(String(r.organizationId)) ?? []).map((centerId) => ({ r, centerId })));
  console.log(`Recettes sans centre : ${legacy.length} · copies à créer (une par centre de l'organisation) : ${copies.length}`);
  if (dryRun) return;

  if (legacy.length > 0) {
    const answer = await createInterface({ input: process.stdin, output: process.stdout }).question(`Tapez le nom de la base pour confirmer (${dbName}) : `);
    if (answer.trim() !== dbName) throw new Error("Nom différent : migration annulée, rien n'a été écrit.");
    // L'ancien index unique (service, produit) empêcherait les copies : on le retire d'abord, puis on resynchronise sur le modèle.
    await ServiceRecipe.syncIndexes();
    for (const { r, centerId } of copies) {
      await ServiceRecipe.updateOne(
        { organizationId: r.organizationId, centerId, serviceId: r.serviceId, productId: r.productId },
        { $setOnInsert: { quantityPerService: r.quantityPerService } },
        { upsert: true },
      );
    }
    const removed = await ServiceRecipe.collection.deleteMany({ _id: { $in: legacy.map((r) => r._id) } });
    console.log(`Copies créées pour ${copies.length} ligne(s) ; ${removed.deletedCount} ancienne(s) ligne(s) sans centre supprimée(s).`);
  } else {
    await ServiceRecipe.syncIndexes();
    console.log("Aucune recette sans centre : index resynchronisés.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
