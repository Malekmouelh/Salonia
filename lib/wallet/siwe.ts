import "server-only";
import { getAddress, verifyMessage, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { chainModels } from "@/lib/models/chain";

// « Sign-In With Ethereum » (EIP-4361) : MetaMask signe un message lisible qui contient le site, l'adresse,
// le réseau et un nonce à usage unique. Le serveur vérifie la signature (aucune clé n'est jamais transmise),
// le site (anti-hameçonnage : un message signé pour un autre site est refusé), le réseau, la fraîcheur,
// puis consomme le nonce (anti-rejeu : une même signature ne sert qu'une fois).

// Messages montrés à l'utilisateur. Le code sert aussi d'erreur NextAuth (il apparaît dans l'URL : rien de sensible).
export const WALLET_MESSAGES = {
  invalid: "Message de connexion invalide ou expiré.",
  network: "MetaMask n'est pas sur le bon réseau.",
  signature: "Signature MetaMask invalide.",
  expired: "Cette demande de signature a expiré. Recommencez.",
  unlinked: "Aucun compte Salonia n'est relié à ce wallet. Connectez-vous par e-mail, puis reliez MetaMask depuis votre espace.",
  taken: "Ce wallet est déjà relié à un autre compte Salonia.",
  locked: "Ce wallet a encore des acomptes bloqués : gardez-le jusqu'à leur règlement.",
  missing: "Compte Salonia introuvable.",
  disabled: "La connexion MetaMask n'est pas activée sur ce serveur.",
} as const;
export type WalletErrorCode = keyof typeof WALLET_MESSAGES;

export class WalletError extends Error {
  constructor(public code: WalletErrorCode) {
    super(WALLET_MESSAGES[code]);
  }
}

export const NONCE_TTL_MS = 10 * 60 * 1000;
export type NoncePurpose = "login" | "link";

export async function issueNonce(purpose: NoncePurpose, userId: string | null = null) {
  const { WalletNonce } = await chainModels();
  const nonce = generateSiweNonce();
  await WalletNonce.create({ nonce, purpose, userId, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return nonce;
}

// Vérifie le message signé et renvoie l'adresse (format à somme de contrôle). Lève WalletError sinon.
export async function verifySiwe(p: {
  message: string;
  signature: string;
  purpose: NoncePurpose;
  domain: string;
  chainId: number;
  userId?: string | null;
  now?: Date;
}) {
  const now = p.now ?? new Date();
  const fields = parseSiweMessage(p.message);
  if (!fields.address || !fields.nonce || !fields.issuedAt || !/^0x[0-9a-fA-F]+$/.test(p.signature)) {
    throw new WalletError("invalid");
  }
  if (!validateSiweMessage({ message: fields, domain: p.domain, time: now })) {
    throw new WalletError("invalid");
  }
  if (fields.chainId !== p.chainId) throw new WalletError("network");
  const age = now.getTime() - fields.issuedAt.getTime();
  if (age < -60_000 || age > NONCE_TTL_MS) throw new WalletError("invalid");

  const valid = await verifyMessage({ address: fields.address, message: p.message, signature: p.signature as Hex }).catch(() => false);
  if (!valid) throw new WalletError("signature");

  // Consommation atomique : deux envois simultanés de la même signature, un seul réussit.
  const { WalletNonce } = await chainModels();
  const used = await WalletNonce.findOneAndUpdate(
    {
      nonce: fields.nonce,
      purpose: p.purpose,
      usedAt: null,
      expiresAt: { $gt: now },
      ...(p.purpose === "link" ? { userId: p.userId ?? "" } : {}),
    },
    { $set: { usedAt: now } },
  ).lean();
  if (!used) throw new WalletError("expired");
  return getAddress(fields.address);
}
