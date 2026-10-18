"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createCenter } from "@/app/actions/centers";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, Field, SubmitButton } from "@/components/ui/form";
import { PinIcon, PlusIcon, StoreIcon } from "@/components/ui/icons";
import { ImageUploader } from "@/components/ui/image-uploader";
import { GOVERNORATES } from "@/lib/definitions";

// Carte « + Ajouter un centre » qui se retourne en formulaire.
export function AddCenter() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [state, action, pending] = useActionState(createCenter, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Referme la carte après un ajout réussi (synchronisation avec le formulaire DOM).
  useEffect(() => {
    if (!state?.success) return;
    formRef.current?.reset();
    const id = setTimeout(() => {
      setPhotos([]);
      setOpen(false);
    }, 900);
    return () => clearTimeout(id);
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group grid min-h-44 place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-white/50 transition duration-300 hover:-translate-y-1 hover:border-rose-gold/50 hover:bg-rose-gold/5 hover:text-white"
      >
        <span className="flex flex-col items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 transition duration-500 group-hover:rotate-90 group-hover:border-rose-gold/50 group-hover:text-rose-gold">
            <PlusIcon />
          </span>
          <span className="text-sm font-medium">{t("Ajouter un centre")}</span>
        </span>
      </button>
    );
  }

  return (
    <form ref={formRef} action={action} className="glass space-y-4 rounded-3xl p-5 animate-fade-up" noValidate>
      {state?.success && <Alert tone="success">{t(state.success)}</Alert>}
      {state?.message && <Alert>{t(state.message)}</Alert>}
      <Field label="Nom du centre" name="name" icon={StoreIcon} error={state?.errors?.name} autoFocus />
      <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] focus-within:border-rose-gold/70">
        <PinIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-white/40" />
        <select name="governorate" defaultValue="" aria-label={t("Gouvernorat")} className="block w-full appearance-none bg-transparent py-4 ps-12 pe-4 text-[15px] text-white outline-none">
          <option value="" disabled>{t("Gouvernorat")}</option>
          {GOVERNORATES.map((g) => (
            <option key={g.value} value={g.value}>{t(g.label)}</option>
          ))}
        </select>
      </div>
      {state?.errors?.governorate && <p className="ps-1 text-[13px] text-red-300">{t(state.errors.governorate[0])}</p>}

      {/* Upload des photos du centre */}
      <input type="hidden" name="photos" value={JSON.stringify(photos)} />
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <ImageUploader
          label="Photos du centre"
          hint="Glissez ou sélectionnez les photos du centre (façade, intérieur, cabines...)"
          photos={photos}
          onChange={setPhotos}
          maxPhotos={6}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPhotos([]);
          }}
          className="h-14 rounded-2xl border border-white/10 px-4 text-sm text-white/60 hover:text-white"
        >
          {t("Annuler")}
        </button>
        <SubmitButton pending={pending}>{t("Ajouter")}</SubmitButton>
      </div>
    </form>
  );
}

