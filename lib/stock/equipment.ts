import { connectDB } from "@/lib/db";
import type { EquipmentStatus } from "@/lib/enums";
import { Equipment, MaintenanceRecord } from "@/lib/models/stock";
import { formatDate, isAfterToday } from "./dates";
import { maintenanceState, type MaintenanceState } from "./maintenance";
import {
  CreateEquipmentSchema,
  EquipmentIdSchema,
  MaintenanceHistorySchema,
  MaintenanceInputSchema,
  UpdateEquipmentSchema,
} from "./schemas";
import { guard, invalid, rawField, type StockActor, type StockResult } from "./service";
import { requireStockCenter, stockFilter, stockScope } from "./scope";

// Module 5 (étape 5) — Matériel (F5.1) et maintenance (F5.4). Les droits sont vérifiés ici : OWNER (tous les centres) et
// MANAGER (ses centres). Chaque requête porte l'organisation et la liste des centres autorisés de l'acteur ; un équipement
// inconnu, d'une autre organisation ou d'un centre non autorisé reçoit toujours le même message.
// Aucun rappel en arrière-plan : les échéances sont calculées à la lecture.

export const MSG_EQUIPMENT_NOT_FOUND = "Équipement introuvable.";
export const MSG_EQUIPMENT_ARCHIVED = "Cet équipement est archivé.";
export const MSG_MAINTENANCE_FUTURE = "La date d'intervention ne peut pas être dans le futur.";

export type EquipmentView = {
  id: string;
  centerId: string;
  name: string;
  category: string;
  status: EquipmentStatus;
  acquiredAt: string | null;
  nextMaintenanceAt: string | null;
  maintenanceState: MaintenanceState;
  active: boolean;
};
export type MaintenanceRecordView = { id: string; equipmentId: string; performedAt: string; note: string | null; nextDueAt: string | null };

type EquipmentDoc = {
  _id: unknown;
  centerId: unknown;
  name: string;
  category: string;
  status: string;
  acquiredAt?: Date | null;
  nextMaintenanceAt?: Date | null;
  active: boolean;
};
const equipmentView = (e: EquipmentDoc, now = new Date()): EquipmentView => ({
  id: String(e._id),
  centerId: String(e.centerId),
  name: e.name,
  category: e.category,
  status: e.status as EquipmentStatus,
  acquiredAt: formatDate(e.acquiredAt),
  nextMaintenanceAt: formatDate(e.nextMaintenanceAt),
  maintenanceState: maintenanceState(e.nextMaintenanceAt, now),
  active: e.active,
});

// Charge un équipement DANS le périmètre de l'acteur (organisation + centres autorisés dans la requête elle-même).
async function loadScopedEquipment(actor: StockActor, equipmentId: string) {
  return Equipment.findOne({ _id: equipmentId, ...stockFilter(stockScope(actor)) });
}

export function createEquipment(actor: StockActor, input: unknown): Promise<StockResult<{ equipment: EquipmentView }>> {
  return guard(async () => {
    const { organizationId, centerId } = requireStockCenter(actor, rawField(input, "centerId"));
    const parsed = CreateEquipmentSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const { name, category, status, acquiredAt, nextMaintenanceAt } = parsed.data;
    const equipment = await Equipment.create({ organizationId, centerId, name, category, status, acquiredAt: acquiredAt ?? undefined, nextMaintenanceAt: nextMaintenanceAt ?? null });
    return { ok: true, equipment: equipmentView(equipment) };
  });
}

