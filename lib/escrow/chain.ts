import "server-only";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseEventLogs,
  type Account,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import type { EscrowStatus } from "@/lib/enums";
import { bookingEscrowAbi, mockTndAbi } from "./abi";
import { adminAccount, requireEscrowConfig, treasuryAccount, userAccount, type EscrowConfig } from "./config";
import { EscrowError, toEscrowError } from "./errors";
import { escrowStatusFromChain, toChainTime } from "./rules";

// SalonEscrow : service blockchain côté serveur (viem). C'est le SEUL endroit qui envoie des transactions.
// Les droits Salonia (session, rôle, centre, propriétaire de la réservation) sont vérifiés AVANT d'arriver ici,
// par lib/escrow/service.ts ; le contrat les revérifie de son côté (défense en profondeur).
// Chaque écriture est d'abord simulée : une transaction vouée à l'échec n'est jamais envoyée (pas de gaz perdu)
// et l'erreur du contrat est traduite en message clair.

// Gaz de test : un wallet qui descend sous le seuil est réalimenté par l'administrateur.
const MIN_GAS = parseEther("0.003");
const GAS_TOP_UP = parseEther("0.01");

let publicClientCache: { key: string; client: PublicClient } | null = null;

function publicClient(config: EscrowConfig): PublicClient {
  const key = `${config.network}|${config.rpcUrl}`;
  if (publicClientCache?.key !== key) {
    publicClientCache = { key, client: createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) }) as PublicClient };
  }
  return publicClientCache.client;
}

const walletClient = (config: EscrowConfig, account: Account) =>
  createWalletClient({ account, chain: config.chain, transport: http(config.rpcUrl) });

// Une transaction à la fois par wallet : évite deux nonces identiques si deux requêtes arrivent ensemble.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(address: Address, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(address) ?? Promise.resolve();
  const run = previous.then(task, task);
  queues.set(address, run.catch(() => {}));
  return run;
}

type Call = { address: Address; abi: typeof bookingEscrowAbi | typeof mockTndAbi; functionName: string; args?: readonly unknown[]; value?: bigint };

// Simule, envoie, puis attend la confirmation. Renvoie le reçu (avec ses événements).
async function send(config: EscrowConfig, account: Account, call: Call) {
  const client = publicClient(config);
  return serialized(account.address, async () => {
    try {
      // Les ABI sont génériques ici (plusieurs contrats) : la simulation reste vérifiée par viem à l'exécution.
      const { request } = await client.simulateContract({ ...(call as Parameters<PublicClient["simulateContract"]>[0]), account });
      const hash = await walletClient(config, account).writeContract(request as Parameters<ReturnType<typeof walletClient>["writeContract"]>[0]);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new EscrowError("La transaction a été refusée par la blockchain.");
      return receipt;
    } catch (error) {
      throw toEscrowError(error);
    }
  });
}

async function read<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw toEscrowError(error);
  }
}

// Les wallets gérés par le serveur n'ont pas d'ETH : l'administrateur leur envoie un peu de gaz de test.
async function ensureGas(config: EscrowConfig, address: Address) {
  const client = publicClient(config);
  const balance = await read(() => client.getBalance({ address }));
  if (balance >= MIN_GAS) return;
  const admin = adminAccount(config);
  await serialized(admin.address, async () => {
    try {
      const hash = await walletClient(config, admin).sendTransaction({ to: address, value: GAS_TOP_UP });
      await client.waitForTransactionReceipt({ hash });
    } catch (error) {
      throw toEscrowError(error);
    }
  });
}

// ─────────────────────────────── Lectures ───────────────────────────────

export type ChainBooking = {
  client: Address;
  centerId: number;
  practitionerId: number;
  startTime: number;
  deposit: bigint;
  status: EscrowStatus;
};

export async function getBooking(chainBookingId: number): Promise<ChainBooking> {
  const config = requireEscrowConfig();
  const b = await read(() =>
    publicClient(config).readContract({ address: config.contract, abi: bookingEscrowAbi, functionName: "getBooking", args: [BigInt(chainBookingId)] }),
  );
  return {
    client: b.client,
    centerId: b.centerId,
    practitionerId: b.practitionerId,
    startTime: Number(b.startTime),
    deposit: b.deposit,
    status: escrowStatusFromChain(b.status),
  };
}

