// MetaMask côté NAVIGATEUR (viem + window.ethereum). Aucune clé ici : MetaMask garde la clé privée et demande
// à l'utilisateur de valider chaque signature ou transaction. Le serveur revérifie ensuite tout sur la chaîne.
import {
  BaseError,
  ContractFunctionRevertedError,
  UnauthorizedProviderError,
  UserRejectedRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";
import { hardhat, sepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import type { EscrowWebConfig } from "@/app/actions/wallet";
import { bookingEscrowAbi, mockTndAbi } from "@/lib/escrow/abi";
import { messageForContractError } from "@/lib/escrow/errors";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export class MetaMaskError extends Error {}

export const hasMetaMask = () => typeof window !== "undefined" && Boolean(window.ethereum);

function provider(): EIP1193Provider {
  if (!hasMetaMask()) throw new MetaMaskError("MetaMask n'est pas installé dans ce navigateur.");
  return window.ethereum!;
}

// Compte actuellement sélectionné dans MetaMask (lecture seule, sans fenêtre de permission), et ses changements.
export function watchActiveAccount(onChange: (address: string | null) => void) {
  if (!hasMetaMask()) return () => {};
  const eth = window.ethereum!;
  const handle = (accounts: unknown) => onChange(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null);
  eth.request({ method: "eth_accounts" }).then(handle).catch(() => onChange(null));
  eth.on?.("accountsChanged", handle as never);
  return () => eth.removeListener?.("accountsChanged", handle as never);
}

function chainFor(cfg: EscrowWebConfig) {
  if (cfg.network === "sepolia") return sepolia;
  return defineChain({ ...hardhat, rpcUrls: { default: { http: [cfg.rpcUrl ?? "http://127.0.0.1:8545"] } } });
}

// Message clair pour une erreur MetaMask ou du contrat.
// Après un redémarrage du nœud Hardhat, MetaMask garde les numéros (nonces) des anciennes transactions.
const NONCE_RESET_MESSAGE =
  "La blockchain de test a redémarré : dans MetaMask, ouvrez Paramètres → Avancé → « Effacer les données de l'onglet activité », puis réessayez.";
const isNonceMismatch = (error: unknown) => /nonce too (high|low)|invalid nonce|nonce has already been used/i.test(String((error as Error)?.message ?? error));

export function metaMaskMessage(error: unknown): string {
  if (error instanceof MetaMaskError) return error.message;
  if (isNonceMismatch(error)) return NONCE_RESET_MESSAGE;
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "Vous avez refusé la demande dans MetaMask.";
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return messageForContractError(reverted.data?.errorName);
  }
  if ((error as { code?: number })?.code === 4001) return "Vous avez refusé la demande dans MetaMask.";
  // Cause exacte dans la console du navigateur (F12), pour le diagnostic ; l'utilisateur voit un message simple.
  console.error("MetaMask :", error);
  return "MetaMask n'a pas pu terminer l'opération. Réessayez.";
}

// MetaMask récent : un site connecté AVANT l'ajout d'un réseau n'est pas autorisé sur ce réseau (erreur 4100).
// On redemande alors la permission au site (l'utilisateur revalide dans MetaMask), puis on réessaie une fois.
const isUnauthorized = (error: unknown) =>
  (error instanceof BaseError && Boolean(error.walk((e) => e instanceof UnauthorizedProviderError))) ||
  (error as { code?: number })?.code === 4100;

async function requestSitePermission() {
  await provider().request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] } as never);
}

async function withPermissionRetry<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    await requestSitePermission();
    return task();
  }
}

// Connexion à MetaMask sur le bon réseau (ajout du nœud local Hardhat si besoin).
export async function connectMetaMask(cfg: EscrowWebConfig) {
  return withPermissionRetry(() => connectOnce(cfg));
}

async function connectOnce(cfg: EscrowWebConfig) {
  const chain = chainFor(cfg);
  const transport = custom(provider());
  const [address] = await createWalletClient({ chain, transport }).requestAddresses();
  if (!address) throw new MetaMaskError("Aucun compte MetaMask sélectionné.");
  const wallet = createWalletClient({ account: address, chain, transport });
  if ((await wallet.getChainId()) !== cfg.chainId) {
    try {
      await wallet.switchChain({ id: cfg.chainId });
    } catch {
      if (cfg.network !== "hardhat") throw new MetaMaskError("Choisissez le réseau Sepolia dans MetaMask.");
      // Réseau inconnu de MetaMask : on l'ajoute. Les versions récentes basculent d'elles-mêmes après l'ajout.
      await wallet.addChain({ chain });
      if ((await wallet.getChainId()) !== cfg.chainId) await wallet.switchChain({ id: cfg.chainId });
    }
  }
  if ((await wallet.getChainId()) !== cfg.chainId) {
    throw new MetaMaskError("Sélectionnez le réseau Hardhat (31337) dans MetaMask, puis réessayez.");
  }
  return { address, wallet, publicClient: createPublicClient({ chain, transport }) };
}

