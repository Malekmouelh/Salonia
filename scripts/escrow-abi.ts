// Régénère lib/escrow/abi.ts à partir des contrats compilés du dépôt SalonEscrow (cahier §8 : ABI copiée dans Salonia).
// Usage : npx tsx scripts/escrow-abi.ts [chemin du dépôt SalonEscrow, par défaut ../SalonEscrow]
// Prérequis : `npx hardhat compile` dans le dépôt SalonEscrow.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? join(process.cwd(), "..", "SalonEscrow"));
const abiOf = (file: string, name: string) =>
  JSON.parse(readFileSync(join(repo, "artifacts", "contracts", file, `${name}.json`), "utf8")).abi;

const out = `// GÉNÉRÉ par scripts/escrow-abi.ts depuis le dépôt SalonEscrow : ne pas modifier à la main.
// \`as const\` permet à viem de typer les fonctions, événements et erreurs du contrat.

export const bookingEscrowAbi = ${JSON.stringify(abiOf("BookingEscrow.sol", "BookingEscrow"), null, 2)} as const;

export const mockTndAbi = ${JSON.stringify(abiOf("MockTND.sol", "MockTND"), null, 2)} as const;
`;
writeFileSync(join(process.cwd(), "lib", "escrow", "abi.ts"), out);
console.log(`lib/escrow/abi.ts régénéré depuis ${repo}`);
