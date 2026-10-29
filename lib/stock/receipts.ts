import { connectDB } from "@/lib/db";
import { PurchaseOrder, StockLevel, StockMovement, StockProduct } from "@/lib/models/stock";
import { MSG_ORDER_INCONSISTENT } from "./errors";
import { commitReceipt, projectLevel } from "./ledger";
import { checkReceiptConsistency } from "./orders";
import { MSG_ORDER_NOT_FOUND, orderView, type PurchaseOrderView } from "./purchase-orders";
import { OrderIdSchema } from "./schemas";
import { MSG_NOT_ACTIVATED, MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, guard, invalid, type StockActor, type StockFailure, type StockResult } from "./service";
import { stockFilter, stockScope, type StockScope } from "./scope";

// Module 5 — Réception d'une commande d'achat (F5.5). OWNER (tous les centres) et MANAGER (ses centres).
//
// Principe (D6, sans transaction) : chaque ligne devient UN mouvement RECEIPT dans le registre existant, jamais une écriture
// directe de StockLevel.quantity. L'index unique {purchaseOrderId, productId} (kind RECEIPT) interdit un second crédit ; la
// projection est une affectation idempotente. La commande ne passe à RECEIVED qu'après avoir vérifié que TOUTES ses lignes sont
// enregistrées ET projetées.
//
// Reprise après interruption, à chaque frontière d'écriture :
//   1. début de réception posé (receiptStartedAt)     → rien n'est crédité ; un nouvel appel reprend ; l'annulation est refusée ;
//   2. mouvement RECEIPT d'une ligne inséré            → un nouvel appel retrouve le mouvement (created: false), le projette, ne recrédite pas ;
//   3. ligne projetée, lignes suivantes non traitées   → un nouvel appel ne traite que les lignes manquantes ;
//   4. toutes lignes projetées, statut non encore posé → un nouvel appel vérifie puis pose RECEIVED ;
//   5. RECEIVED posé                                   → un nouvel appel ne fait rien (alreadyReceived).
// Si une ligne ne peut pas être traitée, la commande reste ORDERED (réception commencée) avec les mouvements déjà enregistrés.

export const MSG_ORDER_NOT_RECEIVABLE = "Seule une commande passée peut être reçue.";
export { MSG_ORDER_INCONSISTENT };
export const MSG_RECEIPT_INCOMPLETE = "Réception incomplète : certaines lignes n'ont pas pu être traitées. Réessayez.";
export const MSG_UNIT_CHANGED = "L'unité du produit a changé depuis la commande.";
export const MSG_RECEIPT_NOT_PROJECTED = "Le niveau de stock n'a pas pu être mis à jour : réessayez.";

export type ReceiveResult = { order: PurchaseOrderView; alreadyReceived: boolean; recorded: number };

type OrderDoc = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;
type Line = { productId: string; quantity: number; unit: string };

const loadOrder = (scope: StockScope, orderId: string) => PurchaseOrder.findOne({ _id: orderId, ...stockFilter(scope) }).lean();

const orderForCheck = (order: OrderDoc) => ({
  status: order.status as "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED",
  centerId: String(order.centerId),
  receiptStartedAt: order.receiptStartedAt,
  lines: order.lines.map((l) => ({ productId: String(l.productId), quantity: l.quantity })),
});

const loadReceipts = async (order: OrderDoc) =>
  (await StockMovement.find({ organizationId: order.organizationId, purchaseOrderId: order._id, kind: "RECEIPT" }).select("productId centerId delta seq").lean()).map((m) => ({
    productId: String(m.productId),
    centerId: String(m.centerId),
    delta: m.delta,
    seq: m.seq,
  }));

