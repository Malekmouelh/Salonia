import { connectDB } from "@/lib/db";
import type { StockReceiptStatus, StockTransferKind, StockTransferStatus, StockUnit } from "@/lib/enums";
import { Equipment, StockLevel, StockMovement, StockProduct, StockTransfer } from "@/lib/models/stock";
import { MSG_EQUIPMENT_ARCHIVED, MSG_EQUIPMENT_NOT_FOUND } from "./equipment";
import { isDuplicateKey } from "./errors";
import { commitTransferIn, commitTransferOut, projectLevel, readTail, type LedgerKey, type TransferMovement } from "./ledger";
import { TransferAnswerSchema, TransferEquipmentSchema, TransferHistorySchema, TransferIdSchema, TransferProductSchema, TransferReceiptSchema, TransferRequestSchema, TransferReverseSchema } from "./schemas";
import { requireRequestCenters, requireTransferCenters, resolveStockCenter, resolveTransferDestination, stockScope } from "./scope";
import { MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, guard, invalid, rawField, type StockActor, type StockFailure, type StockResult } from "./service";

// Module 5 (F5.6) — Transferts de produits et de matériel entre centres. OWNER (source : tous les centres) et MANAGER (source : ses
// centres seulement ; destination : n'importe quel centre de l'organisation). Droits et périmètre : lib/stock/scope.ts (requireTransferCenters).
//
// PRODUIT — même mécanisme que la réception d'une commande (D6, sans transaction), chaque étape idempotente et rejouable :
//   1. le transfert est enregistré (StockTransfer, PENDING, requestId unique) ;
//   2. TRANSFER_OUT au centre source, PLAFONNÉ au solde disponible (jamais de stock négatif) ; rien n'est créé si le solde est nul ;
//   3. TRANSFER_IN au centre destination, de la quantité réellement sortie ;
//   4. le transfert passe à COMPLETED (quantité transférée enregistrée).
// Un seul TRANSFER_OUT et un seul TRANSFER_IN par transfert (index unique) : rappeler le service après une interruption, ou envoyer deux
// fois la même demande (même requestId), termine le transfert sans double sortie ni double entrée. Les niveaux sont des projections du
// journal (projectLevel, affectation gardée par le rang) : une projection en échec ne perd rien et se répare à la lecture.
//
// MATÉRIEL — le document de transfert est créé d'abord (un seul transfert en cours par équipement), puis le centre de l'équipement est
// changé par une mise à jour CONDITIONNELLE sur le centre source attendu (protège de la course), puis le transfert est terminé.
// L'équipement garde son identifiant et son historique de maintenance.

export const MSG_TRANSFER_NOTHING = "Aucun stock disponible au centre source : rien à transférer.";
export const MSG_TRANSFER_NOT_FOUND = "Transfert introuvable.";
export const MSG_TRANSFER_REQUEST_REUSED = "Cette demande de transfert est déjà utilisée pour un autre transfert.";
export const MSG_TRANSFER_NOT_RESUMABLE = "Ce transfert ne peut plus être repris.";
export const MSG_EQUIPMENT_IN_TRANSFER = "Cet équipement est déjà en cours de transfert.";
export const MSG_EQUIPMENT_UNAVAILABLE = "Cet équipement n'est plus disponible dans ce centre : transfert annulé.";
export const MSG_RECEIPT_NOT_APPLICABLE = "Ce transfert n'a pas de réception à confirmer.";
export const MSG_RECEIPT_TOO_MUCH = "La quantité reçue ne peut pas dépasser la quantité transférée : enregistrez l'entrée en plus depuis la fiche du produit.";
export const MSG_RECEIPT_NOTE_REQUIRED = "Expliquez l'écart en quelques mots.";
export const MSG_TRANSFER_REVERSED = "Ce transfert a été annulé.";
export const MSG_REVERSE_NOT_COMPLETED = "Seul un transfert terminé peut être annulé.";
export const MSG_REVERSE_OF_REVERSAL = "Un retour ne peut pas être annulé : faites un nouveau transfert.";
export const MSG_REVERSE_FORBIDDEN = "Ce transfert ne peut être annulé que par le propriétaire, le centre destinataire, ou son auteur tant que la réception n'est pas confirmée.";
export const MSG_REVERSE_NOTHING = "Le centre destinataire n'a plus de stock de ce produit : rien à retourner.";
export const MSG_REQUEST_NOT_OPEN = "Cette demande a déjà été traitée.";
export const MSG_REQUEST_NOT_ACCEPTED = "Cette demande n'a pas encore été acceptée.";

