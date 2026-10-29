import { StockLevel, StockMovement } from "@/lib/models/stock";
import { MSG_INSUFFICIENT_STOCK, MSG_LEDGER_BUSY, MSG_ORDER_INCONSISTENT, StockError, isDuplicateKey } from "./errors";

// Module 5 (étape 3) — Journal des mouvements et projection du niveau (mécanisme D6, SANS transaction).
// Principe : StockMovement est la source de vérité ; StockLevel.quantity/seq en sont une PROJECTION réparable.
//   commitMovement  : calcule le rang et le solde à partir de la FIN DU JOURNAL, puis insère UN document complet (point de validation).
//   projectLevel    : affecte (n'incrémente jamais) le niveau à partir d'un mouvement, gardé par `seq: {$lt}` (idempotent, monotone).
//   verifyLedger    : lecture seule ; contrôle les invariants du journal et l'état de la projection.
//   repairLevel     : réaligne la projection sur le journal si, et seulement si, le journal est cohérent. Ne crée aucun
//                     mouvement et ne modifie jamais le journal.
// Ces fonctions ne vérifient AUCUN droit : l'appelant (lib/stock/service.ts) valide l'acteur, l'organisation et le centre.
// Elles supposent une connexion déjà ouverte et des lectures sur le primaire.
//
// Cette garantie est mise à l'épreuve par lib/stock/ledger.test.ts (base MongoDB en mémoire) ; voir son rapport pour ce qui est démontré.

export type LedgerKey = { organizationId: string; productId: string; centerId: string };

export type ManualCommit = LedgerKey & {
  kind: "IN" | "OUT" | "ADJUSTMENT";
  // Variation signée : positive pour IN, négative pour OUT, non nulle pour ADJUSTMENT.
  delta: number;
  note?: string;
  createdBy?: string;
};

export type ProjectableMovement = LedgerKey & { seq: number; balanceAfter: number };

// Relances bornées en cas de collision de rang (un autre écrivain a pris le même rang entre notre lecture et notre insertion).
export const MAX_COMMIT_ATTEMPTS = 60;

const STOCK_INITIAL_NOTE = "Stock initial";

const pause = (attempt: number) => new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(2 ** Math.min(attempt, 5), 25)));

// Fin du journal de (produit, centre) : rang et solde du dernier mouvement.
export async function readTail(key: LedgerKey) {
  const tail = await StockMovement.findOne(key).sort({ seq: -1 }).select("seq balanceAfter").lean();
  return { seq: tail?.seq ?? 0, balanceAfter: tail?.balanceAfter ?? 0 };
}

// Étapes 1 à 3 de D6 : lecture de la fin du journal, calcul, insertion. NE projette PAS (voir projectLevel).
export async function commitMovement(input: ManualCommit) {
  const key: LedgerKey = { organizationId: input.organizationId, productId: input.productId, centerId: input.centerId };
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const tail = await readTail(key);
    const balanceAfter = tail.balanceAfter + input.delta;
    // Jamais de stock négatif : une sortie ou une correction impossible est refusée, jamais plafonnée en silence.
    if (balanceAfter < 0) throw new StockError(MSG_INSUFFICIENT_STOCK);
    try {
      // save() (et non insertMany/updateOne) : validations Mongoose et hook de cohérence exécutés.
      return await new StockMovement({
        ...key,
        kind: input.kind,
        seq: tail.seq + 1,
        delta: input.delta,
        balanceAfter,
        note: input.note || undefined,
        createdBy: input.createdBy,
      }).save();
    } catch (error) {
      if (!isDuplicateKey(error, "seq")) throw error;
      await pause(attempt); // un autre écrivain a pris ce rang : on relit la fin du journal et on recalcule
    }
  }
  throw new StockError(MSG_LEDGER_BUSY);
}

export type ReceiptCommit = LedgerKey & { purchaseOrderId: string; quantity: number; createdBy?: string };