// Le centre d'un équipement ne change pas (un déplacement entre centres relève des transferts, non disponibles).
// `changed` est faux si la saisie ne modifie rien (aucune écriture : l'action n'écrit alors aucun événement d'audit).
export function updateEquipment(actor: StockActor, input: unknown): Promise<StockResult<{ equipment: EquipmentView; changed: boolean }>> {
  return guard(async () => {
    stockScope(actor); // refuse d'emblée un rôle sans droit
    const parsed = UpdateEquipmentSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const equipment = await loadScopedEquipment(actor, parsed.data.equipmentId);
    if (!equipment) return { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
    if (!equipment.active) return { ok: false, message: MSG_EQUIPMENT_ARCHIVED };

    const d = parsed.data;
    if (d.name !== undefined) equipment.name = d.name;
    if (d.category !== undefined) equipment.category = d.category;
    if (d.status !== undefined) equipment.status = d.status;
    if (d.acquiredAt !== undefined) equipment.acquiredAt = d.acquiredAt ?? undefined;
    if (d.nextMaintenanceAt !== undefined) equipment.nextMaintenanceAt = d.nextMaintenanceAt;
    const changed = equipment.isModified();
    await equipment.save();
    return { ok: true, equipment: equipmentView(equipment), changed };
  });
}

// Archivage (active: false) : l'historique de maintenance reste intact et consultable. Idempotent (`changed` est faux si déjà archivé).
export function archiveEquipment(actor: StockActor, input: unknown): Promise<StockResult<{ equipment: EquipmentView; changed: boolean }>> {
  return guard(async () => {
    stockScope(actor);
    const parsed = EquipmentIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const equipment = await loadScopedEquipment(actor, parsed.data.equipmentId);
    if (!equipment) return { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
    const changed = equipment.active;
    if (changed) {
      equipment.active = false;
      await equipment.save();
    }
    return { ok: true, equipment: equipmentView(equipment), changed };
  });
}

// Équipements des centres autorisés (un seul centre si demandé et autorisé). Les équipements archivés sont exclus sauf demande.
export function listEquipment(actor: StockActor, requestedCenterId?: unknown, includeArchived = false): Promise<StockResult<{ equipment: EquipmentView[] }>> {
  return guard(async () => {
    const scope = stockScope(actor, requestedCenterId);
    await connectDB();
    const rows = await Equipment.find({ ...stockFilter(scope), ...(includeArchived ? {} : { active: true }) }).sort({ name: 1 }).collation({ locale: "fr", strength: 2 }).lean();
    const now = new Date();
    return { ok: true, equipment: rows.map((e) => equipmentView(e, now)) };
  });
}

// Prochaines échéances : équipements actifs avec une date de maintenance, de la plus proche (ou la plus en retard) à la plus lointaine.
export function listMaintenanceSchedule(actor: StockActor, requestedCenterId?: unknown): Promise<StockResult<{ schedule: EquipmentView[] }>> {
  return guard(async () => {
    const scope = stockScope(actor, requestedCenterId);
    await connectDB();
    const rows = await Equipment.find({ ...stockFilter(scope), active: true, nextMaintenanceAt: { $ne: null } }).sort({ nextMaintenanceAt: 1, name: 1 }).lean();
    const now = new Date();
    return { ok: true, schedule: rows.map((e) => equipmentView(e, now)) };
  });
}

// Enregistre une intervention (historique ajouté-seulement). Si c'est l'intervention la plus récente de l'équipement, son
// échéance suivante (ou l'absence d'échéance) devient la prochaine maintenance de la fiche ; une intervention ancienne saisie
// après coup ne touche pas l'échéance en cours. La création de l'intervention et la mise à jour de la fiche sont deux écritures
// non atomiques : si la seconde échoue, l'intervention est conservée et la date de la fiche peut être corrigée par updateEquipment.
export function recordMaintenance(actor: StockActor, input: unknown): Promise<StockResult<{ record: MaintenanceRecordView; equipment: EquipmentView }>> {
  return guard(async () => {
    stockScope(actor);
    const parsed = MaintenanceInputSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { equipmentId, performedAt, note, nextDueAt } = parsed.data;
    if (isAfterToday(performedAt)) return { ok: false, errors: { performedAt: [MSG_MAINTENANCE_FUTURE] } };
    await connectDB();
    const equipment = await loadScopedEquipment(actor, equipmentId);
    if (!equipment) return { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
    if (!equipment.active) return { ok: false, message: MSG_EQUIPMENT_ARCHIVED };

    const latest = await MaintenanceRecord.findOne({ equipmentId: equipment._id }).sort({ performedAt: -1 }).select("performedAt").lean();
    const record = await MaintenanceRecord.create({
      organizationId: equipment.organizationId,
      centerId: equipment.centerId,
      equipmentId: equipment._id,
      performedAt,
      note: note || undefined,
      nextDueAt: nextDueAt ?? undefined,
      createdBy: actor.id,
    });
    if (!latest || performedAt >= latest.performedAt) {
      equipment.nextMaintenanceAt = nextDueAt ?? null;
      await equipment.save();
    }
    return {
      ok: true,
      equipment: equipmentView(equipment),
      record: { id: String(record._id), equipmentId: String(record.equipmentId), performedAt: formatDate(record.performedAt)!, note: record.note ?? null, nextDueAt: formatDate(record.nextDueAt) },
    };
  });
}

// Historique d'un équipement (y compris archivé), du plus récent au plus ancien.
export function listMaintenanceHistory(actor: StockActor, input: unknown): Promise<StockResult<{ history: MaintenanceRecordView[] }>> {
  return guard(async () => {
    stockScope(actor);
    const parsed = MaintenanceHistorySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const equipment = await loadScopedEquipment(actor, parsed.data.equipmentId);
    if (!equipment) return { ok: false, message: MSG_EQUIPMENT_NOT_FOUND };
    const rows = await MaintenanceRecord.find({ equipmentId: equipment._id, organizationId: equipment.organizationId }).sort({ performedAt: -1, createdAt: -1 }).limit(parsed.data.limit).lean();
    return {
      ok: true,
      history: rows.map((r) => ({ id: String(r._id), equipmentId: String(r.equipmentId), performedAt: formatDate(r.performedAt)!, note: r.note ?? null, nextDueAt: formatDate(r.nextDueAt) })),
    };
  });
}