export async function isSlotFree(centerChainId: number, practitionerChainId: number, start: Date) {
  const config = requireEscrowConfig();
  return read(() =>
    publicClient(config).readContract({
      address: config.contract,
      abi: bookingEscrowAbi,
      functionName: "isSlotFree",
      args: [centerChainId, practitionerChainId, BigInt(toChainTime(start))],
    }),
  );
}

// Acompte exigé par un centre, en plus petite unité (0 = centre non configuré).
export async function depositOf(centerChainId: number) {
  const config = requireEscrowConfig();
  return read(() => publicClient(config).readContract({ address: config.contract, abi: bookingEscrowAbi, functionName: "depositOf", args: [centerChainId] }));
}

export async function treasuryOf(centerChainId: number) {
  const config = requireEscrowConfig();
  return read(() => publicClient(config).readContract({ address: config.contract, abi: bookingEscrowAbi, functionName: "treasuryOf", args: [centerChainId] }));
}

export const walletAddress = (walletIndex: number) => userAccount(requireEscrowConfig(), walletIndex).address;

export async function tokenBalanceOf(address: Address) {
  const config = requireEscrowConfig();
  return read(() => publicClient(config).readContract({ address: config.token, abi: mockTndAbi, functionName: "balanceOf", args: [address] }));
}

// Solde retirable dans le contrat (remboursements ou acomptes reçus par un salon), retiré avec withdraw.
export async function escrowBalanceOf(address: Address) {
  const config = requireEscrowConfig();
  return read(() => publicClient(config).readContract({ address: config.contract, abi: bookingEscrowAbi, functionName: "balanceOf", args: [address] }));
}

export async function ethBalanceOf(address: Address) {
  const config = requireEscrowConfig();
  return read(() => publicClient(config).getBalance({ address }));
}

// Gaz de test pour un wallet MetaMask relié (testnet uniquement) : l'administrateur l'alimente si besoin.
export async function fundGas(address: Address) {
  await ensureGas(requireEscrowConfig(), address);
}

// ─────────────── Transactions signées par MetaMask : relues et vérifiées ici ───────────────
// Le serveur ne croit jamais le navigateur sur parole : il relit le reçu sur la chaîne, vérifie que la
// transaction a réussi, qu'elle vise bien CE contrat, et lit l'événement émis par le contrat lui-même.

async function contractReceipt(txHash: Hash) {
  const config = requireEscrowConfig();
  const receipt = await read(() => publicClient(config).getTransactionReceipt({ hash: txHash }));
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== config.contract.toLowerCase()) {
    throw new EscrowError("Transaction introuvable ou refusée par le contrat.");
  }
  return receipt;
}

export async function bookingCreatedInTx(txHash: Hash) {
  const receipt = await contractReceipt(txHash);
  const [event] = parseEventLogs({ abi: bookingEscrowAbi, eventName: "BookingCreated", logs: receipt.logs });
  if (!event) throw new EscrowError("Cette transaction ne crée aucune réservation.");
  const a = event.args;
  return {
    chainBookingId: Number(a.bookingId),
    client: a.client,
    centerId: a.centerId,
    practitionerId: a.practitionerId,
    startTime: Number(a.startTime),
    deposit: a.deposit,
  };
}

export async function bookingCancelledInTx(txHash: Hash) {
  const receipt = await contractReceipt(txHash);
  const [event] = parseEventLogs({ abi: bookingEscrowAbi, eventName: "BookingCancelled", logs: receipt.logs });
  if (!event) throw new EscrowError("Cette transaction n'annule aucune réservation.");
  return { chainBookingId: Number(event.args.bookingId), client: event.args.client, refunded: event.args.refunded };
}

// ─────────────────────────────── Écritures ──────────────────────────────

export type CreatedOnChain = { chainBookingId: number; depositUnits: string; clientAddress: Address; txHash: Hash };

