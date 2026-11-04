import "server-only";
import { isAddress, type Address, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia } from "viem/chains";
import { EscrowError } from "./errors";

// SalonEscrow : configuration lue dans les variables d'environnement du SERVEUR (jamais NEXT_PUBLIC_).
// Le navigateur ne signe rien : toutes les clés restent ici. Testnet uniquement.

const CHAINS = { hardhat, sepolia } as const;
export type EscrowNetwork = keyof typeof CHAINS;

// Comptes dérivés de la phrase HD : m/44'/60'/{compte}'/0/{index}.
// Compte 0 : un wallet par utilisateur Salonia (User.walletIndex). Compte 1 : une trésorerie par centre (Center.chainId).
const USER_ACCOUNT = 0;
const TREASURY_ACCOUNT = 1;

export type EscrowConfig = {
  network: EscrowNetwork;
  chain: (typeof CHAINS)[EscrowNetwork];
  rpcUrl: string;
  contract: Address;
  token: Address;
  adminKey: Hex;
  mnemonic: string;
};

// Lecture pure (testable) : null si la fonctionnalité n'est pas configurée, erreur si elle l'est à moitié.
export function parseEscrowEnv(env: Record<string, string | undefined>): EscrowConfig | null {
  const keys = [
    "ESCROW_NETWORK",
    "ESCROW_RPC_URL",
    "ESCROW_CONTRACT_ADDRESS",
    "ESCROW_TOKEN_ADDRESS",
    "ESCROW_ADMIN_PRIVATE_KEY",
    "ESCROW_HD_MNEMONIC",
  ] as const;
  const values = keys.map((k) => env[k]?.trim() ?? "");
  if (values.every((v) => v === "")) return null;

  const missing = keys.filter((_, i) => values[i] === "");
  if (missing.length) throw new EscrowError(`SalonEscrow est configuré à moitié : ${missing.join(", ")} manquant(s).`);

  const [network, rpcUrl, contract, token, adminKey, mnemonic] = values;
  if (network !== "hardhat" && network !== "sepolia") throw new EscrowError("ESCROW_NETWORK doit valoir « hardhat » ou « sepolia ».");
  if (!isAddress(contract) || !isAddress(token)) throw new EscrowError("Adresse du contrat ou du jeton invalide.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(adminKey)) throw new EscrowError("ESCROW_ADMIN_PRIVATE_KEY invalide (0x suivi de 64 caractères hexadécimaux).");
  if (mnemonic.split(/\s+/).length < 12) throw new EscrowError("ESCROW_HD_MNEMONIC doit compter au moins 12 mots.");

  return { network, chain: CHAINS[network], rpcUrl, contract, token, adminKey: adminKey as Hex, mnemonic };
}

let cached: EscrowConfig | null | undefined;

export function escrowConfig(): EscrowConfig | null {
  if (cached === undefined) cached = parseEscrowEnv(process.env);
  return cached;
}

export const isEscrowEnabled = () => escrowConfig() !== null;

export function requireEscrowConfig(): EscrowConfig {
  const config = escrowConfig();
  if (!config) throw new EscrowError("L'acompte sécurisé n'est pas activé sur ce serveur.");
  return config;
}

export const adminAccount = (config: EscrowConfig) => privateKeyToAccount(config.adminKey);

export const userAccount = (config: EscrowConfig, walletIndex: number) =>
  mnemonicToAccount(config.mnemonic, { accountIndex: USER_ACCOUNT, addressIndex: walletIndex });

export const treasuryAccount = (config: EscrowConfig, centerChainId: number) =>
  mnemonicToAccount(config.mnemonic, { accountIndex: TREASURY_ACCOUNT, addressIndex: centerChainId });
