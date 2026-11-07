"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { logEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/dal";
import { connectDB } from "@/lib/db";
import { safeNext } from "@/lib/definitions";
import { formatEther } from "viem";
import { escrowBalanceOf, ethBalanceOf, fundGas, tokenBalanceOf } from "@/lib/escrow/chain";
import { escrowConfig } from "@/lib/escrow/config";
import { EscrowError } from "@/lib/escrow/errors";
import { unitsToTnd } from "@/lib/escrow/rules";
import { User } from "@/lib/models/core";
import { WALLET_MESSAGES, WalletError, issueNonce, type WalletErrorCode } from "@/lib/wallet/siwe";
import { getLinkedWallet, linkWallet, unlinkWallet } from "@/lib/wallet/service";

// Server Actions MetaMask (SalonEscrow) : connexion « Sign-In With Ethereum », liaison et retrait du wallet.
// Le navigateur ne transmet jamais de clé : seulement un message signé, vérifié ici.

type Result = { ok: true; address?: string } | { ok: false; error: string };

async function siteDomain() {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
}

// Informations publiques pour le navigateur (adresses des contrats, réseau). Jamais de clé ni d'URL RPC privée :
// l'URL n'est donnée que pour le nœud local, que MetaMask doit ajouter à la main.
export type EscrowWebConfig = { chainId: number; network: "hardhat" | "sepolia"; rpcUrl: string | null; contract: string; token: string };

export async function getEscrowWebConfig(): Promise<EscrowWebConfig | null> {
  const config = escrowConfig();
  if (!config) return null;
  return {
    chainId: config.chain.id,
    network: config.network,
    rpcUrl: config.network === "hardhat" ? config.rpcUrl : null,
    contract: config.contract,
    token: config.token,
  };
}

export async function getLoginNonce(): Promise<{ nonce?: string; error?: string }> {
  if (!escrowConfig()) return { error: WALLET_MESSAGES.disabled };
  return { nonce: await issueNonce("login") };
}

export async function getLinkNonce(): Promise<{ nonce?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!escrowConfig()) return { error: WALLET_MESSAGES.disabled };
  return { nonce: await issueNonce("link", user.id) };
}

// Connexion : NextAuth (fournisseur « wallet », auth.ts) vérifie la signature et pose le cookie de session.
export async function loginWithWallet(input: { message: string; signature: string; next?: string | null }): Promise<Result> {
  if (typeof input?.message !== "string" || typeof input?.signature !== "string") return { ok: false, error: WALLET_MESSAGES.invalid };
  try {
    await signIn("wallet", { message: input.message, signature: input.signature, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      const code = error.code as WalletErrorCode;
      return { ok: false, error: WALLET_MESSAGES[code] ?? WALLET_MESSAGES.invalid };
    }
    if (error instanceof AuthError) return { ok: false, error: WALLET_MESSAGES.invalid };
    throw error;
  }
  const user = await getCurrentUser();
  await connectDB();
  await User.updateOne({ _id: user.id }, { lastLoginAt: new Date() });
  await logEvent("LOGIN_SUCCESS", { userId: user.id, organizationId: user.organization?.id ?? null, detail: "metamask" });
  redirect(safeNext(input.next ?? null) ?? "/dashboard");
}

export async function linkMyWallet(input: { message: string; signature: string }): Promise<Result> {
  const user = await getCurrentUser();
  if (typeof input?.message !== "string" || typeof input?.signature !== "string") return { ok: false, error: WALLET_MESSAGES.invalid };
  try {
    const address = await linkWallet({ userId: user.id, message: input.message, signature: input.signature, domain: await siteDomain() });
    await logEvent("WALLET_LINKED", { userId: user.id, organizationId: user.organization?.id ?? null, detail: address });
    // Testnet : un peu de gaz pour que le nouveau wallet puisse envoyer ses premières transactions.
    await fundGas(address as `0x${string}`).catch(() => {});
    revalidatePath("/dashboard");
    return { ok: true, address };
  } catch (error) {
    if (error instanceof WalletError) return { ok: false, error: error.message };
    throw error;
  }
}

// Soldes du wallet relié, lus sur la chaîne : ETH (gaz), MockTND (jetons de test) et solde à retirer du contrat.
export type MyWalletInfo = {
  address: string | null;
  balances: { eth: string; mockTnd: string; claimable: string } | null;
};

export async function getMyWalletInfo(): Promise<MyWalletInfo> {
  const user = await getCurrentUser();
  const address = await getLinkedWallet(user.id);
  if (!address || !escrowConfig()) return { address, balances: null };
  try {
    const a = address as `0x${string}`;
    const [eth, token, claimable] = await Promise.all([ethBalanceOf(a), tokenBalanceOf(a), escrowBalanceOf(a)]);
    return { address, balances: { eth: formatEther(eth), mockTnd: unitsToTnd(token), claimable: unitsToTnd(claimable) } };
  } catch {
    return { address, balances: null };
  }
}

// Testnet : de l'ETH de test pour payer le gaz des transactions MetaMask (envoyé par l'administrateur).
export async function requestTestGas(): Promise<Result> {
  const user = await getCurrentUser();
  const address = await getLinkedWallet(user.id);
  if (!address) return { ok: false, error: "Reliez d'abord MetaMask à votre compte." };
  try {
    await fundGas(address as `0x${string}`);
    return { ok: true, address };
  } catch (error) {
    if (error instanceof EscrowError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function unlinkMyWallet(): Promise<Result> {
  const user = await getCurrentUser();
  try {
    const address = await getLinkedWallet(user.id);
    await unlinkWallet(user.id);
    if (address) await logEvent("WALLET_UNLINKED", { userId: user.id, organizationId: user.organization?.id ?? null, detail: address });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof WalletError) return { ok: false, error: error.message };
    throw error;
  }
}
