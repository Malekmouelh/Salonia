import { connectDB } from "@/lib/db";
import type { StockTransferKind, StockTransferStatus, StockUnit } from "@/lib/enums";
import { Equipment, StockLevel, StockMovement, StockProduct, StockTransfer } from "@/lib/models/stock";
import { MSG_EQUIPMENT_ARCHIVED, MSG_EQUIPMENT_NOT_FOUND } from "./equipment";
import { isDuplicateKey } from "./errors";
import { commitTransferIn, commitTransferOut, projectLevel, readTail, type LedgerKey, type TransferMovement } from "./ledger";
import { TransferEquipmentSchema, TransferHistorySchema, TransferIdSchema, TransferProductSchema } from "./schemas";
import { requireTransferCenters, resolveStockCenter, resolveTransferDestination, stockScope } from "./scope";
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

// Niveau du produit au centre destination : créé (seuil 0) s'il n'existe pas, pour que la projection ait où s'écrire. Idempotent.
async function ensureLevel(key: LedgerKey) {
  if (await StockLevel.exists(key)) return;
  try {
    await StockLevel.create({ ...key, alertThreshold: 0 });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error; // création simultanée : l'autre appel a créé le niveau
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
  await ensureLevel(destination);
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
    const { requestId, productId, quantity } = parsed.data;

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
      created = await StockTransfer.create({ organizationId, requestId, kind: "PRODUCT", fromCenterId, toCenterId, productId: product._id, requestedQuantity: quantity, createdBy: actor.id });
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
    const { requestId, equipmentId } = parsed.data;
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
    const equipment = await Equipment.findOne({ _id: equipmentId, organizationId: scope.organizationId, centerId: { $in: scope.centerIds } }).lean();
    if (!equipment) return { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
    if (!equipment.active) return { ok: false, message: MSG_EQUIPMENT_ARCHIVED };
    const { organizationId, fromCenterId, toCenterId } = requireTransferCenters(actor, String(equipment.centerId), requestedTo);

    let created;
    try {
      created = await StockTransfer.create({ organizationId, requestId, kind: "EQUIPMENT", fromCenterId, toCenterId, equipmentId: equipment._id, createdBy: actor.id });
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
    if (transfer.status === "CANCELLED") return { ok: false, message: MSG_TRANSFER_NOT_RESUMABLE };
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
    const { limit, before, kind } = parsed.data;
    const rows = await StockTransfer.find({
      organizationId: scope.organizationId,
      $or: [{ fromCenterId: { $in: scope.centerIds } }, { toCenterId: { $in: scope.centerIds } }],
      ...(kind ? { kind } : {}),
      ...(before ? { _id: { $lt: before } } : {}),
    })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = rows.slice(0, limit);
    return { ok: true, transfers: await viewsOf(scope.organizationId, page), nextBefore: rows.length > limit ? String(page[page.length - 1]._id) : null };
  });
}