// Revalide côté serveur produits et niveaux des lignes à enregistrer : renvoie les messages d'erreur par produit.
async function validateLines(order: OrderDoc, lines: Line[]): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  if (lines.length === 0) return errors;
  const ids = lines.map((l) => l.productId);
  const [products, levels] = await Promise.all([
    StockProduct.find({ organizationId: order.organizationId, _id: { $in: ids } }).lean(),
    StockLevel.find({ organizationId: order.organizationId, centerId: order.centerId, productId: { $in: ids } }).select("productId").lean(),
  ]);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const levelled = new Set(levels.map((l) => String(l.productId)));
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) errors[line.productId] = [MSG_PRODUCT_NOT_FOUND];
    else if (!product.active) errors[line.productId] = [MSG_PRODUCT_ARCHIVED];
    else if (product.unit !== line.unit) errors[line.productId] = [MSG_UNIT_CHANGED];
    else if (!levelled.has(line.productId)) errors[line.productId] = [MSG_NOT_ACTIVATED];
  }
  return errors;
}

// ── Étapes élémentaires, exposées pour que les tests simulent une interruption à chaque frontière d'écriture ──

// Pose le début de réception, une seule fois et de façon atomique (ORDERED et jamais commencée). Renvoie true si la commande
// est ORDERED avec une réception commencée (par cet appel ou par un appel précédent), false sinon (annulée, reçue, brouillon).
async function claim(scope: StockScope, orderId: string) {
  const claimed = await PurchaseOrder.updateOne({ _id: orderId, ...stockFilter(scope), status: "ORDERED", receiptStartedAt: null }, { $set: { receiptStartedAt: new Date() } });
  if (claimed.modifiedCount === 1) return true;
  return (await PurchaseOrder.exists({ _id: orderId, ...stockFilter(scope), status: "ORDERED", receiptStartedAt: { $ne: null } })) !== null;
}

// Enregistre le mouvement RECEIPT d'une ligne (idempotent) puis le projette. Une erreur de projection ne perd rien : le mouvement
// est validé, confirmProjected la rattrape. Renvoie true si ce mouvement vient d'être créé par cet appel.
async function applyLine(order: OrderDoc, line: Line, createdBy: string) {
  const key = { organizationId: String(order.organizationId), productId: line.productId, centerId: String(order.centerId) };
  const { movement, created } = await commitReceipt({ ...key, purchaseOrderId: String(order._id), quantity: line.quantity, createdBy });
  try {
    await projectLevel({ ...key, seq: movement.seq, balanceAfter: movement.balanceAfter });
  } catch (error) {
    console.error("Projection du niveau en échec après une réception (mouvement enregistré) :", error);
  }
  return created;
}

// Vérifie que chaque ligne a son mouvement RECEIPT ET que le niveau l'a projeté (rang du niveau ≥ rang du mouvement) ; tente de
// projeter les niveaux en retard. Renvoie les produits dont la ligne n'est pas confirmée.
async function confirmProjected(order: OrderDoc): Promise<string[]> {
  const receipts = new Map((await loadReceipts(order)).map((r) => [r.productId, r]));
  const unconfirmed: string[] = [];
  for (const line of order.lines) {
    const productId = String(line.productId);
    const receipt = receipts.get(productId);
    if (!receipt) {
      unconfirmed.push(productId);
      continue;
    }
    const key = { organizationId: order.organizationId, productId, centerId: order.centerId };
    let level = await StockLevel.findOne(key).select("seq").lean();
    if (level && level.seq < receipt.seq) {
      const movement = await StockMovement.findOne({ ...key, purchaseOrderId: order._id, kind: "RECEIPT" }).select("seq balanceAfter").lean();
      if (movement) {
        try {
          await projectLevel({ organizationId: String(order.organizationId), productId, centerId: String(order.centerId), seq: movement.seq, balanceAfter: movement.balanceAfter });
        } catch (error) {
          console.error("Projection du niveau en échec lors de la confirmation de réception :", error);
        }
        level = await StockLevel.findOne(key).select("seq").lean();
      }
    }
    if (!level || level.seq < receipt.seq) unconfirmed.push(productId);
  }
  return unconfirmed;
}

