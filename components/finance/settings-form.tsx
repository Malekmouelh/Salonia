"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/settings-form.tsx — FORMULAIRE DES PARAMÈTRES FINANCIERS
// ═══════════════════════════════════════════════════════════════════════════
// Réservé au propriétaire. Réglages : TVA, matricule fiscal, mentions de facture, acompte par défaut,
// droit d'encaisser du staff, paiement en ligne. Envoyés à la Server Action saveFinanceSettingsAction,
// qui les valide (Zod) et les enregistre (lib/finance/settings.ts). Ils s'appliquent aux PROCHAINES factures :
// une facture déjà émise ne change jamais (document légal figé).
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useTransition } from "react";
import { saveFinanceSettingsAction, type FinanceResult } from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Toast } from "@/components/ui/modal";
import type { FinanceSettingsData } from "@/lib/finance/settings";

export function SettingsForm({ initial }: { initial: FinanceSettingsData }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<FinanceResult | null>(null);
  // Les champs numériques sont du TEXTE pendant la saisie (la TVA est affichée en % : 0.19 → « 19 »).
  const [vat, setVat] = useState(String(Math.round(initial.vatRate * 10000) / 100));
  const [taxId, setTaxId] = useState(initial.taxId);
  const [footer, setFooter] = useState(initial.invoiceFooter);
  const [deposit, setDeposit] = useState(String(initial.defaultDepositPercent));
  const [staffCanCollect, setStaff] = useState(initial.staffCanCollect);
  const [online, setOnline] = useState(initial.onlinePaymentsEnabled);

  return (
    <form
      className="glass mt-6 max-w-2xl space-y-6 rounded-[2rem] p-7"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () =>
          setToast(
            await saveFinanceSettingsAction({
              vatPercent: Number(vat.replace(",", ".")),
              taxId,
              invoiceFooter: footer,
              defaultDepositPercent: Number(deposit),
              staffCanCollect,
              onlinePaymentsEnabled: online,
            }),
          ),
        );
      }}
    >
      <fieldset className="space-y-4">
        <legend className="font-display text-xl text-white">{t("Facturation")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="vat">{t("TVA (%)")}</label>
            <input id="vat" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} className={inputClass} />
            <p className="mt-1 text-xs text-white/40">{t("19 % en Tunisie pour la plupart des services.")}</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="taxid">{t("Matricule fiscal")}</label>
            <input id="taxid" dir="ltr" maxLength={40} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="1234567/A/M/000" className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="footer">{t("Mentions en pied de facture")}</label>
          <textarea id="footer" rows={3} maxLength={300} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder={t("Conditions de paiement, RIB, mentions légales…")} className={inputClass} />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-xl text-white">{t("Caisse")}</legend>
        <div className="max-w-48">
          <label className={labelClass} htmlFor="deposit">{t("Acompte par défaut (%)")}</label>
          <input id="deposit" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ""))} className={inputClass} />
        </div>
        {/* Cases à cocher : `checked` est contrôlé par l'état, `onChange` le met à jour. */}
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input type="checkbox" checked={staffCanCollect} onChange={(e) => setStaff(e.target.checked)} className="mt-1 h-4 w-4 accent-[#e8b4a0]" />
          <span>
            {t("Le staff peut encaisser ses rendez-vous")}
            <span className="block text-xs text-white/40">{t("Décoché : seuls le gérant et le propriétaire utilisent la caisse.")}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/80">
          <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} className="mt-1 h-4 w-4 accent-[#e8b4a0]" />
          <span>
            {t("Paiement en ligne activé")}
            <span className="block text-xs text-white/40">{t("Décoché : les liens de paiement ne peuvent plus être créés.")}</span>
          </span>
        </label>
      </fieldset>

      <button type="submit" disabled={pending} className="btn-shine rounded-2xl px-8 py-3 text-sm font-semibold text-plum-950 disabled:opacity-60">
        {pending ? t("Un instant…") : t("Enregistrer")}
      </button>
      {toast && (
        <Toast tone={toast.error ? "error" : "success"} onDone={() => setToast(null)}>
          {t(toast.error ?? toast.message ?? "")}
        </Toast>
      )}
    </form>
  );
}
