// MetaMask : « Sign-In With Ethereum » et liaison wallet ↔ compte Salonia (base blockchain séparée).
// Les signatures sont produites par de vrais comptes de test (viem), exactement comme MetaMask les produit.
// Base MongoDB éphémère en mémoire ; aucune blockchain n'est contactée. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { english, generateMnemonic, generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createCenter, createCustomer, createOrg, createUser, insertBooking, resetTestDb, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Booking, Customer } from "@/lib/models/booking";
import { chainDbName, chainModels } from "@/lib/models/chain";
import { User } from "@/lib/models/core";
import { getLinkedWallet, linkWallet, unlinkWallet, walletLogin } from "./service";
import { WALLET_MESSAGES, WalletError, issueNonce, verifySiwe, type WalletErrorCode } from "./siwe";

const DOMAIN = "localhost:3000";
const CHAIN_ID = 31337;

let db: TestDb;
before(async () => {
  Object.assign(process.env, {
    ESCROW_NETWORK: "hardhat",
    ESCROW_RPC_URL: "http://127.0.0.1:9",
    ESCROW_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ESCROW_TOKEN_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    ESCROW_ADMIN_PRIVATE_KEY: generatePrivateKey(),
    ESCROW_HD_MNEMONIC: generateMnemonic(english),
  });
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  await resetTestDb(db);
  await mongoose.connection.useDb(chainDbName()).dropDatabase();
  const { WalletAccount, WalletNonce } = await chainModels();
  await Promise.all([WalletAccount.syncIndexes(), WalletNonce.syncIndexes()]);
});

const rejectsWith = (promise: Promise<unknown>, code: WalletErrorCode) =>
  assert.rejects(promise, (e: unknown) => e instanceof WalletError && e.code === code && e.message === WALLET_MESSAGES[code]);

// Ce que fait MetaMask : signer le message EIP-4361 avec la clé du compte (qui ne quitte jamais le wallet).
async function signed(nonce: string, opts: { key?: `0x${string}`; domain?: string; chainId?: number; issuedAt?: Date } = {}) {
  const account = privateKeyToAccount(opts.key ?? generatePrivateKey());
  const message = createSiweMessage({
    domain: opts.domain ?? DOMAIN,
    address: account.address,
    statement: "Connexion à Salonia avec MetaMask.",
    uri: `http://${DOMAIN}`,
    version: "1",
    chainId: opts.chainId ?? CHAIN_ID,
    nonce,
    issuedAt: opts.issuedAt ?? new Date(),
  });
  return { address: account.address, message, signature: await account.signMessage({ message }) };
}

async function clientUser(email = `c${Math.random()}@test.local`) {
  return User.create({ firstName: "Sarra", lastName: "Test", email, passwordHash: "x", role: "CLIENT" });
}