// Pose RECEIVED, atomiquement, seulement si la commande est ORDERED avec une réception commencée.
const finalize = (scope: StockScope, orderId: string) =>
  PurchaseOrder.findOneAndUpdate(
    { _id: orderId, ...stockFilter(scope), status: "ORDERED", receiptStartedAt: { $ne: null } },
    { $set: { status: "RECEIVED", receivedAt: new Date() } },
    { returnDocument: "after", runValidators: true },
  ).lean();

export const receiptSteps = { claim, applyLine, confirmProjected, finalize, validateLines, loadReceipts };

function incomplete(errors: Record<string, string[]>): StockFailure {
  return { ok: false, message: MSG_RECEIPT_INCOMPLETE, errors };
}

// Reçoit une commande ORDERED : un mouvement RECEIPT par ligne, projeté, puis statut RECEIVED. Rappeler cette fonction (nouvel
// envoi, appel simultané, reprise après interruption) est sans danger : aucun produit n'est crédité deux fois.
export function receivePurchaseOrder(actor: StockActor, input: unknown): Promise<StockResult<ReceiveResult>> {
  return guard(async () => {
    const scope = stockScope(actor);
    const parsed = OrderIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const orderId = parsed.data.orderId;

    const order = await loadOrder(scope, orderId);
    if (!order) return { ok: false, message: MSG_ORDER_NOT_FOUND };

    // Cohérence avant toute écriture : une commande douteuse n'est jamais reçue.
    const receipts = await loadReceipts(order);
    const reason = checkReceiptConsistency(orderForCheck(order), receipts);
    if (reason) {
      console.error(`Réception refusée, commande ${orderId} incohérente : ${reason}`);
      return { ok: false, message: MSG_ORDER_INCONSISTENT };
    }

    if (order.status === "RECEIVED") {
      await confirmProjected(order); // rattrape silencieusement une projection en retard
      return { ok: true, order: orderView(order), alreadyReceived: true, recorded: 0 };
    }
    if (order.status !== "ORDERED") return { ok: false, message: MSG_ORDER_NOT_RECEIVABLE };

    // Lignes encore à enregistrer : validées AVANT toute écriture, pour qu'un refus ordinaire ne laisse rien d'à moitié fait.
    const done = new Set(receipts.map((r) => r.productId));
    const pending: Line[] = order.lines.filter((l) => !done.has(String(l.productId))).map((l) => ({ productId: String(l.productId), quantity: l.quantity, unit: l.unit }));
    const errors = await validateLines(order, pending);
    if (Object.keys(errors).length > 0) return incomplete(errors);

    if (!(await claim(scope, orderId))) {
      // Annulée, ou reçue par une requête concurrente entre-temps.
      const current = await loadOrder(scope, orderId);
      if (current?.status === "RECEIVED" && !checkReceiptConsistency(orderForCheck(current), await loadReceipts(current))) {
        return { ok: true, order: orderView(current), alreadyReceived: true, recorded: 0 };
      }
      return { ok: false, message: MSG_ORDER_NOT_RECEIVABLE };
    }

    let recorded = 0;
    for (const line of pending) {
      if (await applyLine(order, line, actor.id)) recorded++;
    }

    const unconfirmed = await confirmProjected(order);
    if (unconfirmed.length > 0) return incomplete(Object.fromEntries(unconfirmed.map((id) => [id, [MSG_RECEIPT_NOT_PROJECTED]])));

    const received = await finalize(scope, orderId);
    if (received) return { ok: true, order: orderView(received), alreadyReceived: false, recorded };

    // Une requête concurrente a terminé avant nous : même résultat, sans nouveau crédit.
    const current = await loadOrder(scope, orderId);
    if (current?.status === "RECEIVED") return { ok: true, order: orderView(current), alreadyReceived: true, recorded };
    return { ok: false, message: MSG_ORDER_INCONSISTENT };
  });
}