// Signature « Sign-In With Ethereum » avec le nonce donné par le serveur.
// MetaMask affiche d'abord le choix du compte : l'utilisateur décide quel wallet il relie ou utilise pour se connecter.
export async function signInMessage(cfg: EscrowWebConfig, nonce: string, statement: string) {
  await requestSitePermission();
  const { address, wallet } = await connectMetaMask(cfg);
  const message = createSiweMessage({
    domain: window.location.host,
    address,
    statement,
    uri: window.location.origin,
    version: "1",
    chainId: cfg.chainId,
    nonce,
    issuedAt: new Date(),
  });
  const signature = await withPermissionRetry(() => wallet.signMessage({ account: address, message }));
  return { address, message, signature };
}

type Session = Awaited<ReturnType<typeof connectMetaMask>>;

// Simule (aucun gaz perdu si le contrat refuserait), fait signer par MetaMask, attend la confirmation.
async function send(s: Session, call: { address: Address; abi: typeof bookingEscrowAbi | typeof mockTndAbi; functionName: string; args: readonly unknown[] }) {
  const { request } = await s.publicClient.simulateContract({
    ...(call as Parameters<Session["publicClient"]["simulateContract"]>[0]),
    account: s.address,
  });
  const hash = await withPermissionRetry(() => s.wallet.writeContract(request as Parameters<Session["wallet"]["writeContract"]>[0]));
  const receipt = await s.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new MetaMaskError("La transaction a été refusée par la blockchain.");
  return hash;
}

function assertAccount(s: Session, expected: string) {
  if (s.address.toLowerCase() !== expected.toLowerCase()) {
    throw new MetaMaskError(`Sélectionnez dans MetaMask le compte relié à Salonia (${expected.slice(0, 6)}…${expected.slice(-4)}).`);
  }
}

export type BookingSteps = "tokens" | "approve" | "book";

// Réservation : jetons de test si besoin (faucet), approve du montant EXACT, puis createBooking.
export async function bookWithMetaMask(
  cfg: EscrowWebConfig,
  intent: { centerChainId: number; practitionerChainId: number; startTime: number; depositUnits: string; walletAddress: string },
  onStep: (step: BookingSteps) => void,
): Promise<Hash> {
  const s = await connectMetaMask(cfg);
  assertAccount(s, intent.walletAddress);
  const deposit = BigInt(intent.depositUnits);
  const token = cfg.token as Address;
  const contract = cfg.contract as Address;

  const balance = await s.publicClient.readContract({ address: token, abi: mockTndAbi, functionName: "balanceOf", args: [s.address] });
  if (balance < deposit) {
    onStep("tokens");
    await send(s, { address: token, abi: mockTndAbi, functionName: "faucet", args: [deposit - balance] });
  }
  const allowance = await s.publicClient.readContract({ address: token, abi: mockTndAbi, functionName: "allowance", args: [s.address, contract] });
  if (allowance < deposit) {
    onStep("approve");
    await send(s, { address: token, abi: mockTndAbi, functionName: "approve", args: [contract, deposit] });
  }
  onStep("book");
  return send(s, {
    address: contract,
    abi: bookingEscrowAbi,
    functionName: "createBooking",
    args: [intent.centerChainId, intent.practitionerChainId, BigInt(intent.startTime)],
  });
}

export async function cancelWithMetaMask(cfg: EscrowWebConfig, p: { chainBookingId: number; clientAddress: string }): Promise<Hash> {
  const s = await connectMetaMask(cfg);
  assertAccount(s, p.clientAddress);
  return send(s, { address: cfg.contract as Address, abi: bookingEscrowAbi, functionName: "cancelBooking", args: [BigInt(p.chainBookingId)] });
}

// Gestion de la monnaie de test : faucet MockTND (1 000 TND max par appel) et retrait du solde du contrat.
export async function faucetWithMetaMask(cfg: EscrowWebConfig, walletAddress: string, amountTnd: number): Promise<Hash> {
  const s = await connectMetaMask(cfg);
  assertAccount(s, walletAddress);
  return send(s, { address: cfg.token as Address, abi: mockTndAbi, functionName: "faucet", args: [parseUnits(String(amountTnd), 6)] });
}

export async function withdrawWithMetaMask(cfg: EscrowWebConfig, walletAddress: string): Promise<Hash> {
  const s = await connectMetaMask(cfg);
  assertAccount(s, walletAddress);
  return send(s, { address: cfg.contract as Address, abi: bookingEscrowAbi, functionName: "withdraw", args: [] });
}

// Affiche le jeton MockTND dans MetaMask (EIP-747), pour que le client voie son solde.
export async function watchMockTnd(cfg: EscrowWebConfig) {
  await provider().request({
    method: "wallet_watchAsset",
    params: { type: "ERC20", options: { address: cfg.token as Address, symbol: "MockTND", decimals: 6 } },
  } as never);
}
