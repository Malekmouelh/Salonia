// Essai de bout en bout du service blockchain de Salonia (lib/escrow/chain.ts) sur un nœud Hardhat LOCAL.
// Déploie des contrats neufs (MockTND + BookingEscrow, depuis les artifacts du dépôt SalonEscrow), puis rejoue :
// réservation, double réservation, annulation par un autre client, annulation remboursée, validation, absence.
// Aucune base Salonia n'est touchée ; clés et phrase HD générées à chaque lancement (jamais écrites sur disque).
//
// 1. Dans le dépôt SalonEscrow : npx hardhat compile && npx hardhat node
// 2. Dans Salonia : npx tsx --conditions=react-server scripts/escrow-smoke.ts [chemin du dépôt SalonEscrow]
import { deployLocalEscrow } from "./escrow-local-chain";

let pc: Awaited<ReturnType<typeof deployLocalEscrow>>["publicClient"];
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "ÉCHEC"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function expectError(label: string, task: Promise<unknown>, message: string) {
  try {
    await task;
    check(label, false, "aucune erreur");
  } catch (e) {
    check(label, e instanceof Error && e.message === message, e instanceof Error ? e.message : String(e));
  }
}
async function travelTo(timestamp: number) {
  await pc.request({ method: "evm_setNextBlockTimestamp" as never, params: [timestamp] as never });
  await pc.request({ method: "evm_mine" as never, params: [] as never });
}

async function main() {
  const { publicClient, env } = await deployLocalEscrow(process.argv[2]);
  pc = publicClient;
  console.log(`Contrats déployés : MockTND ${env.ESCROW_TOKEN_ADDRESS}, BookingEscrow ${env.ESCROW_CONTRACT_ADDRESS}`);
  Object.assign(process.env, env);
  const chain = await import("../lib/escrow/chain");

  const CENTER = 1;
  const PRACTITIONER = 1;
  const ALICE = 1;
  const BOB = 2;
  const STAFF = 3;
  const DEPOSIT = BigInt(30_000_000);

  await chain.configureCenterOnChain({ centerChainId: CENTER, depositUnits: DEPOSIT });
  check("centre configuré : acompte de 30 TND", (await chain.depositOf(CENTER)) === DEPOSIT);

  const now = Number((await pc.getBlock()).timestamp);
  const start = Math.ceil((now + 48 * 3600) / 1800) * 1800;
  const startDate = new Date(start * 1000);

  const created = await chain.createBookingOnChain({ clientWalletIndex: ALICE, centerChainId: CENTER, practitionerChainId: PRACTITIONER, start: startDate });
  check("alice réserve (faucet + approve + createBooking)", created.chainBookingId === 1 && created.depositUnits === DEPOSIT.toString(), created.txHash);
  const booking = await chain.getBooking(created.chainBookingId);
  check("getBooking : Confirmed, acompte figé", booking.status === "CONFIRMED" && booking.deposit === DEPOSIT && booking.client === created.clientAddress);
  check("isSlotFree : créneau pris", !(await chain.isSlotFree(CENTER, PRACTITIONER, startDate)));

  await expectError(
    "scénario 1 : bob réserve le même créneau",
    chain.createBookingOnChain({ clientWalletIndex: BOB, centerChainId: CENTER, practitionerChainId: PRACTITIONER, start: startDate }),
    "Ce créneau est déjà réservé.",
  );
  await expectError(
    "scénario 6 : bob annule la réservation d'alice",
    chain.cancelBookingOnChain({ clientWalletIndex: BOB, chainBookingId: 1 }),
    "Seul le client qui a réservé peut annuler.",
  );

  const cancelled = await chain.cancelBookingOnChain({ clientWalletIndex: ALICE, chainBookingId: 1 });
  check("alice annule 48 h avant : remboursée", cancelled.refunded);
  check("créneau libéré", await chain.isSlotFree(CENTER, PRACTITIONER, startDate));

  const second = await chain.createBookingOnChain({ clientWalletIndex: BOB, centerChainId: CENTER, practitionerChainId: PRACTITIONER, start: startDate });
  const third = await chain.createBookingOnChain({
    clientWalletIndex: ALICE,
    centerChainId: CENTER,
    practitionerChainId: PRACTITIONER + 1,
    start: startDate,
  });
  await expectError(
    "staff valide avant l'heure",
    chain.settleBookingOnChain({ staffWalletIndex: STAFF, centerChainId: CENTER, chainBookingId: second.chainBookingId, outcome: "COMPLETED" }),
    "Trop tôt : validation possible dès l'heure du rendez-vous, absence 15 minutes après.",
  );

  await travelTo(start + 15 * 60);
  await chain.settleBookingOnChain({ staffWalletIndex: STAFF, centerChainId: CENTER, chainBookingId: second.chainBookingId, outcome: "COMPLETED" });
  check("staff valide la prestation", (await chain.getBooking(second.chainBookingId)).status === "COMPLETED");
  await chain.settleBookingOnChain({ staffWalletIndex: STAFF, centerChainId: CENTER, chainBookingId: third.chainBookingId, outcome: "NO_SHOW" });
  check("staff marque l'absence 15 min après", (await chain.getBooking(third.chainBookingId)).status === "NO_SHOW");
  await expectError(
    "double règlement refusé",
    chain.settleBookingOnChain({ staffWalletIndex: STAFF, centerChainId: CENTER, chainBookingId: third.chainBookingId, outcome: "COMPLETED" }),
    "Cette réservation est déjà réglée.",
  );
  await expectError(
    "le client ne peut plus annuler une réservation validée",
    chain.cancelBookingOnChain({ clientWalletIndex: BOB, chainBookingId: second.chainBookingId }),
    "Cette réservation est déjà réglée.",
  );

  console.log(failures === 0 ? "\nTout est OK." : `\n${failures} échec(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
