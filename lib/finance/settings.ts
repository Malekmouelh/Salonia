// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/settings.ts — LES PARAMÈTRES FINANCIERS D'UN SALON
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE : lire et enregistrer les réglages que le PROPRIÉTAIRE peut modifier (TVA, matricule fiscal,
// mentions de facture, droits du staff, acompte par défaut, paiement en ligne).
//
// PRINCIPE DES VALEURS PAR DÉFAUT : tant que le propriétaire n'a rien enregistré, aucun document n'existe
// en base ; `getFinanceSettings` renvoie alors DEFAULT_SETTINGS. Le module marche donc dès le premier
// jour, sans configuration. Le document n'est créé qu'à la première sauvegarde (« upsert »).
// ═══════════════════════════════════════════════════════════════════════════
import "server-only";
import { connectDB } from "@/lib/db";
import { FinanceSettings } from "@/lib/models/finance";

// Réglages tels que le reste du code les manipule (types simples, sans détails MongoDB).
export type FinanceSettingsData = {
  vatRate: number;
  taxId: string;
  invoiceFooter: string;
  defaultDepositPercent: number;
  staffCanCollect: boolean;
  onlinePaymentsEnabled: boolean;
};

// Valeurs appliquées tant que rien n'est configuré : TVA tunisienne 19 %, acompte de 30 %, tout autorisé.
export const DEFAULT_SETTINGS: FinanceSettingsData = {
  vatRate: 0.19,
  taxId: "",
  invoiceFooter: "",
  defaultDepositPercent: 30,
  staffCanCollect: true,
  onlinePaymentsEnabled: true,
};

// Lit les réglages d'un salon (ou les valeurs par défaut). `.lean()` = objet JavaScript simple.
export async function getFinanceSettings(organizationId: string): Promise<FinanceSettingsData> {
  await connectDB();
  const doc = await FinanceSettings.findOne({ organizationId }).lean();
  if (!doc) return DEFAULT_SETTINGS;
  return {
    vatRate: doc.vatRate ?? DEFAULT_SETTINGS.vatRate,
    taxId: doc.taxId ?? "",
    invoiceFooter: doc.invoiceFooter ?? "",
    defaultDepositPercent: doc.defaultDepositPercent ?? DEFAULT_SETTINGS.defaultDepositPercent,
    staffCanCollect: doc.staffCanCollect ?? true,
    onlinePaymentsEnabled: doc.onlinePaymentsEnabled ?? true,
  };
}

// Enregistre les réglages. `upsert: true` : crée le document s'il n'existe pas, le met à jour sinon.
// `runValidators: true` : les contraintes du schéma (TVA entre 0 et 50 %, longueurs…) sont revérifiées.
export async function saveFinanceSettings(organizationId: string, data: FinanceSettingsData) {
  await connectDB();
  await FinanceSettings.updateOne({ organizationId }, { $set: data }, { upsert: true, runValidators: true });
}