export type TransferView = {
  id: string;
  kind: StockTransferKind;
  status: StockTransferStatus;
  fromCenterId: string;
  toCenterId: string;
  productId: string | null;
  productName: string | null;
  unit: StockUnit | null;
  equipmentId: string | null;
  equipmentName: string | null;
  requestedQuantity: number | null;
  transferredQuantity: number | null;
  createdAt: string;
  completedAt: string | null;
  note: string | null;
  // Réception : null = transfert sans réception à confirmer (ancien transfert, retour, demande non acceptée).
  receiptStatus: StockReceiptStatus | null;
  receivedQuantity: number | null;
  receiptNote: string | null;
  destinationActivated: boolean;
  decisionNote: string | null;
  // Ce transfert est un retour (annule un autre) / a été annulé par un retour.
  reversesTransferId: string | null;
  reversedByTransferId: string | null;
};

export type TransferResult = {
  transfer: TransferView;
  // Produit seulement : quantité demandée et quantité réellement transférée (plafonnée au stock disponible).
  requested: number | null;
  transferred: number | null;
  capped: boolean;
  // Le transfert était déjà terminé avant cet appel / cet appel a fait avancer le transfert (mouvement créé ou transfert terminé).
  alreadyDone: boolean;
  advanced: boolean;
};

type TransferDoc = NonNullable<Awaited<ReturnType<typeof loadTransfer>>>;
const loadTransfer = (organizationId: string, filter: Record<string, unknown>) => StockTransfer.findOne({ organizationId, ...filter }).lean();

// Données minimales pour terminer un transfert (identifiants en chaînes).
type TransferRef = { id: string; organizationId: string; fromCenterId: string; toCenterId: string; productId: string | null; equipmentId: string | null; requested: number | null };
const refOf = (d: { _id: unknown; organizationId: unknown; fromCenterId: unknown; toCenterId: unknown; productId?: unknown; equipmentId?: unknown; requestedQuantity?: number | null }): TransferRef => ({
  id: String(d._id),
  organizationId: String(d.organizationId),
  fromCenterId: String(d.fromCenterId),
  toCenterId: String(d.toCenterId),
  productId: d.productId ? String(d.productId) : null,
  equipmentId: d.equipmentId ? String(d.equipmentId) : null,
  requested: d.requestedQuantity ?? null,
});