// Réservation par le wallet du client : jetons de test si besoin (faucet), approve du montant exact, puis createBooking.
export async function createBookingOnChain(p: {
  clientWalletIndex: number;
  centerChainId: number;
  practitionerChainId: number;
  start: Date;
}): Promise<CreatedOnChain> {
  const config = requireEscrowConfig();
  const client = userAccount(config, p.clientWalletIndex);
  const deposit = await depositOf(p.centerChainId);
  if (deposit === BigInt(0)) throw new EscrowError("Ce salon n'a pas encore configuré son acompte.");

  await ensureGas(config, client.address);
  const pc = publicClient(config);
  const balance = await read(() => pc.readContract({ address: config.token, abi: mockTndAbi, functionName: "balanceOf", args: [client.address] }));
  if (balance < deposit) {
    // Jeton de TEST : le serveur crée la différence pour le client (pas de vrai paiement).
    await send(config, client, { address: config.token, abi: mockTndAbi, functionName: "faucet", args: [deposit - balance] });
  }
  const allowance = await read(() =>
    pc.readContract({ address: config.token, abi: mockTndAbi, functionName: "allowance", args: [client.address, config.contract] }),
  );
  if (allowance < deposit) {
    await send(config, client, { address: config.token, abi: mockTndAbi, functionName: "approve", args: [config.contract, deposit] });
  }

  const receipt = await send(config, client, {
    address: config.contract,
    abi: bookingEscrowAbi,
    functionName: "createBooking",
    args: [p.centerChainId, p.practitionerChainId, BigInt(toChainTime(p.start))],
  });
  const [created] = parseEventLogs({ abi: bookingEscrowAbi, eventName: "BookingCreated", logs: receipt.logs });
  if (!created) throw new EscrowError("Réservation envoyée, mais confirmation introuvable sur la blockchain.");
  return {
    chainBookingId: Number(created.args.bookingId),
    depositUnits: created.args.deposit.toString(),
    clientAddress: client.address,
    txHash: receipt.transactionHash,
  };
}

export async function cancelBookingOnChain(p: { clientWalletIndex: number; chainBookingId: number }) {
  const config = requireEscrowConfig();
  const client = userAccount(config, p.clientWalletIndex);
  await ensureGas(config, client.address);
  const receipt = await send(config, client, {
    address: config.contract,
    abi: bookingEscrowAbi,
    functionName: "cancelBooking",
    args: [BigInt(p.chainBookingId)],
  });
  const [cancelled] = parseEventLogs({ abi: bookingEscrowAbi, eventName: "BookingCancelled", logs: receipt.logs });
  return { refunded: Boolean(cancelled?.args.refunded), txHash: receipt.transactionHash };
}

// Validation ou absence par le wallet du staff. Salonia a déjà vérifié que ce compte est STAFF de ce centre :
// s'il n'est pas encore nommé sur la chaîne, l'administrateur le nomme (setStaff) avant l'appel.
export async function settleBookingOnChain(p: {
  staffWalletIndex: number;
  centerChainId: number;
  chainBookingId: number;
  outcome: "COMPLETED" | "NO_SHOW";
}) {
  const config = requireEscrowConfig();
  const staff = userAccount(config, p.staffWalletIndex);
  const pc = publicClient(config);
  const isStaff = await read(() =>
    pc.readContract({ address: config.contract, abi: bookingEscrowAbi, functionName: "isStaff", args: [p.centerChainId, staff.address] }),
  );
  if (!isStaff) {
    await send(config, adminAccount(config), {
      address: config.contract,
      abi: bookingEscrowAbi,
      functionName: "setStaff",
      args: [p.centerChainId, staff.address, true],
    });
  }
  await ensureGas(config, staff.address);
  const receipt = await send(config, staff, {
    address: config.contract,
    abi: bookingEscrowAbi,
    functionName: p.outcome === "COMPLETED" ? "markCompleted" : "markNoShow",
    args: [BigInt(p.chainBookingId)],
  });
  return { txHash: receipt.transactionHash };
}

// Configuration d'un centre par l'administrateur : trésorerie dérivée du centre et acompte (plus petite unité).
// Utilisée par le script de démonstration ; l'écran de configuration est un bonus du Membre 2.
export async function configureCenterOnChain(p: { centerChainId: number; depositUnits: bigint }) {
  const config = requireEscrowConfig();
  const admin = adminAccount(config);
  const treasury = treasuryAccount(config, p.centerChainId).address;
  if ((await treasuryOf(p.centerChainId)) !== treasury) {
    await send(config, admin, { address: config.contract, abi: bookingEscrowAbi, functionName: "setTreasury", args: [p.centerChainId, treasury] });
  }
  if ((await depositOf(p.centerChainId)) !== p.depositUnits) {
    await send(config, admin, { address: config.contract, abi: bookingEscrowAbi, functionName: "setDeposit", args: [p.centerChainId, p.depositUnits] });
  }
  return { treasury };
}
