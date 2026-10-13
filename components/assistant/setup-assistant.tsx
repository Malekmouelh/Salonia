"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { applySetup, generateSetup } from "@/app/actions/assistant";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert } from "@/components/ui/form";
import { ClockIcon, PinIcon, PlusIcon, SparkleIcon, UsersIcon, WandIcon } from "@/components/ui/icons";
import type { SetupProposal } from "@/lib/ai/setup-schema";
import { GOVERNORATES } from "@/lib/definitions";

const EXAMPLES = [
  "Salon Yasmine : coiffure et onglerie à Tunis (Lac 2) et à Sousse, ouvert de 9h à 19h, fermé le dimanche.",
  "Institut Nour à Djerba et Sfax : soins visage, épilation, hammam et maquillage mariée, 10h-20h tous les jours.",
  "صالون ريم للحلاقة والتجميل في تونس وصفاقس، من 9 إلى 20، مغلق يوم الأحد",
];

const THINKING_STEPS = [
  "Lecture de votre description…",
  "Identification des villes et gouvernorats…",
  "Calcul des horaires d'ouverture…",
  "Préparation du catalogue de services…",
  "Composition de l'équipe type…",
];

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

export function SetupAssistant() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(generateSetup, undefined);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<SetupProposal | null>(null);

  // Nouvelle proposition reçue : elle devient le brouillon modifiable.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.proposal) setDraft(structuredClone(state.proposal));
  }

  if (draft && !pending) {
    return <ProposalEditor draft={draft} setDraft={setDraft} source={state?.source ?? "offline"} onRestart={() => setDraft(null)} />;
  }

  return (
    <form action={action} className="mx-auto max-w-3xl">
      <div className="glass glow-border relative rounded-[2rem] p-2 animate-fade-up">
        <textarea
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={1500}
          dir="auto"
          disabled={pending}
          placeholder={t("Ex. : Salon Yasmine, coiffure et onglerie à Tunis et Sousse, ouvert de 9h à 19h…")}
          className="block w-full resize-none rounded-[1.6rem] bg-transparent p-6 text-lg leading-relaxed text-white outline-none placeholder:text-white/30 disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
          <span className="text-xs text-white/35" dir="ltr">{description.length} / 1500</span>
          <GenerateButton />
        </div>
      </div>

      {state?.error && <div className="mt-4"><Alert>{t(state.error)}</Alert></div>}

      {pending ? (
        <ThinkingSteps />
      ) : (
        <div className="mt-8 animate-fade-up [animation-delay:0.2s]">
          <p className="mb-3 text-center text-xs uppercase tracking-[0.18em] text-white/35">{t("Essayez un exemple")}</p>
          <div className="stagger grid gap-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setDescription(ex)}
                dir="auto"
                className="glass rounded-2xl px-5 py-4 text-start text-sm text-white/70 transition duration-300 hover:-translate-y-0.5 hover:border-rose-gold/40 hover:text-white"
              >
                <SparkleIcon width={14} height={14} className="me-2 inline text-champagne" />
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}

function GenerateButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-shine flex h-12 items-center gap-2 rounded-2xl px-6 text-sm font-semibold text-plum-950 disabled:opacity-80">
      {pending ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-plum-950/30 border-t-plum-950" />
      ) : (
        <WandIcon width={18} height={18} />
      )}
      {t(pending ? "Génération…" : "Générer ma configuration")}
    </button>
  );
}