async function viewsOf(organizationId: string, docs: TransferDoc[]): Promise<TransferView[]> {
  const productIds = [...new Set(docs.flatMap((d) => (d.productId ? [String(d.productId)] : [])))];
  const equipmentIds = [...new Set(docs.flatMap((d) => (d.equipmentId ? [String(d.equipmentId)] : [])))];
  const [products, equipment] = await Promise.all([
    productIds.length > 0 ? StockProduct.find({ organizationId, _id: { $in: productIds } }).select("name unit").lean() : [],
    equipmentIds.length > 0 ? Equipment.find({ organizationId, _id: { $in: equipmentIds } }).select("name").lean() : [],
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const equipmentById = new Map(equipment.map((e) => [String(e._id), e]));
  return docs.map((d) => {
    const product = d.productId ? productById.get(String(d.productId)) : undefined;
    const item = d.equipmentId ? equipmentById.get(String(d.equipmentId)) : undefined;
    return {
      id: String(d._id),
      kind: d.kind as StockTransferKind,
      status: d.status as StockTransferStatus,
      fromCenterId: String(d.fromCenterId),
      toCenterId: String(d.toCenterId),
      productId: d.productId ? String(d.productId) : null,
      productName: product?.name ?? null,
      unit: (product?.unit as StockUnit | undefined) ?? null,
      equipmentId: d.equipmentId ? String(d.equipmentId) : null,
      equipmentName: item?.name ?? null,
      requestedQuantity: d.requestedQuantity ?? null,
      transferredQuantity: d.transferredQuantity ?? null,
      createdAt: (d.createdAt ?? new Date(0)).toISOString(),
      completedAt: d.completedAt?.toISOString() ?? null,
      note: d.note ?? null,
      receiptStatus: (d.receiptStatus as StockReceiptStatus | undefined) ?? null,
      receivedQuantity: d.receivedQuantity ?? null,
      receiptNote: d.receiptNote ?? null,
      destinationActivated: d.destinationActivated === true,
      decisionNote: d.decisionNote ?? null,
      reversesTransferId: d.reversesTransferId ? String(d.reversesTransferId) : null,
      reversedByTransferId: d.reversedByTransferId ? String(d.reversedByTransferId) : null,
    };
  });
}

async function resultOf(organizationId: string, id: string, flags: { alreadyDone: boolean; advanced: boolean }): Promise<StockResult<TransferResult>> {
  const doc = await loadTransfer(organizationId, { _id: id });
  if (!doc) return { ok: false, message: MSG_TRANSFER_NOT_FOUND };
  const [transfer] = await viewsOf(organizationId, [doc]);
  const requested = doc.requestedQuantity ?? null;
  const transferred = doc.transferredQuantity ?? null;
  return { ok: true, transfer, requested, transferred, capped: requested !== null && transferred !== null && transferred < requested, ...flags };
}

// ── Produit : étapes 2 à 4, rejouables ──

async function tryProject(key: LedgerKey, movement: TransferMovement) {
  try {
    await projectLevel({ ...key, seq: movement.seq, balanceAfter: movement.balanceAfter });
  } catch (error) {
    // Le mouvement est validé : on ne l'annule pas. La lecture des niveaux détecte le retard et le réaligne (journal = vérité).
    console.error("Projection du niveau de stock en échec après un transfert (mouvement enregistré) :", error);
  }
}

// Niveau du produit au centre destination : créé s'il n'existe pas, pour que la projection ait où s'écrire. Le seuil d'alerte est COPIÉ de la
// source (un seuil à 0 ne déclencherait jamais d'alerte) ; le transfert garde la trace de cette activation (à vérifier). Idempotent.
// Renvoie true quand CET appel a créé le niveau.
async function ensureLevel(key: LedgerKey, alertThreshold: number): Promise<boolean> {
  if (await StockLevel.exists(key)) return false;
  try {
    await StockLevel.create({ ...key, alertThreshold });
    return true;
  } catch (error) {
    if (!isDuplicateKey(error)) throw error; // création simultanée : l'autre appel a créé le niveau
    return false;
  }
}

// Rien n'a pu être prélevé (solde nul) : le transfert est abandonné sans effet sur le stock. Garde-fou de course : si un appel simultané a
// prélevé entre-temps (solde revenu > 0), l'abandon est annulé et le transfert est terminé normalement.
async function abandonProductTransfer(ref: TransferRef, actorId: string): Promise<{ transferred: number; advanced: boolean } | null> {
  await StockTransfer.updateOne({ _id: ref.id, status: "PENDING" }, { $set: { status: "CANCELLED", transferredQuantity: 0, cancelledAt: new Date() } });
  const taken = await StockMovement.exists({ organizationId: ref.organizationId, productId: ref.productId, centerId: ref.fromCenterId, kind: "TRANSFER_OUT", transferId: ref.id });
  if (!taken) return null;
  await StockTransfer.updateOne({ _id: ref.id, status: "CANCELLED" }, { $set: { status: "PENDING", transferredQuantity: null }, $unset: { cancelledAt: 1 } });
  return finishProductTransfer(ref, actorId);
}

async function finishProductTransfer(ref: TransferRef, actorId: string): Promise<{ transferred: number; advanced: boolean } | null> {
  const productId = ref.productId!;
  const source: LedgerKey = { organizationId: ref.organizationId, productId, centerId: ref.fromCenterId };
  const destination: LedgerKey = { organizationId: ref.organizationId, productId, centerId: ref.toCenterId };

  const out = await commitTransferOut({ ...source, transferId: ref.id, requested: ref.requested!, createdBy: actorId });
  if (!out.movement) return abandonProductTransfer(ref, actorId);
  await tryProject(source, out.movement);

  const quantity = -out.movement.delta;
  const sourceLevel = await StockLevel.findOne(source).select("alertThreshold").lean();
  if (await ensureLevel(destination, sourceLevel?.alertThreshold ?? 0)) await StockTransfer.updateOne({ _id: ref.id }, { $set: { destinationActivated: true } });
  const incoming = await commitTransferIn({ ...destination, transferId: ref.id, quantity, createdBy: actorId });
  await tryProject(destination, incoming.movement);

  const done = await StockTransfer.updateOne({ _id: ref.id, status: "PENDING" }, { $set: { status: "COMPLETED", transferredQuantity: quantity, completedAt: new Date() } });
  return { transferred: quantity, advanced: out.created || incoming.created || done.modifiedCount === 1 };
}

// Suite d'un transfert déjà enregistré (même requestId, ou reprise explicite). Un transfert terminé est renvoyé tel quel.
async function continueProduct(actor: StockActor, existing: TransferDoc): Promise<StockResult<TransferResult>> {
  const organizationId = String(existing.organizationId);
  const id = String(existing._id);
  if (existing.status === "COMPLETED") return resultOf(organizationId, id, { alreadyDone: true, advanced: false });
  if (existing.status === "CANCELLED") return { ok: false, message: MSG_TRANSFER_NOTHING };
  if (existing.status === "REQUESTED" || existing.status === "REFUSED") return { ok: false, message: MSG_REQUEST_NOT_ACCEPTED };
  const outcome = await finishProductTransfer(refOf(existing), actor.id);
  if (!outcome) return { ok: false, message: MSG_TRANSFER_NOTHING };
  return resultOf(organizationId, id, { alreadyDone: false, advanced: outcome.advanced });
}

export function transferProduct(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const { organizationId, fromCenterId, toCenterId } = requireTransferCenters(actor, rawField(input, "fromCenterId"), rawField(input, "toCenterId"));
    const parsed = TransferProductSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { requestId, productId, quantity, note } = parsed.data;

    // Nouvel envoi de la même demande : on retrouve le transfert (jamais un second), à condition qu'il porte sur la même chose.
    const replay = async (existing: TransferDoc): Promise<StockResult<TransferResult>> => {
      const same =
        existing.kind === "PRODUCT" &&
        String(existing.productId) === productId.toLowerCase() &&
        String(existing.fromCenterId) === fromCenterId &&
        String(existing.toCenterId) === toCenterId &&
        existing.requestedQuantity === quantity;
      return same ? continueProduct(actor, existing) : { ok: false, message: MSG_TRANSFER_REQUEST_REUSED };
    };
    const known = await loadTransfer(organizationId, { requestId });
    if (known) return replay(known);

    const product = await StockProduct.findOne({ _id: productId, organizationId }).lean();
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };
    const source: LedgerKey = { organizationId, productId: String(product._id), centerId: fromCenterId };
    if (!(await StockLevel.exists(source))) return { ok: false, message: MSG_NOT_ACTIVATED };
    // Disponible lu dans le JOURNAL (vérité) : aucun transfert vide n'est enregistré.
    if ((await readTail(source)).balanceAfter <= 0) return { ok: false, message: MSG_TRANSFER_NOTHING };

    let created;
    try {
      created = await StockTransfer.create({ organizationId, requestId, kind: "PRODUCT", fromCenterId, toCenterId, productId: product._id, requestedQuantity: quantity, note, receiptStatus: "AWAITING", createdBy: actor.id });
    } catch (error) {
      if (!isDuplicateKey(error, "requestId")) throw error;
      const raced = await loadTransfer(organizationId, { requestId }); // envoi simultané de la même demande : l'autre appel a créé le transfert
      if (!raced) throw error;
      return replay(raced);
    }
    const outcome = await finishProductTransfer(refOf(created), actor.id);
    if (!outcome) return { ok: false, message: MSG_TRANSFER_NOTHING };
    return resultOf(organizationId, String(created._id), { alreadyDone: false, advanced: outcome.advanced });
  });
}

