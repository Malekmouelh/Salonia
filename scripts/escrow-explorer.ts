// Mini-explorateur de la blockchain LOCALE (démonstration) : liste toutes les transactions et les événements
// SalonEscrow, en clair (qui, quelle fonction, quel montant, réussite). Lecture seule : n'envoie rien.
// Les adresses du contrat et du jeton viennent de .env.escrow.local (écrit par scripts/escrow-dev.ts).
//
// Usage (dans projetnext, nœud Hardhat lancé) : npx tsx scripts/escrow-explorer.ts
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, decodeFunctionData, formatEther, http, type Abi, type Hex } from "viem";
import { hardhat } from "viem/chains";
import { bookingEscrowAbi, mockTndAbi } from "../lib/escrow/abi";

const env: Record<string, string> = {};
if (existsSync(".env.escrow.local")) {
  for (const line of readFileSync(".env.escrow.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
  }
}
const RPC = env.ESCROW_RPC_URL || "http://127.0.0.1:8545";
const CONTRACT = (env.ESCROW_CONTRACT_ADDRESS || "").toLowerCase();
const TOKEN = (env.ESCROW_TOKEN_ADDRESS || "").toLowerCase();

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const tnd = (units: bigint) => `${Number(units) / 1e6} TND`;
const STATUS = ["None", "Confirmed", "Cancelled", "Completed", "NoShow"];

function describeArgs(name: string, args: readonly unknown[] | undefined) {
  const a = (args ?? []) as unknown[];
  switch (name) {
    case "createBooking":
      return `centre ${a[0]}, praticien ${a[1]}, début ${new Date(Number(a[2]) * 1000).toLocaleString("fr-FR", { timeZone: "Africa/Tunis" })} (Tunis)`;
    case "cancelBooking":
    case "markCompleted":
    case "markNoShow":
      return `réservation n°${a[0]}`;
    case "approve":
      return `autorise ${short(String(a[0]))} à prendre ${tnd(a[1] as bigint)}`;
    case "faucet":
      return `${tnd(a[0] as bigint)} de jetons de test`;
    case "setDeposit":
      return `centre ${a[0]} : acompte ${tnd(a[1] as bigint)}`;
    case "setTreasury":
    case "setStaff":
    case "setCenterManager":
      return `centre ${a[0]} → ${short(String(a[1]))}${a[2] !== undefined ? ` (${a[2]})` : ""}`;
    default:
      return a.map(String).join(", ");
  }
}

function describeEvent(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "BookingCreated":
      return `réservation n°${args.bookingId} créée par ${short(String(args.client))}, acompte ${tnd(args.deposit as bigint)}`;
    case "BookingCancelled":
      return `réservation n°${args.bookingId} annulée → ${args.refunded ? "REMBOURSÉE au client" : "acompte VERSÉ AU SALON"}`;
    case "BookingCompleted":
      return `réservation n°${args.bookingId} : prestation réalisée`;
    case "BookingNoShow":
      return `réservation n°${args.bookingId} : client absent`;
    case "DepositLocked":
      return `${tnd(args.amount as bigint)} bloqués pour la réservation n°${args.bookingId}`;
    case "DepositCredited":
      return `${tnd(args.amount as bigint)} crédités à ${short(String(args.beneficiary))}${args.refunded ? " (remboursement)" : " (salon)"}`;
    case "Withdrawn":
      return `${short(String(args.beneficiary))} retire ${tnd(args.amount as bigint)}`;
    default:
      return "";
  }
}

async function main() {
  const pc = createPublicClient({ chain: hardhat, transport: http(RPC) });
  const latest = await pc.getBlockNumber();
  console.log(`Blockchain locale ${RPC} — ${latest} blocs. Contrat ${short(CONTRACT)}, jeton MockTND ${short(TOKEN)}\n`);

  let count = 0;
  for (let n = BigInt(1); n <= latest; n++) {
    const block = await pc.getBlock({ blockNumber: n, includeTransactions: true });
    // Heure de Tunis (UTC+1), comme dans Salonia.
    const when = new Date(Number(block.timestamp) * 1000).toLocaleString("fr-FR", { timeZone: "Africa/Tunis" });
    for (const tx of block.transactions) {
      count++;
      const receipt = await pc.getTransactionReceipt({ hash: tx.hash });
      const ok = receipt.status === "success" ? "✓" : "✗ ÉCHEC";
      const to = tx.to?.toLowerCase();
      let what: string;
      if (!tx.to) what = `déploiement de contrat → ${short(receipt.contractAddress)}`;
      else if (to === CONTRACT || to === TOKEN) {
        const abi = (to === CONTRACT ? bookingEscrowAbi : mockTndAbi) as Abi;
        try {
          const call = decodeFunctionData({ abi, data: tx.input as Hex });
          what = `${to === CONTRACT ? "BookingEscrow" : "MockTND"}.${call.functionName}(${describeArgs(call.functionName, call.args)})`;
        } catch {
          what = `appel à ${short(tx.to)}`;
        }
      } else what = `envoi de ${formatEther(tx.value)} ETH de test à ${short(tx.to)}`;

      console.log(`#${n}  ${when}  ${ok}  de ${short(tx.from)}  ${what}`);
      console.log(`     tx ${tx.hash}`);
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== CONTRACT) continue;
        try {
          const ev = decodeEventLog({ abi: bookingEscrowAbi, data: log.data, topics: log.topics });
          const text = describeEvent(ev.eventName, ev.args as Record<string, unknown>);
          if (text) console.log(`     ↳ ${ev.eventName} : ${text}`);
        } catch {
          // événement d'un autre contrat
        }
      }
    }
  }

  if (CONTRACT) {
    const total = await pc.readContract({ address: CONTRACT as Hex, abi: bookingEscrowAbi, functionName: "bookingCount" });
    console.log(`\n${count} transaction(s). Réservations enregistrées dans le contrat : ${total}`);
    for (let id = BigInt(1); id <= total; id++) {
      const b = await pc.readContract({ address: CONTRACT as Hex, abi: bookingEscrowAbi, functionName: "getBooking", args: [id] });
      console.log(`  n°${id} : ${STATUS[b.status]} — client ${short(b.client)}, centre ${b.centerId}, praticien ${b.practitionerId}, acompte ${tnd(b.deposit)}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
