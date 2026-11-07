// Prépare une démonstration LOCALE de l'acompte sécurisé : déploie SalonEscrow sur le nœud Hardhat local,
// donne un numéro de chaîne aux centres d'un salon et fixe leur acompte sur le contrat.
// Les variables ESCROW_* sont écrites dans .env.escrow.local (ignoré par Git, clés jetables de la chaîne locale) :
// les passer au serveur de développement, par exemple via .claude/launch.json.
//
// Refuse toute base qui n'est pas sur la machine locale : MONGODB_URI doit être fourni explicitement
// (ce script ne lit jamais .env, pour ne pas toucher la base partagée de l'équipe).
//
// 1. Dans le dépôt SalonEscrow : npx hardhat node
// 2. MONGODB_URI=mongodb://127.0.0.1:<port> MONGODB_DB=<base> npx tsx --conditions=react-server scripts/escrow-dev.ts <slug> [acompte TND]
import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import { parseUnits } from "viem";
import { deployLocalEscrow } from "./escrow-local-chain";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

async function main() {
  const [slug, depositArg = "30"] = process.argv.slice(2);
  if (!slug) throw new Error("Usage : scripts/escrow-dev.ts <slug du salon> [acompte en TND]");
  const uri = process.env.MONGODB_URI ?? "";
  if (!uri || !LOCAL_HOSTS.has(new URL(uri).hostname)) throw new Error("MONGODB_URI doit pointer vers une base LOCALE (127.0.0.1).");

  const { env } = await deployLocalEscrow();
  Object.assign(process.env, env);
  console.log(`Contrats déployés : BookingEscrow ${env.ESCROW_CONTRACT_ADDRESS}, MockTND ${env.ESCROW_TOKEN_ADDRESS}`);

  const { connectDB } = await import("../lib/db");
  const { Center, Organization } = await import("../lib/models/core");
  const { ensureCenterChainId } = await import("../lib/escrow/ids");
  const { configureCenterOnChain } = await import("../lib/escrow/chain");

  await connectDB();
  const org = await Organization.findOne({ slug }).select("_id name").lean();
  if (!org) throw new Error(`Salon introuvable : ${slug}`);
  const depositUnits = parseUnits(depositArg, 6);
  const centers = await Center.find({ organizationId: org._id }).select("name").lean();
  for (const center of centers) {
    const chainId = await ensureCenterChainId(String(org._id), String(center._id));
    await configureCenterOnChain({ centerChainId: chainId, depositUnits });
    console.log(`  ${center.name} → centre n°${chainId}, acompte ${depositArg} TND`);
  }

  // Nouvelle chaîne : les acomptes de l'ancienne (transactions disparues) sont détachés de leurs rendez-vous.
  const { detachStaleLocalEscrows } = await import("../lib/escrow/service");
  const detached = await detachStaleLocalEscrows();
  if (detached) console.log(`  ${detached} acompte(s) de l'ancienne chaîne détaché(s) de leur rendez-vous`);

  writeFileSync(".env.escrow.local", Object.entries(env).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
  console.log(`${org.name} : ${centers.length} centre(s) configuré(s). Variables écrites dans .env.escrow.local`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