// Réception d'une ligne de commande d'achat : UN mouvement RECEIPT par (commande, produit), jamais deux.
// Idempotent : si le mouvement existe déjà (nouvel envoi, appel simultané, reprise après interruption), il est renvoyé tel quel
// (created: false) et le solde n'est PAS crédité une seconde fois. Étapes 1 à 3 de D6 seulement : ne projette pas (voir projectLevel).
// Deux garde-fous complémentaires : la lecture préalable du mouvement existant, et l'index unique {purchaseOrderId, productId}
// qui tranche une insertion simultanée.
export async function commitReceipt(input: ReceiptCommit): Promise<{ movement: { seq: number; balanceAfter: number; delta: number }; created: boolean }> {
  const key: LedgerKey = { organizationId: input.organizationId, productId: input.productId, centerId: input.centerId };
  const receiptFilter = { ...key, kind: "RECEIPT" as const, purchaseOrderId: input.purchaseOrderId };
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const existing = await StockMovement.findOne(receiptFilter).select("seq balanceAfter delta").lean();
    if (existing) return { movement: { seq: existing.seq, balanceAfter: existing.balanceAfter, delta: existing.delta }, created: false };
    const tail = await readTail(key);
    try {
      const saved = await new StockMovement({
        ...key,
        kind: "RECEIPT",
        seq: tail.seq + 1,
        delta: input.quantity,
        balanceAfter: tail.balanceAfter + input.quantity,
        purchaseOrderId: input.purchaseOrderId,
        createdBy: input.createdBy,
      }).save();
      return { movement: { seq: saved.seq, balanceAfter: saved.balanceAfter, delta: saved.delta }, created: true };
    } catch (error) {
      if (isDuplicateKey(error, "purchaseOrderId")) {
        // Une autre requête a enregistré cette réception : on la relit au tour suivant. Si elle existe mais dans un autre centre
        // (état incohérent), la relecture ne la trouvera jamais : on refuse plutôt que de boucler.
        const elsewhere = await StockMovement.exists({ productId: input.productId, purchaseOrderId: input.purchaseOrderId, kind: "RECEIPT" });
        const here = await StockMovement.exists(receiptFilter);
        if (elsewhere && !here) throw new StockError(MSG_ORDER_INCONSISTENT);
        continue;
      }
      if (!isDuplicateKey(error, "seq")) throw error;
      await pause(attempt); // un autre écrivain a pris ce rang : on relit la fin du journal et on recalcule
    }
  }
  throw new StockError(MSG_LEDGER_BUSY);
}

// Stock initial : mouvement OPENING inséré au rang FIXE 1. Une relance (ou une activation simultanée) tombe sur la clé
// dupliquée du rang 1 et n'ajoute jamais une seconde fois le stock initial. Projette le mouvement de rang 1 existant,
// ce qui répare une activation interrompue entre l'insertion et la projection.
export async function openLevel(input: LedgerKey & { quantity: number; createdBy?: string }) {
  const key: LedgerKey = { organizationId: input.organizationId, productId: input.productId, centerId: input.centerId };
  let created = false;
  try {
    await new StockMovement({
      ...key,
      kind: "OPENING",
      seq: 1,
      delta: input.quantity,
      balanceAfter: input.quantity,
      note: STOCK_INITIAL_NOTE,
      createdBy: input.createdBy,
    }).save();
    created = true;
  } catch (error) {
    if (!isDuplicateKey(error, "seq")) throw error;
  }
  const first = await StockMovement.findOne({ ...key, seq: 1 }).select("seq balanceAfter").lean();
  if (first) await projectLevel({ ...key, seq: first.seq, balanceAfter: first.balanceAfter });
  return { created };
}

// Étape 4 de D6 : projection par AFFECTATION, gardée par le rang. Idempotente (réappliquer = même résultat) et monotone
// (une projection en retard ne peut pas écraser une plus récente). Renvoie true si le niveau a été modifié.
// updateOne conditionnel : c'est le mécanisme atomique prévu ; runValidators applique les contraintes du modèle (entiers ≥ 0).
export async function projectLevel(movement: ProjectableMovement) {
  const result = await StockLevel.updateOne(
    { organizationId: movement.organizationId, productId: movement.productId, centerId: movement.centerId, seq: { $lt: movement.seq } },
    { $set: { quantity: movement.balanceAfter, seq: movement.seq } },
    { runValidators: true },
  );
  return result.modifiedCount === 1;
}

export type LedgerIssueCode =
  | "GAP"
  | "BALANCE"
  | "NEGATIVE_BALANCE"
  | "OPENING_POSITION"
  | "CONSUMPTION_MISMATCH"
  | "DUPLICATE_BOOKING"
  | "RECEIPT_INVALID"
  | "DUPLICATE_ORDER";
export type LedgerIssue = { code: LedgerIssueCode; seq: number; message: string };
// LAGGING = projection en retard (état normal après une interruption) ; AHEAD/MISMATCH = projection incohérente avec un journal sain.
export type ProjectionState = "NO_LEVEL" | "IN_SYNC" | "LAGGING" | "AHEAD" | "MISMATCH";
export type LedgerReport = {
  ledgerOk: boolean;
  issues: LedgerIssue[];
  tail: { seq: number; balanceAfter: number };
  count: number;
  level: { seq: number; quantity: number } | null;
  projection: ProjectionState;
};