// Étapes animées pendant que l'IA travaille.
function ThinkingSteps() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-10 flex flex-col items-center gap-8 animate-fade-up">
      <div className="relative grid h-28 w-28 place-items-center">
        <span className="absolute inset-0 animate-spin-slow rounded-full bg-[conic-gradient(from_0deg,#f7c6d0,#c9a0dc,#f3d9a4,#f7c6d0)] opacity-80 blur-md" style={{ animationDuration: "3s" }} />
        <span className="absolute inset-2 rounded-full bg-plum-950" />
        <WandIcon width={36} height={36} className="relative animate-float text-champagne" />
      </div>
      <ol className="space-y-2.5">
        {THINKING_STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-3 text-sm transition-all duration-500 ${
              i < step ? "text-white/40" : i === step ? "text-white" : "text-white/15"
            }`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${i < step ? "bg-emerald-400/20 text-emerald-300" : i === step ? "bg-rose-gold/20 text-rose-gold" : "bg-white/5"}`}>
              {i < step ? "✓" : i === step ? <span className="h-1.5 w-1.5 animate-ping rounded-full bg-rose-gold" /> : ""}
            </span>
            {t(s)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProposalEditor({
  draft,
  setDraft,
  source,
  onRestart,
}: {
  draft: SetupProposal;
  setDraft: (p: SetupProposal) => void;
  source: "ai" | "offline";
  onRestart: () => void;
}) {
  const { t } = useI18n();
  const update = (fn: (p: SetupProposal) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };
  const input = "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-rose-gold/60";

  return (
    <form action={applySetup} className="space-y-6">
      <input type="hidden" name="proposal" value={JSON.stringify(draft)} />

      <div className="glass glow-border flex flex-wrap items-center gap-4 rounded-[2rem] p-6 animate-fade-up">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#c9a0dc] to-blush text-plum-950"><SparkleIcon /></span>
        <div className="min-w-0 flex-1">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${source === "ai" ? "bg-[#c9a0dc]/20 text-[#e6d0f0]" : "bg-amber-400/15 text-amber-200"}`}>
            {t(source === "ai" ? "Proposé par Claude (IA)" : "Mode hors ligne (sans IA)")}
          </span>
          <p className="mt-1.5 text-white" dir="auto">{draft.summary}</p>
        </div>
        <p className="w-full text-xs text-white/45 sm:w-auto">{t("L'IA propose, vous validez : tout est modifiable.")}</p>
      </div>

      {/* Centres et horaires */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-2xl text-white"><PinIcon /> {t("Centres")}</h2>
        <div className="stagger grid gap-4 md:grid-cols-2">
          {draft.centers.map((c, ci) => (
            <div key={ci} className="glass rounded-3xl p-5">
              <div className="flex gap-2">
                <input className={input} value={c.name} dir="auto" aria-label={t("Nom du centre")} onChange={(e) => update((p) => { p.centers[ci].name = e.target.value; })} />
                <button type="button" aria-label={t("Supprimer")} disabled={draft.centers.length === 1} onClick={() => update((p) => { p.centers.splice(ci, 1); })} className="rounded-xl px-3 text-white/40 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-30">✕</button>
              </div>
              <select className={`${input} mt-2`} value={c.governorate} aria-label={t("Gouvernorat")} onChange={(e) => update((p) => { p.centers[ci].governorate = e.target.value as typeof c.governorate; })}>
                {GOVERNORATES.map((g) => <option key={g.value} value={g.value}>{t(g.label)}</option>)}
              </select>
              <p className="mb-2 mt-4 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/40"><ClockIcon width={13} height={13} /> {t("Horaires d'ouverture")}</p>
              <div className="space-y-1.5">
                {DAYS.map((d) => {
                  const value = c.openingHours[d];
                  return (
                    <div key={d} className="flex items-center gap-2 text-sm">
                      <span className="w-20 capitalize text-white/60">{t(d)}</span>
                      <input
                        className={`${input} py-1.5 text-center disabled:opacity-30`}
                        dir="ltr"
                        value={value ?? ""}
                        placeholder={t("Fermé")}
                        disabled={value === null}
                        onChange={(e) => update((p) => { p.centers[ci].openingHours[d] = e.target.value; })}
                      />
                      <button
                        type="button"
                        onClick={() => update((p) => { p.centers[ci].openingHours[d] = value === null ? "09:00-19:00" : null; })}
                        className={`w-20 shrink-0 rounded-lg px-2 py-1.5 text-xs transition ${value === null ? "bg-white/5 text-white/40" : "bg-emerald-400/15 text-emerald-300"}`}
                      >
                        {t(value === null ? "Fermé" : "Ouvert")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Catalogue */}
      <section className="glass rounded-[2rem] p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-2xl text-white"><SparkleIcon /> {t("Catalogue de départ")}</h2>
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_8rem_6rem_6rem_2.5rem] gap-2 px-1 text-xs uppercase tracking-wider text-white/35 sm:grid">
            <span>{t("Service")}</span><span>{t("Catégorie")}</span><span>{t("Durée (min)")}</span><span>{t("Prix (DT)")}</span><span />
          </div>
          {draft.services.map((s, si) => (
            <div key={si} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_8rem_6rem_6rem_2.5rem]">
              <input className={`${input} col-span-2 sm:col-span-1`} value={s.name} dir="auto" aria-label={t("Service")} onChange={(e) => update((p) => { p.services[si].name = e.target.value; })} />
              <input className={input} value={s.category} dir="auto" aria-label={t("Catégorie")} onChange={(e) => update((p) => { p.services[si].category = e.target.value; })} />
              <input className={input} type="number" min={5} step={5} dir="ltr" value={s.durationMinutes} aria-label={t("Durée (min)")} onChange={(e) => update((p) => { p.services[si].durationMinutes = Number(e.target.value) || 0; })} />
              <input className={input} type="number" min={0} dir="ltr" value={s.priceTnd} aria-label={t("Prix (DT)")} onChange={(e) => update((p) => { p.services[si].priceTnd = Number(e.target.value) || 0; })} />
              <button type="button" aria-label={t("Supprimer")} onClick={() => update((p) => { p.services.splice(si, 1); })} className="rounded-xl text-white/40 hover:bg-red-400/10 hover:text-red-300">✕</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update((p) => { p.services.push({ name: "", category: "", durationMinutes: 30, priceTnd: 0 }); })}
            className="mt-2 inline-flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-2 text-sm text-white/60 transition hover:border-rose-gold/50 hover:text-white"
          >
            <PlusIcon width={16} height={16} /> {t("Ajouter un service")}
          </button>
        </div>
      </section>

      {/* Équipe type */}
      <section className="glass rounded-[2rem] p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-2xl text-white"><UsersIcon /> {t("Équipe suggérée")}</h2>
        <div className="flex flex-wrap gap-2">
          {draft.team.map((m, i) => (
            <span key={i} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80" dir="auto">
              <strong className="text-gradient">{m.count}×</strong> {m.title}
            </span>
          ))}
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex flex-wrap justify-end gap-3 rounded-3xl border border-white/10 bg-plum-950/80 p-3 backdrop-blur">
        <button type="button" onClick={onRestart} className="h-14 rounded-2xl border border-white/10 px-5 text-sm text-white/70 hover:text-white">
          {t("Recommencer")}
        </button>
        <ApplyButton />
      </div>
    </form>
  );
}

function ApplyButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-shine flex h-14 items-center gap-2 rounded-2xl px-7 text-[15px] font-semibold text-plum-950 disabled:opacity-80">
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-plum-950/30 border-t-plum-950" />}
      {t("Valider et créer mes centres")}
    </button>
  );
}