// ── Matériel ──

async function finishEquipmentTransfer(ref: TransferRef): Promise<{ advanced: boolean } | StockFailure> {
  const equipmentId = ref.equipmentId!;
  // Mise à jour conditionnelle : le centre source attendu doit être le centre actuel (deux transferts simultanés ne peuvent pas passer).
  const moved = await Equipment.updateOne({ _id: equipmentId, organizationId: ref.organizationId, centerId: ref.fromCenterId, active: true }, { $set: { centerId: ref.toCenterId } });
  if (moved.modifiedCount !== 1) {
    const current = await Equipment.findOne({ _id: equipmentId, organizationId: ref.organizationId }).select("centerId").lean();
    // Déjà au centre destination (reprise après interruption) : on termine. Sinon l'équipement a bougé, a été archivé ou n'existe plus.
    if (!current || String(current.centerId) !== ref.toCenterId) {
      await StockTransfer.updateOne({ _id: ref.id, status: "PENDING" }, { $set: { status: "CANCELLED", cancelledAt: new Date() } });
      return { ok: false, message: MSG_EQUIPMENT_UNAVAILABLE };
    }
  }
  const done = await StockTransfer.updateOne({ _id: ref.id, status: "PENDING" }, { $set: { status: "COMPLETED", completedAt: new Date() } });
  return { advanced: moved.modifiedCount === 1 || done.modifiedCount === 1 };
}

async function continueEquipment(existing: TransferDoc): Promise<StockResult<TransferResult>> {
  const organizationId = String(existing.organizationId);
  const id = String(existing._id);
  if (existing.status === "COMPLETED") return resultOf(organizationId, id, { alreadyDone: true, advanced: false });
  if (existing.status === "CANCELLED") return { ok: false, message: MSG_EQUIPMENT_UNAVAILABLE };
  if (existing.status === "REQUESTED" || existing.status === "REFUSED") return { ok: false, message: MSG_REQUEST_NOT_ACCEPTED };
  const outcome = await finishEquipmentTransfer(refOf(existing));
  if ("ok" in outcome) return outcome;
  return resultOf(organizationId, id, { alreadyDone: false, advanced: outcome.advanced });
}

