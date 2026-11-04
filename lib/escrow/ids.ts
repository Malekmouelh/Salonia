import "server-only";
import { connectDB } from "@/lib/db";
import { Center, User } from "@/lib/models/core";
import { EscrowCounter } from "@/lib/models/escrow";
import { EscrowError } from "./errors";
import { isUint32 } from "./rules";

// SalonEscrow (Module 3, Membre 1) : numéros utilisés sur la chaîne à la place des ObjectId Mongo.
//   Center.chainId  → centerId (uint32) du contrat
//   User.chainId    → practitionerId (uint32) du contrat, pour un STAFF
//   User.walletIndex → index de dérivation du wallet géré par le serveur (aucune clé en base)
// Chaque numéro est attribué une seule fois et ne change jamais : une réservation déjà sur la chaîne
// garde ainsi son lien avec Salonia. Les compteurs commencent à 1 (0 n'est jamais un identifiant valide).

export { EscrowError } from "./errors";

type CounterName = "center" | "practitioner" | "wallet";

// Incrément atomique : deux demandes simultanées reçoivent deux numéros différents.
async function nextSeq(name: CounterName) {
  const counter = await EscrowCounter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean();
  if (!counter || !isUint32(counter.seq)) throw new EscrowError("Plus aucun numéro disponible pour la chaîne.");
  return counter.seq;
}

// Lit le numéro, sinon en attribue un. `claim` n'écrit que si le champ est encore vide : si deux demandes
// se croisent, une seule écriture gagne et l'autre relit le numéro gagnant (son numéro est simplement perdu).
async function ensureNumber(
  counter: CounterName,
  notFound: string,
  read: () => Promise<number | null | undefined | false>,
  claim: (seq: number) => Promise<unknown>,
) {
  await connectDB();
  const current = await read();
  if (current === false) throw new EscrowError(notFound);
  if (typeof current === "number") return current;

  await claim(await nextSeq(counter));
  const saved = await read();
  if (typeof saved !== "number") throw new EscrowError(notFound);
  return saved;
}

export function ensureCenterChainId(organizationId: string, centerId: string) {
  const filter = { _id: centerId, organizationId };
  return ensureNumber(
    "center",
    "Centre introuvable.",
    async () => {
      const center = await Center.findOne(filter).select("chainId").lean();
      return center ? (center.chainId ?? null) : false;
    },
    (seq) => Center.updateOne({ ...filter, chainId: null }, { $set: { chainId: seq } }),
  );
}

// Seul un STAFF affecté à ce centre est un praticien réservable.
export function ensurePractitionerChainId(organizationId: string, centerId: string, staffId: string) {
  const filter = { _id: staffId, organizationId, role: "STAFF" as const, centerIds: centerId };
  return ensureNumber(
    "practitioner",
    "Ce praticien ne travaille pas dans ce centre.",
    async () => {
      const user = await User.findOne(filter).select("chainId").lean();
      return user ? (user.chainId ?? null) : false;
    },
    (seq) => User.updateOne({ ...filter, chainId: null }, { $set: { chainId: seq } }),
  );
}

export function ensureWalletIndex(userId: string) {
  return ensureNumber(
    "wallet",
    "Compte introuvable.",
    async () => {
      const user = await User.findById(userId).select("walletIndex").lean();
      return user ? (user.walletIndex ?? null) : false;
    },
    (seq) => User.updateOne({ _id: userId, walletIndex: null }, { $set: { walletIndex: seq } }),
  );
}
