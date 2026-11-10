"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { archiveSupplierAction, createSupplierAction, deleteSupplierAction, updateSupplierAction } from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { MailIcon, PhoneIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { SUPPLIER_CATEGORIES, type SupplierCategory } from "@/lib/enums";
import { supplierContact } from "@/lib/stock/contact";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/stock/labels";
import type { SupplierView } from "@/lib/stock/suppliers";
import { Chip, EmptyState, FieldError, fmtQty, useFeedback, useSubmit, useConfirm } from "./stock-shared";

// F5.5 — Fournisseurs. Propriétaire et gérant les gèrent. L'archivage conserve la fiche : les commandes existantes gardent le nom du
// fournisseur tel qu'au moment de la commande. La suppression définitive n'est proposée que pour un fournisseur sans commande (le service
// la refuse sinon). Recherche, catégorie et tri sont locaux : la liste est déjà chargée.

type SortKey = "name" | "leadTime" | "orders";

export function SuppliersManager({ suppliers, orderCount, canManage }: { suppliers: SupplierView[]; orderCount: Record<string, number>; canManage: boolean }) {
  const { t, lang } = useI18n();
  const feedback = useFeedback();
  const dialog = useConfirm();
  const [modal, setModal] = useState<{ supplier: SupplierView | null } | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [category, setCategory] = useState<SupplierCategory | "NONE" | "">("");
  const [sort, setSort] = useState<SortKey>("name");
  const [pending, startTransition] = useTransition();
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const rows = suppliers.filter(
      (s) =>
        (showArchived || s.active) &&
        (category === "" || (category === "NONE" ? s.category === null : s.category === category)) &&
        (!needle || `${s.name} ${s.email ?? ""} ${s.phone ?? ""}`.toLowerCase().includes(needle)),
    );
    // « name » garde l'ordre du serveur (alphabétique, insensible à la casse) ; les égalités restent dans cet ordre (tri stable).
    if (sort === "leadTime") return [...rows].sort((a, b) => a.leadTimeDays - b.leadTimeDays);
    if (sort === "orders") return [...rows].sort((a, b) => (orderCount[b.id] ?? 0) - (orderCount[a.id] ?? 0));
    return rows;
  }, [suppliers, showArchived, category, sort, needle, orderCount]);

  const archive = (s: SupplierView) => {
    dialog.ask({ title: t("Archiver ce fournisseur ?"), message: t("Les commandes existantes gardent son nom."), confirmLabel: t("Archiver"), danger: true }, () =>
      startTransition(async () => {
        const r = await archiveSupplierAction({ supplierId: s.id });
        feedback.show(r.ok ? (r.message ?? "Fournisseur archivé.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
      }),
    );
  };

  const remove = (s: SupplierView) => {
    dialog.ask({ title: t("Supprimer ce fournisseur ?"), message: t("Cette action est irréversible."), confirmLabel: t("Supprimer"), danger: true }, () =>
      startTransition(async () => {
        const r = await deleteSupplierAction({ supplierId: s.id });
        feedback.show(r.ok ? (r.message ?? "Fournisseur supprimé.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
      }),
    );
  };

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">{t("Rechercher un fournisseur")}</span>
          <SearchIcon width={16} height={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Rechercher un fournisseur")} className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pe-3 ps-9 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60" />
        </label>
        <select aria-label={t("Catégorie")} value={category} onChange={(e) => setCategory(e.target.value as SupplierCategory | "NONE" | "")} className={selectClass}>
          <option value="">{t("Toutes les catégories")}</option>
          {SUPPLIER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(SUPPLIER_CATEGORY_LABELS[c])}
            </option>
          ))}
          <option value="NONE">{t("Sans catégorie")}</option>
        </select>
        <select aria-label={t("Trier par")} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClass}>
          <option value="name">{t("Nom (A–Z)")}</option>
          <option value="leadTime">{t("Délai de livraison le plus court")}</option>
          <option value="orders">{t("Plus de commandes")}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-rose-gold" />
          {t("Afficher les archivés")}
        </label>
        {canManage ? (
          <button type="button" onClick={() => setModal({ supplier: null })} className="btn-shine ms-auto flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950">
            <PlusIcon width={16} height={16} /> {t("Ajouter un fournisseur")}
          </button>
        ) : (
          <p className="ms-auto text-xs text-white/45">{t("Consultation seule.")}</p>
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
              {s.category && <p className="mt-1 text-xs text-champagne/80">{t(SUPPLIER_CATEGORY_LABELS[s.category])}</p>}
              <ContactLines supplier={s} />
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
              {canManage && (
                <div className="mt-4 flex gap-4 text-xs">
                  {s.active && (
                    <button type="button" onClick={() => setModal({ supplier: s })} className="text-white/60 hover:text-white">
                      {t("Modifier")}
                    </button>
                  )}
                  {s.active && (
                    <button type="button" disabled={pending} onClick={() => archive(s)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                      {t("Archiver")}
                    </button>
                  )}
                  {(orderCount[s.id] ?? 0) === 0 && (
                    <button type="button" disabled={pending} onClick={() => remove(s)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                      {t("Supprimer")}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {modal && <SupplierModal supplier={modal.supplier} onClose={() => setModal(null)} onDone={(m) => feedback.show(m)} />}
      {feedback.node}
      {dialog.node}
    </div>
  );
}

// Coordonnées cliquables : le numéro ouvre WhatsApp Web (ou l'application) s'il est mobile ; un numéro fixe lance l'appel sur téléphone seulement ;
// l'adresse e-mail ouvre la messagerie.
// Rien n'est envoyé par l'application : c'est l'utilisateur qui écrit ou appelle (le fournisseur n'a pas accès à l'application).
function ContactLines({ supplier }: { supplier: SupplierView }) {
  const { t } = useI18n();
  const contact = supplierContact(supplier.phone, supplier.email);
  const link = "hover:text-white hover:underline";
  return (
    <ul className="mt-3 space-y-1.5 text-sm text-white/70">
      <li className="flex flex-wrap items-center gap-2">
        <PhoneIcon width={14} height={14} className="shrink-0 text-white/35" />
        {!supplier.phone ? (
          <span className="text-white/35">—</span>
        ) : contact.whatsapp ? (
          <>
            <a href={contact.whatsapp} target="_blank" rel="noreferrer" title={t("Écrire sur WhatsApp")} className={`tabular-nums ${link}`}>
              <bdi>{supplier.phone}</bdi>
            </a>
            <a href={contact.whatsapp} target="_blank" rel="noreferrer" className="rounded-full bg-[#25d366]/15 px-2 py-0.5 text-xs text-[#7ef0a8] transition hover:bg-[#25d366]/25">
              {t("WhatsApp")}
            </a>
          </>
        ) : contact.tel ? (
          <>
            {/* Écran tactile (téléphone) : le numéro lance l'appel. Ordinateur : simple texte, car un lien d'appel y ouvrirait une fenêtre de choix d'application. */}
            <bdi className="tabular-nums [@media(hover:none)]:hidden">{supplier.phone}</bdi>
            <a href={contact.tel} title={t("Appeler")} className={`hidden tabular-nums [@media(hover:none)]:inline ${link}`}>
              <bdi>{supplier.phone}</bdi>
            </a>
            <span className="text-xs text-white/40">{t("Numéro fixe : pas de WhatsApp")}</span>
          </>
        ) : (
          <bdi className="tabular-nums">{supplier.phone}</bdi>
        )}
      </li>
      <li className="flex items-center gap-2">
        <MailIcon width={14} height={14} className="shrink-0 text-white/35" />
        {!supplier.email ? (
          <span className="text-white/35">—</span>
        ) : contact.mailto ? (
          <a href={contact.mailto} title={t("Écrire un e-mail")} className={`truncate ${link}`}>
            <bdi>{supplier.email}</bdi>
          </a>
        ) : (
          <bdi className="truncate">{supplier.email}</bdi>
        )}
      </li>
    </ul>
  );
}

function SupplierModal({ supplier, onClose, onDone }: { supplier: SupplierView | null; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const [form, setForm] = useState({ name: supplier?.name ?? "", phone: supplier?.phone ?? "", email: supplier?.email ?? "", category: supplier?.category ?? "", leadTimeDays: String(supplier?.leadTimeDays ?? 0) });
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={t(supplier ? "Modifier le fournisseur" : "Ajouter un fournisseur")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = { name: form.name, phone: form.phone, email: form.email, category: form.category, leadTimeDays: form.leadTimeDays.trim() === "" ? undefined : Number(form.leadTimeDays) };
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
          <label className={labelClass} htmlFor={`${uid}-category`}>{t("Catégorie")} ({t("facultatif")})</label>
          <select id={`${uid}-category`} value={form.category} onChange={set("category")} className={`${selectClass} w-full`}>
            <option value="">{t("Sans catégorie")}</option>
            {SUPPLIER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(SUPPLIER_CATEGORY_LABELS[c])}
              </option>
            ))}
          </select>
          <FieldError errors={errors} name="category" />
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
