// Lance Salonia en mode blockchain (SalonEscrow) en une commande, sous Windows comme sous macOS/Linux :
// variables ESCROW_* lues dans .env.escrow.local + base MongoDB LOCALE salonia_demo (jamais la base partagée).
// Prérequis : nœud Hardhat lancé (cd ../SalonEscrow && npx hardhat node) et contrat déployé (scripts/escrow-dev.ts).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const file = ".env.escrow.local";
if (!existsSync(file)) {
  console.error(`✖ ${file} introuvable : lancez d'abord scripts/escrow-dev.ts (voir docs/salonescrow.md).`);
  process.exit(1);
}

const env = { ...process.env };
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/.exec(line);
  if (m) env[m[1]] = m[2];
}
env.MONGODB_URI = "mongodb://127.0.0.1:27017";
env.MONGODB_DB = "salonia_demo";

// Le nœud Hardhat répond-il ? Sinon, prévenir (le site démarre quand même, sans soldes).
try {
  const r = await fetch(env.ESCROW_RPC_URL || "http://127.0.0.1:8545", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) throw new Error();
  console.log("✔ Nœud Hardhat joignable");
} catch {
  console.warn("⚠ Nœud Hardhat injoignable : lancez « npx hardhat node » dans ../SalonEscrow (puis scripts/escrow-dev.ts).");
}

console.log("✔ Mode blockchain : base locale salonia_demo + variables de .env.escrow.local");
const child = spawn("npx", ["next", "dev", ...process.argv.slice(2)], { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