export function transferEquipment(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const scope = stockScope(actor); // refuse d'emblée un rôle sans droit
    const parsed = TransferEquipmentSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { requestId, equipmentId, note } = parsed.data;
    const requestedTo = rawField(input, "toCenterId");

    // Nouvel envoi de la même demande : retrouvé avant de relire l'équipement (qui peut déjà être dans un centre hors du périmètre du gérant).
    const replay = async (existing: TransferDoc): Promise<StockResult<TransferResult>> => {
      if (!resolveStockCenter(actor, String(existing.fromCenterId))) return { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
      const same = existing.kind === "EQUIPMENT" && String(existing.equipmentId) === equipmentId.toLowerCase() && String(existing.toCenterId) === resolveTransferDestination(actor, requestedTo);
      return same ? continueEquipment(existing) : { ok: false, message: MSG_TRANSFER_REQUEST_REUSED };
    };
    const known = await loadTransfer(scope.organizationId, { requestId });
    if (known) return replay(known);

    // L'équipement est chargé DANS le périmètre de l'acteur : un équipement d'un autre centre, d'une autre organisation ou inexistant reçoit
    // le même message. Le centre source est celui de l'équipement (jamais lu dans la saisie).
    // Course : un envoi simultané de la MÊME demande peut avoir déjà déplacé l'équipement (il n'est alors plus dans ce centre, ou déjà à destination).
    // Avant de refuser, on cherche donc si la demande existe maintenant : c'est un nouvel envoi, pas une erreur.
    const replayIfRaced = async () => {
      const raced = await loadTransfer(scope.organizationId, { requestId });
      return raced ? replay(raced) : null;
    };
    const equipment = await Equipment.findOne({ _id: equipmentId, organizationId: scope.organizationId, centerId: { $in: scope.centerIds } }).lean();
    if (!equipment) return (await replayIfRaced()) ?? { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
    if (!equipment.active) return { ok: false, message: MSG_EQUIPMENT_ARCHIVED };
    let centers: ReturnType<typeof requireTransferCenters>;
    try {
      centers = requireTransferCenters(actor, String(equipment.centerId), requestedTo);
    } catch (error) {
      const raced = await replayIfRaced();
      if (raced) return raced;
      throw error;
    }
    const { organizationId, fromCenterId, toCenterId } = centers;

    let created;
    try {
      created = await StockTransfer.create({ organizationId, requestId, kind: "EQUIPMENT", fromCenterId, toCenterId, equipmentId: equipment._id, note, receiptStatus: "AWAITING", createdBy: actor.id });
    } catch (error) {
      if (!isDuplicateKey(error, "requestId") && !isDuplicateKey(error, "equipmentId")) throw error;
      // Deux index uniques peuvent refuser l'insertion : MongoDB signale le premier violé. Si la demande existe déjà (envoi simultané de la
      // même demande), c'est un nouvel envoi : on la retrouve. Sinon l'équipement a un autre transfert en cours.
      const raced = await loadTransfer(organizationId, { requestId });
      if (raced) return replay(raced);
      if (isDuplicateKey(error, "equipmentId")) return { ok: false, message: MSG_EQUIPMENT_IN_TRANSFER };
      throw error;
    }
    const outcome = await finishEquipmentTransfer(refOf(created));
    if ("ok" in outcome) return outcome;
    return resultOf(organizationId, String(created._id), { alreadyDone: false, advanced: outcome.advanced });
  });
}

// ── Reprise d'un transfert resté incomplet (interruption entre deux étapes) ──
// Un produit archivé depuis ne bloque PAS la reprise : le stock déjà sorti doit arriver à destination. Droits : la source du transfert doit
// être dans le périmètre de l'acteur (un gérant ne reprend que les transferts partis de ses centres) ; sinon « Transfert introuvable. ».
export function resumeTransfer(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = TransferIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const transfer = await loadTransfer(scope.organizationId, { _id: parsed.data.transferId });
    if (!transfer || !scope.centerIds.includes(String(transfer.fromCenterId))) return { ok: false, message: MSG_TRANSFER_NOT_FOUND };
    if (transfer.status === "CANCELLED" || transfer.status === "REQUESTED" || transfer.status === "REFUSED") return { ok: false, message: MSG_TRANSFER_NOT_RESUMABLE };
    return transfer.kind === "PRODUCT" ? continueProduct(actor, transfer) : continueEquipment(transfer);
  });
}

// ── Historique (lecture seule) ──

export type TransferHistory = { transfers: TransferView[]; nextBefore: string | null };