describe("verifySiwe : signature, site, réseau, fraîcheur, nonce à usage unique", () => {
  it("accepte une signature valide et renvoie l'adresse du signataire", async () => {
    const s = await signed(await issueNonce("login"));
    const address = await verifySiwe({ ...s, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID });
    assert.equal(address, s.address);
  });

  it("anti-rejeu : la même signature ne sert qu'une fois", async () => {
    const s = await signed(await issueNonce("login"));
    await verifySiwe({ ...s, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID });
    await rejectsWith(verifySiwe({ ...s, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "expired");
  });

  it("refuse un nonce inventé, ou émis pour un autre usage", async () => {
    await rejectsWith(verifySiwe({ ...(await signed("abcdefgh12345678")), purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "expired");
    const s = await signed(await issueNonce("link", "someone"));
    await rejectsWith(verifySiwe({ ...s, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "expired");
  });

  it("anti-hameçonnage : refuse un message signé pour un autre site", async () => {
    const s = await signed(await issueNonce("login"), { domain: "faux-salonia.example" });
    await rejectsWith(verifySiwe({ ...s, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "invalid");
  });

  it("refuse un autre réseau, un message trop ancien ou une signature falsifiée", async () => {
    const wrongChain = await signed(await issueNonce("login"), { chainId: 1 });
    await rejectsWith(verifySiwe({ ...wrongChain, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "network");
    const old = await signed(await issueNonce("login"), { issuedAt: new Date(Date.now() - 60 * 60_000) });
    await rejectsWith(verifySiwe({ ...old, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "invalid");
    const nonce = await issueNonce("login");
    const real = await signed(nonce);
    const other = await signed(nonce);
    await rejectsWith(verifySiwe({ message: real.message, signature: other.signature, purpose: "login", domain: DOMAIN, chainId: CHAIN_ID }), "signature");
  });
});

describe("liaison wallet ↔ compte Salonia (base blockchain séparée)", () => {
  it("relie le wallet au compte, stocké dans la base blockchain, sans aucune clé", async () => {
    const user = await clientUser();
    const s = await signed(await issueNonce("link", String(user._id)));
    const address = await linkWallet({ userId: String(user._id), ...s, domain: DOMAIN });
    assert.equal(address, s.address.toLowerCase());
    assert.equal(await getLinkedWallet(String(user._id)), address);
    const { WalletAccount } = await chainModels();
    const stored = await WalletAccount.findOne({ address }).lean();
    assert.equal(stored?.userId, String(user._id));
    assert.deepEqual(Object.keys(stored!).filter((k) => /key|secret|mnemonic|private/i.test(k)), []);
    assert.ok(WalletAccount.db.name.endsWith("_chain"), "les comptes blockchain sont dans une base séparée");
  });

  it("un nonce de liaison émis pour un compte ne sert pas à un autre compte", async () => {
    const victim = await clientUser();
    const attacker = await clientUser();
    const s = await signed(await issueNonce("link", String(victim._id)));
    await rejectsWith(linkWallet({ userId: String(attacker._id), ...s, domain: DOMAIN }), "expired");
  });

  it("un wallet n'appartient qu'à un seul compte", async () => {
    const key = generatePrivateKey();
    const a = await clientUser();
    const b = await clientUser();
    await linkWallet({ userId: String(a._id), ...(await signed(await issueNonce("link", String(a._id)), { key })), domain: DOMAIN });
    await rejectsWith(linkWallet({ userId: String(b._id), ...(await signed(await issueNonce("link", String(b._id)), { key })), domain: DOMAIN }), "taken");
  });

  it("un wallet qui garde des acomptes bloqués ne peut être ni retiré ni remplacé", async () => {
    const user = await clientUser();
    const key = generatePrivateKey();
    const s = await signed(await issueNonce("link", String(user._id)), { key });
    await linkWallet({ userId: String(user._id), ...s, domain: DOMAIN });

    const org = await createOrg();
    const center = await createCenter(org._id);
    const staff = await createUser(org._id, [center._id], "Amira");
    const customer = await createCustomer(org._id);
    await Customer.updateOne({ _id: customer._id }, { $set: { userId: user._id } });
    const booking = await insertBooking({ organizationId: org._id, centerId: center._id, staffId: staff._id, customerId: customer._id, start: new Date(Date.now() + 86_400_000), minutes: 30 });
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { escrow: { network: "hardhat", chainBookingId: 1, centerChainId: 1, practitionerChainId: 1, depositUnits: "30000000", clientAddress: s.address, status: "CONFIRMED", createTxHash: "0x1" } } },
    );

    await rejectsWith(unlinkWallet(String(user._id)), "locked");
    await rejectsWith(linkWallet({ userId: String(user._id), ...(await signed(await issueNonce("link", String(user._id)))), domain: DOMAIN }), "locked");
    assert.equal(await getLinkedWallet(String(user._id)), s.address.toLowerCase());
  });
});

describe("connexion MetaMask (walletLogin, utilisé par NextAuth)", () => {
  it("retrouve le compte Salonia relié à l'adresse qui a signé", async () => {
    const user = await clientUser();
    const key = generatePrivateKey();
    await linkWallet({ userId: String(user._id), ...(await signed(await issueNonce("link", String(user._id)), { key })), domain: DOMAIN });
    const { user: logged } = await walletLogin({ ...(await signed(await issueNonce("login"), { key })), domain: DOMAIN });
    assert.equal(String(logged._id), String(user._id));
  });

  it("refuse un wallet qui n'est relié à aucun compte", async () => {
    await rejectsWith(walletLogin({ ...(await signed(await issueNonce("login"))), domain: DOMAIN }), "unlinked");
  });
});
