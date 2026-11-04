// Configuration SalonEscrow et traduction des erreurs du contrat. Aucune blockchain n'est contactée. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BaseError, ContractFunctionRevertedError, HttpRequestError, encodeErrorResult } from "viem";
import { english, generateMnemonic, generatePrivateKey } from "viem/accounts";
import { bookingEscrowAbi } from "./abi";
import { parseEscrowEnv, treasuryAccount, userAccount } from "./config";
import { EscrowError, NETWORK_ERROR, UNKNOWN_CHAIN_ERROR, messageForContractError, toEscrowError } from "./errors";

const FULL = {
  ESCROW_NETWORK: "hardhat",
  ESCROW_RPC_URL: "http://127.0.0.1:8545",
  ESCROW_CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  ESCROW_TOKEN_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  ESCROW_ADMIN_PRIVATE_KEY: generatePrivateKey(),
  ESCROW_HD_MNEMONIC: generateMnemonic(english),
};

const rejects = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (e: unknown) => e instanceof EscrowError && pattern.test(e.message));

describe("parseEscrowEnv", () => {
  it("aucune variable : fonctionnalité désactivée (null)", () => {
    assert.equal(parseEscrowEnv({}), null);
    assert.equal(parseEscrowEnv({ ESCROW_NETWORK: " " }), null);
  });

  it("configuration complète : réseau, adresses et clés reconnus", () => {
    const config = parseEscrowEnv(FULL);
    assert.equal(config?.network, "hardhat");
    assert.equal(config?.chain.id, 31337);
    assert.equal(parseEscrowEnv({ ...FULL, ESCROW_NETWORK: "sepolia" })?.chain.id, 11155111);
  });

  it("configuration à moitié : erreur qui nomme les variables manquantes", () => {
    rejects(() => parseEscrowEnv({ ...FULL, ESCROW_HD_MNEMONIC: "", ESCROW_TOKEN_ADDRESS: "" }), /ESCROW_TOKEN_ADDRESS, ESCROW_HD_MNEMONIC/);
  });

  it("refuse un réseau inconnu (jamais le réseau principal), une adresse, une clé ou une phrase invalides", () => {
    rejects(() => parseEscrowEnv({ ...FULL, ESCROW_NETWORK: "mainnet" }), /hardhat/);
    rejects(() => parseEscrowEnv({ ...FULL, ESCROW_CONTRACT_ADDRESS: "0x123" }), /Adresse/);
    rejects(() => parseEscrowEnv({ ...FULL, ESCROW_ADMIN_PRIVATE_KEY: "abc" }), /PRIVATE_KEY/);
    rejects(() => parseEscrowEnv({ ...FULL, ESCROW_HD_MNEMONIC: "un deux trois" }), /12 mots/);
  });
});

describe("wallets dérivés", () => {
  it("un wallet stable par index, distinct entre utilisateurs et trésoreries", () => {
    const config = parseEscrowEnv(FULL)!;
    assert.equal(userAccount(config, 1).address, userAccount(config, 1).address);
    assert.notEqual(userAccount(config, 1).address, userAccount(config, 2).address);
    assert.notEqual(userAccount(config, 1).address, treasuryAccount(config, 1).address);
  });
});

describe("traduction des erreurs du contrat", () => {
  it("chaque erreur personnalisée connue a un message clair", () => {
    assert.equal(messageForContractError("SlotAlreadyBooked"), "Ce créneau est déjà réservé.");
    assert.equal(messageForContractError("NotCenterStaff"), "Seul le staff de ce centre peut faire cette action.");
    assert.equal(messageForContractError("Inconnue"), UNKNOWN_CHAIN_ERROR);
    assert.equal(messageForContractError(undefined), UNKNOWN_CHAIN_ERROR);
  });

  it("toutes les erreurs de SlotBooking déclarées dans l'ABI sont traduites", () => {
    const names = ["InvalidStartTime", "SlotAlreadyBooked", "BookingNotFound", "NotBookingClient", "InvalidStatus", "BookingAlreadyStarted", "TooEarly"];
    const inAbi = new Set<string>(bookingEscrowAbi.filter((x) => x.type === "error").map((x) => x.name));
    for (const name of names) {
      assert.ok(inAbi.has(name), `${name} absente de l'ABI`);
      assert.notEqual(messageForContractError(name), UNKNOWN_CHAIN_ERROR, name);
    }
  });

  it("toEscrowError lit le nom de l'erreur dans un revert viem", () => {
    const data = encodeErrorResult({ abi: bookingEscrowAbi, errorName: "SlotAlreadyBooked", args: [BigInt(1)] });
    const reverted = new ContractFunctionRevertedError({ abi: bookingEscrowAbi, data, functionName: "createBooking" });
    const wrapped = new BaseError("échec", { cause: reverted });
    assert.equal(toEscrowError(wrapped).message, "Ce créneau est déjà réservé.");
  });

  it("panne réseau : message dédié ; erreur inconnue : message générique sans détail technique", () => {
    const network = new BaseError("échec", { cause: new HttpRequestError({ url: "http://127.0.0.1:8545" }) });
    assert.equal(toEscrowError(network).message, NETWORK_ERROR);
    assert.equal(toEscrowError(new Error("secret 0xabc")).message, UNKNOWN_CHAIN_ERROR);
    const own = new EscrowError("Message métier");
    assert.equal(toEscrowError(own), own);
  });
});
