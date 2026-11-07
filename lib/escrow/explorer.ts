import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import type { CurrentUser } from "@/lib/dal";
import { connectDB } from "@/lib/db";
import { Customer } from "@/lib/models/booking";
import { chainModels } from "@/lib/models/chain";
import { Center, User } from "@/lib/models/core";
import { adminAccount, escrowConfig, treasuryAccount, userAccount } from "./config";
import { readChainActivity, type ChainTx } from "./explorer-core";

// SalonEscrow — explorateur de la blockchain pour l'administrateur et le propriétaire (/dashboard/blockchain).
// La chaîne ne contient AUCUN nom : seulement des adresses. Les noms affichés viennent de Salonia, et un
// propriétaire ne voit nommés que les comptes liés à SON salon (clients de son salon, son staff, ses trésoreries) ;
// les autres adresses restent affichées telles quelles.

export type AddressLabel = { name: string; role: "contract" | "token" | "admin" | "client" | "staff" | "treasury" };

export type ExplorerData = {
  network: string;
  contract: string;
  token: string;
  latestBlock: number;
  firstBlock: number;
  txs: ChainTx[];
  labels: Record<string, AddressLabel>;
};

async function addressLabels(user: CurrentUser, contract: string, token: string): Promise<Record<string, AddressLabel>> {
  const config = escrowConfig()!;
  const labels: Record<string, AddressLabel> = {
    [contract.toLowerCase()]: { name: "Contrat BookingEscrow", role: "contract" },
    [token.toLowerCase()]: { name: "Jeton MockTND", role: "token" },
    [adminAccount(config).address.toLowerCase()]: { name: "Administrateur Salonia", role: "admin" },
  };
  await connectDB();
  const orgFilter = user.role === "SUPER_ADMIN" ? {} : { organizationId: user.organization?.id ?? "000000000000000000000000" };

  // Trésoreries des centres (adresse dérivée du numéro de chaîne du centre).
  const centers = await Center.find({ ...orgFilter, chainId: { $ne: null } }).select("name chainId").lean();
  for (const c of centers) labels[treasuryAccount(config, c.chainId!).address.toLowerCase()] = { name: `Trésorerie · ${c.name}`, role: "treasury" };

  // Staff : wallets gérés par le serveur (index de dérivation).
  const staff = await User.find({ ...orgFilter, walletIndex: { $ne: null } }).select("firstName lastName walletIndex role").lean();
  for (const s of staff) {
    labels[userAccount(config, s.walletIndex!).address.toLowerCase()] = { name: `Staff · ${s.firstName} ${s.lastName}`, role: "staff" };
  }

  // Clients : wallets MetaMask reliés (base blockchain séparée). Propriétaire : seulement les clients de son salon.
  const { WalletAccount } = await chainModels();
  const accounts = await WalletAccount.find().select("address userId").lean();
  let allowed: Set<string> | null = null;
  if (user.role !== "SUPER_ADMIN") {
    const customers = await Customer.find({ organizationId: user.organization?.id, userId: { $ne: null } }).select("userId").lean();
    allowed = new Set(customers.map((c) => String(c.userId)));
  }
  const visible = accounts.filter((a) => !allowed || allowed.has(a.userId));
  const users = await User.find({ _id: { $in: visible.map((a) => a.userId) } }).select("firstName lastName").lean();
  for (const a of visible) {
    const u = users.find((x) => String(x._id) === a.userId);
    if (u) labels[a.address.toLowerCase()] = { name: `Client · ${u.firstName} ${u.lastName}`, role: "client" };
  }
  return labels;
}

export async function getBlockchainExplorer(user: CurrentUser): Promise<ExplorerData | { error: string } | null> {
  const config = escrowConfig();
  if (!config) return null;
  try {
    const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) }) as PublicClient;
    const [activity, labels] = await Promise.all([
      readChainActivity(client, {
        contract: config.contract,
        token: config.token,
        maxBlocks: config.network === "hardhat" ? 500 : 50,
        onlyRelated: config.network === "hardhat" ? undefined : [config.contract, config.token, adminAccount(config).address],
      }),
      addressLabels(user, config.contract, config.token),
    ]);
    return { network: config.network, contract: config.contract, token: config.token, ...activity, labels };
  } catch {
    return { error: "Le réseau blockchain ne répond pas. Réessayez dans un instant." };
  }
}
