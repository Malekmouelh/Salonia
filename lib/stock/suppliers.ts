import { connectDB } from "@/lib/db";
import type { SupplierCategory } from "@/lib/enums";
import { PurchaseOrder, Supplier } from "@/lib/models/stock";
import { CreateSupplierSchema, SupplierIdSchema, UpdateSupplierSchema } from "./schemas";
import { guard, invalid, type StockActor, type StockResult } from "./service";
import { isDuplicateKey } from "./errors";
import { requireStockAdmin, requireSupplierAdmin } from "./scope";

// Module 5 (étape 5) — Fournisseurs (F5.5), niveau organisation. Écriture : propriétaire et gérant (le gérant ajoute les fournisseurs
// dont son centre a besoin). Lecture : propriétaire et gérant. Un fournisseur référencé par une commande est archivé, jamais supprimé :
// les commandes gardent sa référence et son nom. Un fournisseur sans aucune commande peut être supprimé définitivement.

export const MSG_SUPPLIER_NOT_FOUND = "Fournisseur introuvable.";
export const MSG_SUPPLIER_ARCHIVED = "Ce fournisseur est archivé.";
export const MSG_SUPPLIER_NAME_TAKEN = "Un fournisseur actif porte déjà ce nom.";
export const MSG_SUPPLIER_HAS_ORDERS = "Ce fournisseur a des commandes : archivez-le plutôt que de le supprimer.";

export type SupplierView = { id: string; name: string; phone: string | null; email: string | null; category: SupplierCategory | null; leadTimeDays: number; active: boolean };
const supplierView = (s: { _id: unknown; name: string; phone?: string | null; email?: string | null; category?: string | null; leadTimeDays: number; active: boolean }): SupplierView => ({
  id: String(s._id),
  name: s.name,
  phone: s.phone ?? null,
  email: s.email ?? null,
  category: (s.category ?? null) as SupplierCategory | null,
  leadTimeDays: s.leadTimeDays,
  active: s.active,
});

export function createSupplier(actor: StockActor, input: unknown): Promise<StockResult<{ supplier: SupplierView }>> {
  return guard(async () => {
    const organizationId = requireSupplierAdmin(actor);
    const parsed = CreateSupplierSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    try {
      const { name, phone, email, category, leadTimeDays } = parsed.data;
      const supplier = await Supplier.create({ organizationId, name, phone: phone ?? undefined, email: email ?? undefined, category: category ?? undefined, leadTimeDays });
      return { ok: true, supplier: supplierView(supplier) };
    } catch (error) {
      if (isDuplicateKey(error, "name")) return { ok: false, errors: { name: [MSG_SUPPLIER_NAME_TAKEN] } };
      throw error;
    }
  });
}

// phone / email : null ou chaîne vide pour effacer, absent pour ne pas toucher.
// `changed` est faux si la saisie ne modifie rien (aucune écriture : l'action n'écrit alors aucun événement d'audit).
export function updateSupplier(actor: StockActor, input: unknown): Promise<StockResult<{ supplier: SupplierView; changed: boolean }>> {
  return guard(async () => {
    const organizationId = requireSupplierAdmin(actor);
    const parsed = UpdateSupplierSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const supplier = await Supplier.findOne({ _id: parsed.data.supplierId, organizationId });
    if (!supplier) return { ok: false, message: MSG_SUPPLIER_NOT_FOUND };
    if (!supplier.active) return { ok: false, message: MSG_SUPPLIER_ARCHIVED };
    const d = parsed.data;
    if (d.name !== undefined) supplier.name = d.name;
    if (d.phone !== undefined) supplier.phone = d.phone ?? undefined;
    if (d.email !== undefined) supplier.email = d.email ?? undefined;
    if (d.category !== undefined) supplier.category = d.category ?? undefined;
    if (d.leadTimeDays !== undefined) supplier.leadTimeDays = d.leadTimeDays;
    const changed = supplier.isModified();
    try {
      await supplier.save();
    } catch (error) {
      if (isDuplicateKey(error, "name")) return { ok: false, errors: { name: [MSG_SUPPLIER_NAME_TAKEN] } };
      throw error;
    }
    return { ok: true, supplier: supplierView(supplier), changed };
  });
}

// Idempotent (`changed` est faux si déjà archivé). Les commandes existantes ne sont pas modifiées.
export function archiveSupplier(actor: StockActor, input: unknown): Promise<StockResult<{ supplier: SupplierView; changed: boolean }>> {
  return guard(async () => {
    const organizationId = requireSupplierAdmin(actor);
    const parsed = SupplierIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const supplier = await Supplier.findOne({ _id: parsed.data.supplierId, organizationId });
    if (!supplier) return { ok: false, message: MSG_SUPPLIER_NOT_FOUND };
    const changed = supplier.active;
    if (changed) {
      supplier.active = false;
      await supplier.save();
    }
    return { ok: true, supplier: supplierView(supplier), changed };
  });
}

// Suppression définitive : refusée dès qu'une commande (même annulée) référence le fournisseur, pour que l'historique des commandes
// reste lisible. Idempotent côté client : un fournisseur déjà supprimé est « introuvable ». Un fournisseur archivé sans commande peut l'être.
export function deleteSupplier(actor: StockActor, input: unknown): Promise<StockResult<{ supplierId: string }>> {
  return guard(async () => {
    const organizationId = requireSupplierAdmin(actor);
    const parsed = SupplierIdSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await connectDB();
    const supplier = await Supplier.findOne({ _id: parsed.data.supplierId, organizationId }).select("_id").lean();
    if (!supplier) return { ok: false, message: MSG_SUPPLIER_NOT_FOUND };
    if (await PurchaseOrder.exists({ organizationId, supplierId: supplier._id })) return { ok: false, message: MSG_SUPPLIER_HAS_ORDERS };
    // Contrôle puis suppression non atomiques : une commande créée entre les deux garde le nom copié (supplierName), seule la référence
    // pointerait vers un fournisseur supprimé. Fenêtre étroite, comme pour le changement d'unité d'un produit.
    await Supplier.deleteOne({ _id: supplier._id, organizationId });
    return { ok: true, supplierId: String(supplier._id) };
  });
}

export function listSuppliers(actor: StockActor, includeArchived = false): Promise<StockResult<{ suppliers: SupplierView[] }>> {
  return guard(async () => {
    const organizationId = requireStockAdmin(actor);
    await connectDB();
    const rows = await Supplier.find({ organizationId, ...(includeArchived ? {} : { active: true }) }).sort({ name: 1 }).collation({ locale: "fr", strength: 2 }).lean();
    return { ok: true, suppliers: rows.map(supplierView) };
  });
}