// Transferts dont la source OU la destination est dans les centres de l'acteur (un seul centre si demandé et autorisé), du plus récent au
// plus ancien, paginés par curseur (`before` = identifiant du dernier transfert reçu). Aucune donnée d'une autre organisation.
export function listTransfers(actor: StockActor, input?: unknown): Promise<StockResult<TransferHistory>> {
  return guard(async () => {
    const scope = stockScope(actor, rawField(input, "centerId"));
    const parsed = TransferHistorySchema.safeParse(input && typeof input === "object" ? input : {});
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { limit, before, kind, status } = parsed.data;
    const rows = await StockTransfer.find({
      organizationId: scope.organizationId,
      $or: [{ fromCenterId: { $in: scope.centerIds } }, { toCenterId: { $in: scope.centerIds } }],
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(before ? { _id: { $lt: before } } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = rows.slice(0, limit);
    return { ok: true, transfers: await viewsOf(scope.organizationId, page), nextBefore: rows.length > limit ? String(page[page.length - 1]._id) : null };
  });
}

// ── Réception : le centre destinataire confirme, ou signale un écart ──
// Le stock est déjà arrivé à destination (le transfert est terminé) : la confirmation n'y change rien. Un écart est SIGNALÉ (quantité reçue + motif),
// il ne corrige pas le stock : le gérant ou le propriétaire enregistre ensuite l'entrée ou la correction nécessaire depuis la fiche du produit.
// Qui : le propriétaire, ou le gérant d'un centre DESTINATAIRE. Idempotent : une confirmation déjà enregistrée est renvoyée telle quelle.
export function confirmTransferReceipt(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = TransferReceiptSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { transferId, receivedQuantity, conforme, note } = parsed.data;
    const transfer = await loadTransfer(scope.organizationId, { _id: transferId });
    if (!transfer || !scope.centerIds.includes(String(transfer.toCenterId))) return { ok: false, message: MSG_TRANSFER_NOT_FOUND };
    if (transfer.status !== "COMPLETED" || !transfer.receiptStatus) return { ok: false, message: MSG_RECEIPT_NOT_APPLICABLE };
    if (transfer.reversedByTransferId) return { ok: false, message: MSG_TRANSFER_REVERSED };
    if (transfer.receiptStatus !== "AWAITING") return resultOf(scope.organizationId, transferId, { alreadyDone: true, advanced: false });

    const isProduct = transfer.kind === "PRODUCT";
    const transferred = transfer.transferredQuantity ?? 0;
    const received = isProduct ? (receivedQuantity ?? transferred) : null;
    if (received !== null && received > transferred) return { ok: false, message: MSG_RECEIPT_TOO_MUCH };
    const discrepancy = isProduct ? received !== transferred : conforme === false;
    if (discrepancy && !note) return { ok: false, message: MSG_RECEIPT_NOTE_REQUIRED, errors: { note: [MSG_RECEIPT_NOTE_REQUIRED] } };

    const done = await StockTransfer.updateOne(
      { _id: transferId, organizationId: scope.organizationId, receiptStatus: "AWAITING" },
      { $set: { receiptStatus: discrepancy ? "DISCREPANCY" : "CONFIRMED", receiptBy: actor.id, receiptAt: new Date(), ...(received !== null ? { receivedQuantity: received } : {}), ...(note ? { receiptNote: note } : {}) } },
    );
    return resultOf(scope.organizationId, transferId, { alreadyDone: done.modifiedCount === 0, advanced: done.modifiedCount === 1 });
  });
}

// ── Annulation d'un transfert terminé : un RETOUR, c'est-à-dire un transfert en sens inverse, tracé comme tel ──
// Le journal reste intact (jamais de suppression de mouvement) : le retour est un nouveau transfert (TRANSFER_OUT au centre qui avait reçu, puis
// TRANSFER_IN au centre d'origine), plafonné au stock encore disponible à destination (ce qui a déjà été consommé ne revient pas). Un seul retour
// par transfert ; le retour lui-même n'est pas annulable. Qui : le propriétaire, un gérant du centre destinataire (il renvoie), ou l'auteur du
// transfert (gérant) tant que la réception n'est pas confirmée.
const reverseRequestId = (id: string) => `reverse-${id}`;

async function dropFailedReversal(reversalId: string, originalId: string) {
  // Le retour n'a produit aucun mouvement : il est supprimé pour qu'un nouvel essai soit possible ; le transfert d'origine est libéré.
  await StockTransfer.deleteOne({ _id: reversalId, status: "CANCELLED" });
  await StockTransfer.updateOne({ _id: originalId, reversedByTransferId: reversalId }, { $unset: { reversedByTransferId: 1 } });
}

export function reverseTransfer(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = TransferReverseSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { transferId, note } = parsed.data;
    const original = await loadTransfer(scope.organizationId, { _id: transferId });
    const destinationIn = !!original && scope.centerIds.includes(String(original.toCenterId));
    const sourceIn = !!original && scope.centerIds.includes(String(original.fromCenterId));
    if (!original || (!destinationIn && !sourceIn)) return { ok: false, message: MSG_TRANSFER_NOT_FOUND };
    if (original.reversesTransferId) return { ok: false, message: MSG_REVERSE_OF_REVERSAL };
    if (original.status !== "COMPLETED") return { ok: false, message: MSG_REVERSE_NOT_COMPLETED };
    const isAuthor = !!original.createdBy && String(original.createdBy) === actor.id;
    const allowed = actor.role === "OWNER" || destinationIn || (sourceIn && isAuthor && original.receiptStatus === "AWAITING");
    if (!allowed) return { ok: false, message: MSG_REVERSE_FORBIDDEN };

    const requestId = reverseRequestId(transferId);
    const advance = async (reversal: TransferDoc): Promise<StockResult<TransferResult>> => {
      const result = original.kind === "PRODUCT" ? await continueProduct(actor, reversal) : await continueEquipment(reversal);
      if (!result.ok) {
        // Retour abandonné sans effet (rien à retourner, équipement déplacé) : on libère le transfert d'origine.
        await dropFailedReversal(String(reversal._id), transferId);
        return { ok: false, message: original.kind === "PRODUCT" ? MSG_REVERSE_NOTHING : result.message };
      }
      return result;
    };

    const known = await loadTransfer(scope.organizationId, { requestId });
    if (known) {
      if (known.status === "CANCELLED") await dropFailedReversal(String(known._id), transferId);
      else {
        await StockTransfer.updateOne({ _id: transferId, reversedByTransferId: { $exists: false } }, { $set: { reversedByTransferId: known._id } });
        return advance(known);
      }
    } else if (original.reversedByTransferId) return { ok: false, message: MSG_TRANSFER_REVERSED };

    const isProduct = original.kind === "PRODUCT";
    const quantity = original.transferredQuantity ?? 0;
    if (isProduct && quantity < 1) return { ok: false, message: MSG_REVERSE_NOTHING };
    let created;
    try {
      created = await StockTransfer.create({
        organizationId: scope.organizationId,
        requestId,
        kind: original.kind,
        fromCenterId: original.toCenterId,
        toCenterId: original.fromCenterId,
        ...(isProduct ? { productId: original.productId, requestedQuantity: quantity } : { equipmentId: original.equipmentId }),
        note,
        reversesTransferId: original._id,
        createdBy: actor.id,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await loadTransfer(scope.organizationId, { requestId });
      if (!raced) return { ok: false, message: MSG_TRANSFER_REVERSED }; // un retour existe déjà pour ce transfert
      return advance(raced);
    }
    await StockTransfer.updateOne({ _id: transferId, reversedByTransferId: { $exists: false } }, { $set: { reversedByTransferId: created._id } });
    return advance(created.toObject() as unknown as TransferDoc);
  });
}

// ── Demande de transfert : le centre qui a besoin de stock le demande à un autre centre ──
// Qui demande : le propriétaire ou le gérant du centre DESTINATAIRE (le sien). Qui répond : le propriétaire ou le gérant du centre SOURCE (celui
// à qui on demande) : accepter lance le transfert normal (mêmes plafonds, même réception à confirmer), refuser le clôt. Le demandeur peut retirer sa demande.
export function requestTransfer(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const { organizationId, fromCenterId, toCenterId } = requireRequestCenters(actor, rawField(input, "fromCenterId"), rawField(input, "toCenterId"));
    const parsed = TransferRequestSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { requestId, productId, quantity, note } = parsed.data;
    const same = (existing: TransferDoc) =>
      existing.kind === "PRODUCT" && String(existing.productId) === productId.toLowerCase() && String(existing.fromCenterId) === fromCenterId && String(existing.toCenterId) === toCenterId && existing.requestedQuantity === quantity;
    const known = await loadTransfer(organizationId, { requestId });
    if (known) return same(known) ? resultOf(organizationId, String(known._id), { alreadyDone: true, advanced: false }) : { ok: false, message: MSG_TRANSFER_REQUEST_REUSED };

    const product = await StockProduct.findOne({ _id: productId, organizationId }).lean();
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };
    let created;
    try {
      created = await StockTransfer.create({ organizationId, requestId, kind: "PRODUCT", status: "REQUESTED", fromCenterId, toCenterId, productId: product._id, requestedQuantity: quantity, note, createdBy: actor.id });
    } catch (error) {
      if (!isDuplicateKey(error, "requestId")) throw error;
      const raced = await loadTransfer(organizationId, { requestId });
      if (!raced) throw error;
      return same(raced) ? resultOf(organizationId, String(raced._id), { alreadyDone: true, advanced: false }) : { ok: false, message: MSG_TRANSFER_REQUEST_REUSED };
    }
    return resultOf(organizationId, String(created._id), { alreadyDone: false, advanced: true });
  });
}

