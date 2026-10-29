"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { archiveSupplierAction, createSupplierAction, updateSupplierAction } from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { MailIcon, PhoneIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import type { SupplierView } from "@/lib/stock/suppliers";
import { Chip, EmptyState, FieldError, fmtQty, useFeedback, useSubmit } from "./stock-shared";

// F5.5 — Fournisseurs. Écriture réservée au propriétaire (le gérant consulte seulement) ; l'archivage conserve la fiche et les commandes
// existantes gardent le nom du fournisseur tel qu'au moment de la commande.

export function SuppliersManager({ suppliers, orderCount, canManage }: { suppliers: SupplierView[]; orderCount: Record<string, number>; canManage: boolean }) {
  const { t, lang } = useI18n();
  const feedback = useFeedback();
  const [modal, setModal] = useState<{ supplier: SupplierView | null } | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => suppliers.filter((s) => (showArchived || s.active) && (!needle || `${s.name} ${s.email ?? ""} ${s.phone ?? ""}`.toLowerCase().includes(needle))),
    [suppliers, showArchived, needle],
  );

  const archive = (s: SupplierView) => {
    if (!confirm(t("Archiver ce fournisseur ? Les commandes existantes gardent son nom."))) return;
    startTransition(async () => {
      const r = await archiveSupplierAction({ supplierId: s.id });
      feedback.show(r.ok ? (r.message ?? "Fournisseur archivé.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">{t("Rechercher un fournisseur")}</span>
          <SearchIcon width={16} height={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Rechercher un fournisseur")} className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pe-3 ps-9 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60" />
        </label>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-rose-gold" />
          {t("Afficher les archivés")}
        </label>
        {canManage ? (
          <button type="button" onClick={() => setModal({ supplier: null })} className="btn-shine ms-auto flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950">
            <PlusIcon width={16} height={16} /> {t("Ajouter un fournisseur")}
          </button>
        ) : (
          <p className="ms-auto text-xs text-white/45">{t("Consultation seule : le propriétaire gère les fournisseurs.")}</p>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState>{suppliers.length === 0 ? t("Aucun fournisseur enregistré.") : t("Aucun fournisseur ne correspond.")}</EmptyState>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <li key={s.id} className={`glass rounded-3xl p-5 ${s.active ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-medium text-white">{s.name}</p>
                {s.active ? <Chip tone="ok">{t("Actif")}</Chip> : <Chip tone="muted">{t("Archivé")}</Chip>}
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-white/70">
                <li className="flex items-center gap-2">
                  <PhoneIcon width={14} height={14} className="shrink-0 text-white/35" />
                  {s.phone ? <bdi className="tabular-nums">{s.phone}</bdi> : <span className="text-white/35">—</span>}
                </li>
                <li className="flex items-center gap-2">
                  <MailIcon width={14} height={14} className="shrink-0 text-white/35" />
                  {s.email ? <bdi className="truncate">{s.email}</bdi> : <span className="text-white/35">—</span>}
                </li>
              </ul>
              <p className="mt-3 text-xs text-white/50">
                {t("Délai de livraison")} : <bdi>{fmtQty(s.leadTimeDays, lang)}</bdi> {t("jour(s)")}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {t("Commandes")} : <bdi>{fmtQty(orderCount[s.id] ?? 0, lang)}</bdi>{" "}
                {(orderCount[s.id] ?? 0) > 0 && (
                  <Link href="/dashboard/stock/commandes" className="text-champagne hover:underline">
                    {t("Voir")}
                  </Link>
                )}
              </p>
              {canManage && s.active && (
                <div className="mt-4 flex gap-4 text-xs">
                  <button type="button" onClick={() => setModal({ supplier: s })} className="text-white/60 hover:text-white">
                    {t("Modifier")}
                  </button>
                  <button type="button" disabled={pending} onClick={() => archive(s)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                    {t("Archiver")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {modal && <SupplierModal supplier={modal.supplier} onClose={() => setModal(null)} onDone={(m) => feedback.show(m)} />}
      {feedback.node}
    </div>
  );
}

function SupplierModal({ supplier, onClose, onDone }: { supplier: SupplierView | null; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const [form, setForm] = useState({ name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", leadTimeDays: String(supplier?.leadTimeDays ?? 0) });
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={t(supplier ? "Modifier le fournisseur" : "Ajouter un fournisseur")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = { name: form.name, phone: form.phone, email: form.email, leadTimeDays: form.leadTimeDays.trim() === "" ? undefined : Number(form.leadTimeDays) };
          submit(() => (supplier ? updateSupplierAction({ supplierId: supplier.id, ...body }) : createSupplierAction(body)));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-name`}>{t("Nom")}</label>
          <input id={`${uid}-name`} required maxLength={80} value={form.name} onChange={set("name")} className={inputClass} />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${uid}-phone`}>{t("Téléphone")} ({t("facultatif")})</label>
            <input id={`${uid}-phone`} inputMode="tel" value={form.phone} onChange={set("phone")} placeholder="71 234 567" className={inputClass} dir="ltr" />
            <FieldError errors={errors} name="phone" />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-email`}>{t("E-mail")} ({t("facultatif")})</label>
            <input id={`${uid}-email`} type="email" value={form.email} onChange={set("email")} className={inputClass} dir="ltr" />
            <FieldError errors={errors} name="email" />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${uid}-lead`}>{t("Délai de livraison (jours)")}</label>
          <input id={`${uid}-lead`} inputMode="numeric" value={form.leadTimeDays} onChange={set("leadTimeDays")} className={inputClass} />
          <p className="mt-1 text-xs text-white/40">{t("De 0 à 365 jours.")}</p>
          <FieldError errors={errors} name="leadTimeDays" />
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}
