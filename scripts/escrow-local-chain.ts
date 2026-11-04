// Déploiement de SalonEscrow sur un nœud Hardhat LOCAL (chainId 31337), pour le développement et la démonstration.
// Utilisé par scripts/escrow-smoke.ts et scripts/escrow-dev.ts. Le déploiement testnet appartient au dépôt SalonEscrow.
// L'administrateur et la phrase HD sont neufs à chaque lancement et financés par un compte déverrouillé du nœud.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, type Abi, type Hex } from "viem";
import { english, generateMnemonic, generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

export const LOCAL_RPC = "http://127.0.0.1:8545";

export async function deployLocalEscrow(repoArg?: string) {
  const repo = resolve(repoArg ?? join(process.cwd(), "..", "SalonEscrow"));
  const artifact = (file: string, name: string) =>
    JSON.parse(readFileSync(join(repo, "artifacts", "contracts", file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: Hex };

  const pc = createPublicClient({ chain: hardhat, transport: http(LOCAL_RPC) });
  if ((await pc.getChainId()) !== hardhat.id) throw new Error("Nœud Hardhat local attendu (chainId 31337).");

  const adminKey = generatePrivateKey();
  const admin = privateKeyToAccount(adminKey);
  const nodeClient = createWalletClient({ chain: hardhat, transport: http(LOCAL_RPC) });
  const [funder] = await nodeClient.getAddresses();
  await pc.waitForTransactionReceipt({
    hash: await nodeClient.sendTransaction({ account: funder, to: admin.address, value: parseEther("100") }),
  });

  const adminClient = createWalletClient({ account: admin, chain: hardhat, transport: http(LOCAL_RPC) });
  const deploy = async (file: string, name: string, args: unknown[]) => {
    const { abi, bytecode } = artifact(file, name);
    const hash = await adminClient.deployContract({ abi, bytecode, args });
    return (await pc.waitForTransactionReceipt({ hash })).contractAddress!;
  };
  const token = await deploy("MockTND.sol", "MockTND", []);
  const contract = await deploy("BookingEscrow.sol", "BookingEscrow", [admin.address, token]);

  return {
    publicClient: pc,
    env: {
      ESCROW_NETWORK: "hardhat",
      ESCROW_RPC_URL: LOCAL_RPC,
      ESCROW_CONTRACT_ADDRESS: contract,
      ESCROW_TOKEN_ADDRESS: token,
      ESCROW_ADMIN_PRIVATE_KEY: adminKey,
      ESCROW_HD_MNEMONIC: generateMnemonic(english),
    },
  };
}
