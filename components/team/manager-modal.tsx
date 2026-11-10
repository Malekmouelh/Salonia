"use client";

import { useId, useState, useTransition } from "react";
import { deactivateManagerAction, updateManagerAction } from "@/app/actions/team";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60 focus:bg-white/[0.08]";
const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/45";

type Errors = Record<string, string[] | undefined>;

// F4 — Modifier un gérant (propriétaire seulement) : nom et centres d'affectation (un ou plusieurs).
// Monté seulement quand il est ouvert : le formulaire repart des valeurs de la carte à chaque ouverture.
export function ManagerModal({
  manager,
  centers,
  onClose,
  onSaved,
}: {
  manager: { id: string; firstName: string; lastName: string; centers: { id: string; name: string }[] };
  centers: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState(manager.firstName);
  const [lastName, setLastName] = useState(manager.lastName);
  const [centerIds, setCenterIds] = useState<string[]>(manager.centers.map((c) => c.id));
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);

  const toggleCenter = (id: string) => setCenterIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateManagerAction(manager.id, { firstName, lastName, centerIds });
      if (r.ok) {
        onSaved(r.message ?? "Gérant modifié.");
        onClose();
      } else {
        setErrors(r.errors ?? {});
        setMessage(r.message ?? null);
      }
    });
  };

  const fieldError = (key: string) =>
    errors[key]?.[0] ? (
      <p id={`${uid}-${key}-error`} role="alert" className="mt-1 text-xs text-red-300">
        {t(errors[key]![0])}
      </p>
    ) : null;
  const describe = (key: string) => (errors[key]?.[0] ? { "aria-invalid": true, "aria-describedby": `${uid}-${key}-error` } : {});

  return (
    <Modal open onClose={onClose} title={t("Modifier le gérant")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {message && (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t(message)}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>{t("Prénom")}</span>
            <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" {...describe("firstName")} />
            {fieldError("firstName")}
          </label>
          <label>
            <span className={labelClass}>{t("Nom")}</span>
            <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" {...describe("lastName")} />
            {fieldError("lastName")}
          </label>
        </div>

        <fieldset>
          <legend className={labelClass}>{t("Centres d'affectation")}</legend>
          <div className="space-y-1.5">
            {centers.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white/80 has-[:checked]:border-rose-gold/50 has-[:checked]:bg-white/[0.08]">
                <input type="checkbox" className="h-4 w-4 accent-[#e8b4a0]" checked={centerIds.includes(c.id)} onChange={() => toggleCenter(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-white/40">{t("Le gérant gère uniquement les centres cochés.")}</p>
          {fieldError("centerIds")}
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Annuler")}</button>
          <button type="submit" disabled={pending} className="btn-shine rounded-xl px-5 py-2.5 text-sm font-semibold text-plum-950 disabled:cursor-wait disabled:opacity-70">
            {pending ? t("Un instant…") : t("Enregistrer")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// F4 — Confirmation avant de désactiver un gérant (aucune donnée n'est supprimée).
export function DeactivateManagerModal({
  manager,
  onClose,
  onDone,
}: {
  manager: { id: string; firstName: string; lastName: string };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const confirm = () =>
    startTransition(async () => {
      const r = await deactivateManagerAction(manager.id);
      if (r.ok) {
        onDone(r.message ?? "Gérant désactivé.");
        onClose();
      } else {
        setMessage(r.message ?? "Impossible de désactiver le compte. Réessayez.");
      }
    });

  return (
    <Modal open onClose={onClose} title={t("Désactiver ce gérant ?")}>
      <div className="space-y-4">
        {message && (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t(message)}
          </p>
        )}
        <p className="text-sm text-white/75">
          <span className="font-medium text-white">{manager.firstName} {manager.lastName}</span>{" "}
          {t("ne pourra plus se connecter et disparaîtra de la liste. Aucune donnée n'est supprimée.")}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Annuler")}</button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded-xl border border-red-400/40 bg-red-500/15 px-5 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? t("Un instant…") : t("Désactiver")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
