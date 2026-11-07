// SalonEscrow — explorateur de blocs (cœur commun à la page /dashboard/blockchain et à scripts/escrow-explorer.ts).
// Lit TOUTES les transactions des derniers blocs, quel que soit le compte, et décode les appels et les événements
// du contrat et du jeton. Lecture seule. Pas de « server-only » ici : le script en ligne de commande l'utilise aussi.
import { decodeEventLog, decodeFunctionData, formatEther, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { bookingEscrowAbi, mockTndAbi } from "./abi";

export type ChainEvent =
  | { kind: "created"; bookingId: number; client: string; depositUnits: string; startTime: number }
  | { kind: "cancelled"; bookingId: number; refunded: boolean }
  | { kind: "completed"; bookingId: number }
  | { kind: "noShow"; bookingId: number }
  | { kind: "locked"; bookingId: number; amountUnits: string }
  | { kind: "credited"; bookingId: number; beneficiary: string; amountUnits: string; refunded: boolean }
  | { kind: "withdrawn"; beneficiary: string; amountUnits: string };

export type ChainTx = {
  block: number;
  time: string; // ISO
  hash: string;
  from: string;
  to: string | null;
  ok: boolean;
  // deploy : création de contrat ; call : appel au contrat ou au jeton ; transfer : envoi d'ETH de test.
  kind: "deploy" | "call" | "transfer" | "other";
  target: "BookingEscrow" | "MockTND" | null;
  fn: string | null; // nom de la fonction appelée (createBooking, approve…)
  args: string[]; // arguments déjà mis en forme (nombres, adresses, TND)
  valueEth: string;
  gasUsed: string;
  created: string | null; // adresse du contrat déployé
  events: ChainEvent[];
};

const tndArg = (v: unknown) => `${Number(v as bigint) / 1e6} TND`;

function formatArgs(fn: string, args: readonly unknown[] | undefined): string[] {
  const a = (args ?? []) as unknown[];
  switch (fn) {
    case "createBooking":
      return [`centre ${a[0]}`, `praticien ${a[1]}`, new Date(Number(a[2]) * 1000).toISOString()];
    case "approve":
      return [String(a[0]), tndArg(a[1])];
    case "faucet":
      return [tndArg(a[0])];
    case "setDeposit":
      return [`centre ${a[0]}`, tndArg(a[1])];
    default:
      return a.map((x) => (typeof x === "bigint" ? x.toString() : String(x)));
  }
}

function toEvent(name: string, args: Record<string, unknown>): ChainEvent | null {
  const id = Number(args.bookingId ?? 0);
  switch (name) {
    case "BookingCreated":
      return { kind: "created", bookingId: id, client: String(args.client), depositUnits: String(args.deposit), startTime: Number(args.startTime) };
    case "BookingCancelled":
      return { kind: "cancelled", bookingId: id, refunded: Boolean(args.refunded) };
    case "BookingCompleted":
      return { kind: "completed", bookingId: id };
    case "BookingNoShow":
      return { kind: "noShow", bookingId: id };
    case "DepositLocked":
      return { kind: "locked", bookingId: id, amountUnits: String(args.amount) };
    case "DepositCredited":
      return { kind: "credited", bookingId: id, beneficiary: String(args.beneficiary), amountUnits: String(args.amount), refunded: Boolean(args.refunded) };
    case "Withdrawn":
      return { kind: "withdrawn", beneficiary: String(args.beneficiary), amountUnits: String(args.amount) };
    default:
      return null;
  }
}

// Transactions des `maxBlocks` derniers blocs, de la plus récente à la plus ancienne.
// onlyRelated : réseau public (Sepolia) — on ne garde que les transactions vers le contrat, le jeton ou depuis
// les comptes indiqués, sans lire le reçu des milliers d'autres transactions du bloc.
export async function readChainActivity(
  client: PublicClient,
  p: { contract: Address; token: Address; maxBlocks?: number; onlyRelated?: string[] },
) {
  const related = p.onlyRelated ? new Set(p.onlyRelated.map((a) => a.toLowerCase())) : null;
  const contract = p.contract.toLowerCase();
  const token = p.token.toLowerCase();
  const latest = await client.getBlockNumber();
  const first = latest > BigInt(p.maxBlocks ?? 200) ? latest - BigInt(p.maxBlocks ?? 200) + BigInt(1) : BigInt(1);
  const txs: ChainTx[] = [];

  for (let n = latest; n >= first; n--) {
    const block = await client.getBlock({ blockNumber: n, includeTransactions: true });
    for (const tx of block.transactions) {
      if (related && !related.has(tx.to?.toLowerCase() ?? "") && !related.has(tx.from.toLowerCase())) continue;
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      const to = tx.to?.toLowerCase() ?? null;
      const target = to === contract ? "BookingEscrow" : to === token ? "MockTND" : null;
      let fn: string | null = null;
      let args: string[] = [];
      if (target) {
        try {
          const call = decodeFunctionData({ abi: (target === "BookingEscrow" ? bookingEscrowAbi : mockTndAbi) as Abi, data: tx.input as Hex });
          fn = call.functionName;
          args = formatArgs(call.functionName, call.args);
        } catch {
          fn = null;
        }
      }
      const events: ChainEvent[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== contract) continue;
        try {
          const ev = decodeEventLog({ abi: bookingEscrowAbi, data: log.data, topics: log.topics });
          const parsed = toEvent(ev.eventName, ev.args as Record<string, unknown>);
          if (parsed) events.push(parsed);
        } catch {
          // événement non décodable : ignoré
        }
      }
      txs.push({
        block: Number(n),
        time: new Date(Number(block.timestamp) * 1000).toISOString(),
        hash: tx.hash,
        from: tx.from,
        to: tx.to ?? null,
        ok: receipt.status === "success",
        kind: !tx.to ? "deploy" : target ? "call" : tx.input === "0x" ? "transfer" : "other",
        target,
        fn,
        args,
        valueEth: formatEther(tx.value),
        gasUsed: receipt.gasUsed.toString(),
        created: receipt.contractAddress ?? null,
        events,
      });
    }
    if (n === BigInt(0)) break;
  }
  return { latestBlock: Number(latest), firstBlock: Number(first), txs };
}