// Contrôle en lecture seule. Invariants : rangs 1..n contigus (I1) ; solde = solde précédent + delta et jamais négatif (I2) ;
// OPENING seulement au rang 1 ; consommation : demandé = consommé + manquant (I4) ; une consommation par rendez-vous et produit (I5) ;
// réception : positive, liée à une commande, une seule par commande et produit.
// État de la projection (I3) : comparée à la fin du journal.
export async function verifyLedger(key: LedgerKey): Promise<LedgerReport> {
  const issues: LedgerIssue[] = [];
  let expectedSeq = 1;
  let previousBalance = 0;
  let count = 0;
  const tail = { seq: 0, balanceAfter: 0 };
  const bookings = new Set<string>();
  const orders = new Set<string>();

  for await (const m of StockMovement.find(key).sort({ seq: 1 }).lean().cursor()) {
    count++;
    if (m.seq !== expectedSeq) issues.push({ code: "GAP", seq: m.seq, message: `Rang attendu ${expectedSeq}, trouvé ${m.seq}.` });
    if (m.balanceAfter !== previousBalance + m.delta) {
      issues.push({ code: "BALANCE", seq: m.seq, message: `Solde ${m.balanceAfter} différent de ${previousBalance} + ${m.delta}.` });
    }
    if (m.balanceAfter < 0) issues.push({ code: "NEGATIVE_BALANCE", seq: m.seq, message: "Solde négatif." });
    if (m.kind === "OPENING" && m.seq !== 1) issues.push({ code: "OPENING_POSITION", seq: m.seq, message: "Stock initial hors du rang 1." });
    if (m.kind === "CONSUMPTION") {
      if (m.requested == null || m.shortfall == null || m.requested !== -m.delta + m.shortfall) {
        issues.push({ code: "CONSUMPTION_MISMATCH", seq: m.seq, message: "Quantité demandée incohérente." });
      }
      const booking = String(m.bookingId ?? "");
      if (booking && bookings.has(booking)) issues.push({ code: "DUPLICATE_BOOKING", seq: m.seq, message: "Deux consommations pour un même rendez-vous." });
      bookings.add(booking);
    }
    if (m.kind === "RECEIPT") {
      const order = String(m.purchaseOrderId ?? "");
      if (!order || m.delta <= 0) issues.push({ code: "RECEIPT_INVALID", seq: m.seq, message: "Réception sans commande liée ou non positive." });
      if (order && orders.has(order)) issues.push({ code: "DUPLICATE_ORDER", seq: m.seq, message: "Deux réceptions pour une même commande et un même produit." });
      orders.add(order);
    }
    expectedSeq = m.seq + 1;
    previousBalance = m.balanceAfter;
    tail.seq = m.seq;
    tail.balanceAfter = m.balanceAfter;
  }

  const level = await StockLevel.findOne(key).select("seq quantity").lean();
  const projection: ProjectionState = !level
    ? "NO_LEVEL"
    : level.seq < tail.seq
      ? "LAGGING"
      : level.seq > tail.seq
        ? "AHEAD"
        : level.quantity === tail.balanceAfter
          ? "IN_SYNC"
          : "MISMATCH";
  return { ledgerOk: issues.length === 0, issues, tail, count, level: level ? { seq: level.seq, quantity: level.quantity } : null, projection };
}

export type RepairStatus = "NO_LEVEL" | "IN_SYNC" | "REPAIRED" | "UNCHANGED" | "LEDGER_INCONSISTENT";
export type RepairResult = { status: RepairStatus; report: LedgerReport };

// Réparation contrôlée de la PROJECTION. Jamais de création, modification ni suppression de mouvement.
//  - Journal incohérent : aucune réparation (la projection n'est pas écrasée par un journal douteux).
//  - Projection en retard : projectLevel (gardé, convergent si plusieurs réparations simultanées).
//  - Projection en avance ou divergente : écriture « compare-and-set » sur l'état observé, qui échoue sans effet si un
//    mouvement a été projeté entre-temps (aucun risque de régression).
export async function repairLevel(key: LedgerKey): Promise<RepairResult> {
  const report = await verifyLedger(key);
  if (!report.ledgerOk) return { status: "LEDGER_INCONSISTENT", report };
  if (report.projection === "NO_LEVEL") return { status: "NO_LEVEL", report };
  if (report.projection === "IN_SYNC") return { status: "IN_SYNC", report };

  if (report.projection === "LAGGING") {
    const updated = await projectLevel({ ...key, seq: report.tail.seq, balanceAfter: report.tail.balanceAfter });
    return { status: updated ? "REPAIRED" : "UNCHANGED", report };
  }

  // AHEAD ou MISMATCH : level est défini (sinon NO_LEVEL).
  const observed = report.level!;
  const result = await StockLevel.updateOne(
    { ...key, seq: observed.seq, quantity: observed.quantity },
    { $set: { seq: report.tail.seq, quantity: report.tail.balanceAfter } },
    { runValidators: true },
  );
  return { status: result.modifiedCount === 1 ? "REPAIRED" : "UNCHANGED", report };
}
