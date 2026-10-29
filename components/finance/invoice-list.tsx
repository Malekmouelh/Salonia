"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/invoice-list.tsx — LE TABLEAU DES FACTURES (F6.3)
// ═══════════════════════════════════════════════════════════════════════════
// Affiche la liste des factures avec : recherche (par numéro ou nom de client), filtre par statut,
// lien vers le PDF et, pour le propriétaire, l'annulation d'une facture (fenêtre modale avec motif).
//
// FONCTIONNEMENT DE LA RECHERCHE : le texte tapé est écrit dans l'ADRESSE (?q=…) après une courte
// pause (300 ms, technique du « debounce »). La page SERVEUR relit l'adresse et refait la requête
// en base de données ; ce composant reçoit alors la nouvelle liste. Pas de filtrage côté navigateur.
// ═══════════════════════════════════════════════════════════════════════════

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cancelInvoiceAction, type FinanceResult } from "@/app/actions/finance";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal, Toast } from "@/components/ui/modal";
import { fmtDay, fmtMoney } from "@/lib/booking/format";
import type { InvoiceRow } from "@/lib/data/finance";
import { INVOICE_STATUS_META } from "@/lib/finance/labels";
import { selectClass } from "./finance-ui";

// F6.3 — Liste des factures : recherche, filtre par statut, PDF, annulation (propriétaire).
export function InvoiceList({ invoices, initialQuery, status, canCancel }: { invoices: InvoiceRow[]; initialQuery: string; status: string; canCancel: boolean }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // `query` = ce que l'utilisateur est en train de taper (état local, mis à jour à chaque frappe).
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  // `cancelling` = la facture dont on est en train de demander l'annulation (null = fenêtre fermée).
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState<FinanceResult | null>(null); // notification de succès/erreur

  // Modifie un paramètre de l'adresse (ici le filtre de statut) en conservant les autres.
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key); // valeur vide → on retire le paramètre
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // « DEBOUNCE » de la recherche : on attend 300 ms sans frappe avant de modifier l'adresse, pour ne
  // pas lancer une requête à chaque lettre tapée. À chaque nouvelle frappe, le minuteur précédent est
  // annulé (`clearTimeout` dans la fonction de nettoyage renvoyée par useEffect) et un nouveau démarre.
  useEffect(() => {
    if (query === initialQuery) return; // rien à faire si la recherche n'a pas changé
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (query) next.set("q", query);
      else next.delete("q");
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(id);
  }, [query, initialQuery, params, pathname, router]);

  // Total des factures affichées, hors factures annulées.
  const total = invoices.filter((i) => i.status !== "CANCELLED").reduce((n, i) => n + i.totalTnd, 0);

  return (
    <div className="mt-4 space-y-4">
      {/* Barre de recherche + filtre de statut */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("N° de facture ou nom du client…")}
          aria-label={t("Rechercher une facture")}
          className={`${selectClass} min-w-56 flex-1`}
        />
        <select aria-label={t("Statut")} value={status} onChange={(e) => update("status", e.target.value)} className={selectClass}>
          <option value="">{t("Tous les statuts")}</option>
          {/* Les statuts proposés viennent de INVOICE_STATUS_META (labels.ts) : une seule source de vérité. */}
          {Object.entries(INVOICE_STATUS_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {t(meta.label)}
            </option>
          ))}
        </select>
        {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-champagne" />}
      </div>
      <p className="text-xs text-white/45">
        {invoices.length} {t("factures")} · {t("total")} {fmtMoney(total, lang)}
      </p>

      {invoices.length === 0 ? (
        <p className="glass rounded-[2rem] p-10 text-center text-white/50">{t("Aucune facture trouvée.")}</p>
      ) : (
        <div className="glass overflow-x-auto rounded-[2rem] p-2">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs text-white/45">
                <th className="px-3 py-3 text-start font-medium">{t("Numéro")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Date")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Client")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Prestations")}</th>
                <th className="px-3 py-3 text-end font-medium">{t("Total TTC")}</th>
                <th className="px-3 py-3 text-start font-medium">{t("Statut")}</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-white/5">
                  {/* `dir="ltr"` : le numéro (FAC-2026-00042) reste écrit de gauche à droite même en arabe. */}
                  <td className="px-3 py-3 font-medium text-white" dir="ltr">{i.number}</td>
                  <td className="px-3 py-3 text-white/60">{fmtDay(i.issuedAt, lang, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="px-3 py-3 text-white/85">
                    {i.customerName}
                    <p className="text-xs text-white/40">{i.center}</p>
                  </td>
                  {/* Résumé des prestations tronqué (`truncate`) ; le texte complet s'affiche au survol (`title`). */}
                  <td className="max-w-56 truncate px-3 py-3 text-white/60" title={i.lines}>{i.lines}</td>
                  <td className="px-3 py-3 text-end tabular-nums text-white">
                    {fmtMoney(i.totalTnd, lang)}
                    {i.discountTnd > 0 && <p className="text-xs text-white/40">{t("remise")} {fmtMoney(i.discountTnd, lang)}</p>}
                  </td>
                  {/* Pastille de statut ; pour une facture annulée, le motif s'affiche au survol. */}
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs ${INVOICE_STATUS_META[i.status].chip}`} title={i.cancelReason ?? undefined}>
                      {t(INVOICE_STATUS_META[i.status].label)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-end text-xs">
                    {/* Ouvre le PDF dans un nouvel onglet (route /api/finance/invoices/[id]). */}
                    <a href={`/api/finance/invoices/${i.id}`} target="_blank" rel="noreferrer" className="text-rose-gold underline-offset-4 hover:underline">
                      PDF
                    </a>
                    {/* Bouton « Annuler » : propriétaire seulement, et pas pour une facture déjà annulée. */}
                    {canCancel && i.status !== "CANCELLED" && (
                      <button type="button" onClick={() => setCancelling(i)} className="ms-3 text-white/45 hover:text-red-300">
                        {t("Annuler")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fenêtre modale d'annulation : affichée seulement quand `cancelling` contient une facture. */}
      {cancelling && (
        <Modal open onClose={() => setCancelling(null)} title={`${t("Annuler la facture")} ${cancelling.number}`}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                // Appel de la Server Action (qui revérifie que l'utilisateur est bien le propriétaire).
                const r = await cancelInvoiceAction({ invoiceId: cancelling.id, reason });
                setToast(r);
                if (r.ok) {
                  setCancelling(null);
                  setReason("");
                  // `router.refresh()` recharge les données de la page serveur (la facture apparaît « Annulée »).
                  router.refresh();
                }
              });
            }}
          >
            <p className="text-sm text-white/65">
              {t("Le numéro reste attribué et la facture est conservée avec la mention « annulée ». Les paiements restent enregistrés : remboursez-les depuis la caisse si nécessaire.")}
            </p>
            <div>
              <label className={labelClass} htmlFor="cancel-reason">{t("Motif")}</label>
              {/* `required` + `minLength` : contrôle immédiat dans le navigateur (le serveur le revérifie avec Zod). */}
              <input id="cancel-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </div>
            <button type="submit" disabled={pending} className="w-full rounded-2xl bg-red-500/80 py-3 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-60">
              {t("Annuler la facture")}
            </button>
          </form>
        </Modal>
      )}
      {/* Notification éphémère (succès en vert, erreur en rouge). */}
      {toast && (
        <Toast tone={toast.error ? "error" : "success"} onDone={() => setToast(null)}>
          {t(toast.error ?? toast.message ?? "")}
        </Toast>
      )}
    </div>
  );
}
