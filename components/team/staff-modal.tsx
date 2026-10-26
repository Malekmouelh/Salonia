"use client";

import { useId, useState, useTransition } from "react";
import { createStaffAction } from "@/app/actions/team";
import { useI18n } from "@/components/i18n/i18n-provider";
import { EyeIcon, EyeOffIcon, PlusIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { MAX_SKILLS, cleanSkill, normalizeSkills } from "@/lib/team/skills";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60 focus:bg-white/[0.08]";
const labelClass = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/45";

type Errors = Record<string, string[] | undefined>;

// F4 — Ajouter un membre du personnel (compte STAFF avec mot de passe temporaire).
// Monté seulement quand il est ouvert : le formulaire, et surtout le mot de passe saisi, sont oubliés à la fermeture.
export function StaffModal({
  centers,
  defaultCenterId,
  suggestions,
  onClose,
  onCreated,
}: {
  centers: { id: string; name: string }[];
  defaultCenterId: string | null;
  suggestions: string[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", jobTitle: "" });
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [centerIds, setCenterIds] = useState<string[]>(defaultCenterId ? [defaultCenterId] : centers.length === 1 ? [centers[0].id] : []);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const addSkill = () => {
    if (!skillInput.trim()) return;
    setSkills((s) => normalizeSkills([...s, skillInput]).slice(0, MAX_SKILLS));
    setSkillInput("");
  };
  const toggleCenter = (id: string) => setCenterIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Une compétence tapée mais pas encore validée est incluse.
    const allSkills = skillInput.trim() ? normalizeSkills([...skills, skillInput]) : skills;
    startTransition(async () => {
      const r = await createStaffAction({ ...form, skills: allSkills, centerIds });
      if (r.ok) {
        onCreated(r.message ?? "Membre du personnel ajouté.");
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
  const datalistId = `${uid}-skills`;

  return (
    <Modal open onClose={onClose} title={t("Ajouter un membre")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {message && (
          <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t(message)}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>{t("Prénom")}</span>
            <input className={inputClass} value={form.firstName} onChange={set("firstName")} autoComplete="off" {...describe("firstName")} />
            {fieldError("firstName")}
          </label>
          <label>
            <span className={labelClass}>{t("Nom")}</span>
            <input className={inputClass} value={form.lastName} onChange={set("lastName")} autoComplete="off" {...describe("lastName")} />
            {fieldError("lastName")}
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelClass}>{t("E-mail")}</span>
            <input className={inputClass} type="email" dir="ltr" value={form.email} onChange={set("email")} autoComplete="off" {...describe("email")} />
            {fieldError("email")}
          </label>
          <label>
            <span className={labelClass}>{t("Téléphone")}</span>
            <input className={inputClass} type="tel" dir="ltr" value={form.phone} onChange={set("phone")} autoComplete="off" {...describe("phone")} />
            {fieldError("phone")}
          </label>
        </div>
        <p className="-mt-2 text-xs text-white/40">{t("Au moins un des deux : il sert d'identifiant de connexion.")}</p>

        <div>
          <label htmlFor={`${uid}-password`} className={labelClass}>{t("Mot de passe temporaire")}</label>
          <div className="relative">
            <input
              id={`${uid}-password`}
              className={`${inputClass} pe-11`}
              type={showPassword ? "text" : "password"}
              dir="ltr"
              value={form.password}
              onChange={set("password")}
              autoComplete="new-password"
              {...describe("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={t(showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe")}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              {showPassword ? <EyeOffIcon width={18} height={18} /> : <EyeIcon width={18} height={18} />}
            </button>
          </div>
          {fieldError("password")}
          <p className="mt-1 text-xs text-white/40">
            {t("8 caractères minimum, avec lettres et chiffres.")} {t("Communiquez-le vous-même au membre du personnel.")}
          </p>
        </div>

        <label className="block">
          <span className={labelClass}>{t("Poste")}</span>
          <input className={inputClass} value={form.jobTitle} onChange={set("jobTitle")} autoComplete="off" {...describe("jobTitle")} />
          {fieldError("jobTitle")}
        </label>

        <div>
          <label htmlFor={`${uid}-skill`} className={labelClass}>{t("Compétences")}</label>
          <div className="flex gap-2">
            <input
              id={`${uid}-skill`}
              className={inputClass}
              list={datalistId}
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              autoComplete="off"
            />
            <button type="button" onClick={addSkill} aria-label={t("Ajouter")} className="grid w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-white/70 hover:bg-white/10 hover:text-white">
              <PlusIcon width={16} height={16} />
            </button>
          </div>
          <datalist id={datalistId}>
            {suggestions.filter((s) => !skills.some((k) => cleanSkill(k).toLowerCase() === s.toLowerCase())).map((s) => <option key={s} value={s} />)}
          </datalist>
          {skills.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <li key={s} className="flex items-center gap-1.5 rounded-full bg-white/10 py-0.5 ps-2.5 pe-1 text-xs text-white/80">
                  {s}
                  <button type="button" onClick={() => setSkills((l) => l.filter((x) => x !== s))} aria-label={`${t("Supprimer")} ${s}`} className="grid h-5 w-5 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">✕</button>
                </li>
              ))}
            </ul>
          )}
          {fieldError("skills")}
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
          {fieldError("centerIds")}
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5">{t("Annuler")}</button>
          <button type="submit" disabled={pending} className="btn-shine rounded-xl px-5 py-2.5 text-sm font-semibold text-plum-950 disabled:cursor-wait disabled:opacity-70">
            {pending ? t("Un instant…") : t("Ajouter le membre")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
