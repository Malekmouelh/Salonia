import "server-only";
import { connectDB } from "@/lib/db";
import { escrowConfig } from "@/lib/escrow/config";
import { Booking, Customer } from "@/lib/models/booking";
import { chainModels } from "@/lib/models/chain";
import { User } from "@/lib/models/core";
import { WalletError, verifySiwe } from "./siwe";

// Comptes MetaMask (base blockchain séparée) ↔ comptes Salonia (base principale), reliés par userId.
// Un compte Salonia a au plus un wallet, et un wallet n'appartient qu'à un compte.

export { WalletError } from "./siwe";

export async function getLinkedWallet(userId: string): Promise<string | null> {
  const { WalletAccount } = await chainModels();
  const account = await WalletAccount.findOne({ userId }).select("address").lean();
  return account?.address ?? null;
}

// Un wallet qui garde des acomptes bloqués ne peut pas être remplacé : seul lui peut les annuler sur la chaîne.
async function assertNoActiveEscrow(userId: string, address: string) {
  await connectDB();
  const customers = await Customer.find({ userId }).select("_id").lean();
  if (customers.length === 0) return;
  const active = await Booking.find({ customerId: { $in: customers.map((c) => c._id) }, "escrow.status": "CONFIRMED" })
    .select("escrow.clientAddress")
    .lean();
  if (active.some((b) => b.escrow?.clientAddress?.toLowerCase() === address.toLowerCase())) {
    throw new WalletError("locked");
  }
}

// Liaison depuis l'espace connecté : MetaMask signe un message avec un nonce émis pour CE compte.
export async function linkWallet(p: { userId: string; message: string; signature: string; domain: string }) {
  const config = escrowConfig();
  if (!config) throw new WalletError("disabled");
  const address = (
    await verifySiwe({ message: p.message, signature: p.signature, purpose: "link", domain: p.domain, chainId: config.chain.id, userId: p.userId })
  ).toLowerCase();
  const { WalletAccount } = await chainModels();
  const owner = await WalletAccount.findOne({ address }).select("userId").lean();
  if (owner && owner.userId !== p.userId) throw new WalletError("taken");
  const current = await WalletAccount.findOne({ userId: p.userId }).select("address").lean();
  if (current && current.address !== address) await assertNoActiveEscrow(p.userId, current.address);
  try {
    await WalletAccount.findOneAndUpdate({ userId: p.userId }, { $set: { address, linkedAt: new Date() } }, { upsert: true });
  } catch (error) {
    // Course entre deux comptes sur la même adresse : l'index unique tranche.
    if ((error as { code?: number }).code === 11000) throw new WalletError("taken");
    throw error;
  }
  return address;
}

export async function unlinkWallet(userId: string) {
  const { WalletAccount } = await chainModels();
  const current = await WalletAccount.findOne({ userId }).select("address").lean();
  if (!current) return;
  await assertNoActiveEscrow(userId, current.address);
  await WalletAccount.deleteOne({ userId });
}

// Connexion par MetaMask : la signature prouve la possession du wallet, la base dit à quel compte il appartient.
export async function walletLogin(p: { message: string; signature: string; domain: string }) {
  const config = escrowConfig();
  if (!config) throw new WalletError("disabled");
  const address = (
    await verifySiwe({ message: p.message, signature: p.signature, purpose: "login", domain: p.domain, chainId: config.chain.id })
  ).toLowerCase();
  const { WalletAccount } = await chainModels();
  const account = await WalletAccount.findOneAndUpdate({ address }, { $set: { lastLoginAt: new Date() } }).lean();
  if (!account) {
    throw new WalletError("unlinked");
  }
  await connectDB();
  const user = await User.findById(account.userId).lean();
  if (!user) throw new WalletError("missing");
  return { user, address };
}