export function answerTransferRequest(actor: StockActor, input: unknown): Promise<StockResult<TransferResult>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = TransferAnswerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { transferId, decision, note } = parsed.data;
    const request = await loadTransfer(scope.organizationId, { _id: transferId });
    // « Transfert introuvable » pour une demande hors périmètre : le gérant ne répond que pour son centre source, ne retire que pour son centre.
    const sideCenter = request ? (decision === "WITHDRAW" ? String(request.toCenterId) : String(request.fromCenterId)) : "";
    if (!request || request.kind !== "PRODUCT" || !request.requestedQuantity || !scope.centerIds.includes(sideCenter)) return { ok: false, message: MSG_TRANSFER_NOT_FOUND };
    const now = new Date();

    if (request.status !== "REQUESTED") {
      // Réponse rejouée : une demande déjà acceptée (en cours ou terminée) est renvoyée telle quelle ; le reste est refusé.
      if (decision === "ACCEPT" && request.status === "COMPLETED" && request.decidedBy) return resultOf(scope.organizationId, transferId, { alreadyDone: true, advanced: false });
      if (decision === "ACCEPT" && request.status === "PENDING" && request.decidedBy) return continueProduct(actor, request);
      return { ok: false, message: MSG_REQUEST_NOT_OPEN };
    }

    if (decision === "WITHDRAW") {
      await StockTransfer.updateOne({ _id: transferId, status: "REQUESTED" }, { $set: { status: "CANCELLED", cancelledAt: now } });
      return resultOf(scope.organizationId, transferId, { alreadyDone: false, advanced: true });
    }
    if (decision === "REFUSE") {
      const done = await StockTransfer.updateOne({ _id: transferId, status: "REQUESTED" }, { $set: { status: "REFUSED", decidedBy: actor.id, decidedAt: now, ...(note ? { decisionNote: note } : {}) } });
      return resultOf(scope.organizationId, transferId, { alreadyDone: done.modifiedCount === 0, advanced: done.modifiedCount === 1 });
    }

    // ACCEPT : mêmes contrôles qu'un envoi (produit actif, niveau activé à la source, stock disponible) AVANT de changer le statut.
    const product = await StockProduct.findOne({ _id: request.productId, organizationId: scope.organizationId }).lean();
    if (!product) return { ok: false, message: MSG_PRODUCT_NOT_FOUND };
    if (!product.active) return { ok: false, message: MSG_PRODUCT_ARCHIVED };
    const source: LedgerKey = { organizationId: scope.organizationId, productId: String(product._id), centerId: String(request.fromCenterId) };
    if (!(await StockLevel.exists(source))) return { ok: false, message: MSG_NOT_ACTIVATED };
    if ((await readTail(source)).balanceAfter <= 0) return { ok: false, message: MSG_TRANSFER_NOTHING };
    const claimed = await StockTransfer.updateOne(
      { _id: transferId, status: "REQUESTED" },
      { $set: { status: "PENDING", receiptStatus: "AWAITING", decidedBy: actor.id, decidedAt: now, ...(note ? { decisionNote: note } : {}) } },
    );
    if (claimed.modifiedCount !== 1) return { ok: false, message: MSG_REQUEST_NOT_OPEN };
    const outcome = await finishProductTransfer(refOf(request), actor.id);
    if (!outcome) return { ok: false, message: MSG_TRANSFER_NOTHING };
    return resultOf(scope.organizationId, transferId, { alreadyDone: false, advanced: true });
  });
}

// ── Boîte de réception : ce que l'utilisateur doit traiter ──
// À recevoir : transferts terminés vers l'un de ses centres, réception pas encore confirmée, non annulés. À traiter : demandes adressées à l'un de ses centres.
export type TransferInbox = { toReceive: TransferView[]; requests: TransferView[] };
const INBOX_LIMIT = 50;

export function getTransferInbox(actor: StockActor): Promise<StockResult<TransferInbox>> {
  return guard(async () => {
    const scope = stockScope(actor);
    await connectDB();
    const [incoming, requests] = await Promise.all([
      StockTransfer.find({ organizationId: scope.organizationId, status: "COMPLETED", receiptStatus: "AWAITING", reversedByTransferId: { $exists: false }, toCenterId: { $in: scope.centerIds } })
        .sort({ _id: -1 })
        .limit(INBOX_LIMIT)
        .lean(),
      StockTransfer.find({ organizationId: scope.organizationId, status: "REQUESTED", fromCenterId: { $in: scope.centerIds } })
        .sort({ _id: -1 })
        .limit(INBOX_LIMIT)
        .lean(),
    ]);
    return { ok: true, toReceive: await viewsOf(scope.organizationId, incoming), requests: await viewsOf(scope.organizationId, requests) };
  });
}
