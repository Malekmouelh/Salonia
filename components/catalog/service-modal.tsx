"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { PlusIcon, TrashIcon, ClockIcon, WalletIcon } from "@/components/ui/icons";
import { saveServiceAction } from "@/app/actions/catalog";
import type { ServiceDetail, ServiceOptionItem } from "@/lib/data/catalog";

interface ServiceModalProps {
  open: boolean;
  onClose: () => void;
  service: ServiceDetail | null;
  categories: string[];
  centers: { id: string; name: string }[];
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

export function ServiceModal({
  open,
  onClose,
  service,
  categories,
  centers,
  onSaved,
  onError,
}: ServiceModalProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [priceTnd, setPriceTnd] = useState(25);
  const [description, setDescription] = useState("");
  const [selectedCenterIds, setSelectedCenterIds] = useState<string[]>([]);
  const [centerPrices, setCenterPrices] = useState<{ centerId: string; priceTnd: number }[]>([]);
  const [options, setOptions] = useState<ServiceOptionItem[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [equipmentInput, setEquipmentInput] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    if (service) {
      setName(service.name);
      if (categories.includes(service.category)) {
        setCategory(service.category);
        setCustomCategory("");
      } else {
        setCategory("__NEW__");
        setCustomCategory(service.category);
      }
      setDurationMinutes(service.durationMinutes);
      setPriceTnd(service.priceTnd);
      setDescription(service.description ?? "");
      setSelectedCenterIds(service.centerIds ?? []);
      setCenterPrices(service.centerPrices ?? []);
      setOptions(service.options ? JSON.parse(JSON.stringify(service.options)) : []);
      setSkills(service.requiredSkills ?? []);
      setEquipment(service.requiredEquipment ?? []);
      setPhotos(service.photos ?? []);
    } else {
      setName("");
      setCategory(categories[0] ?? "");
      setCustomCategory("");
      setDurationMinutes(30);
      setPriceTnd(25);
      setDescription("");
      setSelectedCenterIds([]);
      setCenterPrices([]);
      setOptions([]);
      setSkills([]);
      setSkillInput("");
      setEquipment([]);
      setEquipmentInput("");
      setPhotos([]);
      setPhotoUrl("");
    }
  }, [service, categories, open]);

  // Options editor helpers
  const addOptionGroup = () => {
    setOptions([
      ...options,
      {
        name: "",
        values: [{ label: "Standard", extraPriceTnd: 0, extraDurationMinutes: 0 }],
      },
    ]);
  };

  const removeOptionGroup = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const updateGroupName = (idx: number, groupName: string) => {
    const copy = [...options];
    copy[idx].name = groupName;
    setOptions(copy);
  };

  const addOptionValue = (groupIdx: number) => {
    const copy = [...options];
    copy[groupIdx].values.push({ label: "", extraPriceTnd: 0, extraDurationMinutes: 0 });
    setOptions(copy);
  };

  const removeOptionValue = (groupIdx: number, valIdx: number) => {
    const copy = [...options];
    copy[groupIdx].values = copy[groupIdx].values.filter((_, i) => i !== valIdx);
    setOptions(copy);
  };

  const updateOptionValue = (
    groupIdx: number,
    valIdx: number,
    field: "label" | "extraPriceTnd" | "extraDurationMinutes",
    value: string | number,
  ) => {
    const copy = [...options];
    (copy[groupIdx].values[valIdx] as any)[field] = value;
    setOptions(copy);
  };

  // Center price overrides helper
  const handleCenterPriceChange = (centerId: string, val: number | string) => {
    const num = Number(val);
    const existingIdx = centerPrices.findIndex((cp) => cp.centerId === centerId);
    if (existingIdx >= 0) {
      if (isNaN(num) || num <= 0 || num === priceTnd) {
        // Supprime la surcharge si égale au prix de base
        setCenterPrices(centerPrices.filter((cp) => cp.centerId !== centerId));
      } else {
        const copy = [...centerPrices];
        copy[existingIdx].priceTnd = num;
        setCenterPrices(copy);
      }
    } else if (!isNaN(num) && num > 0 && num !== priceTnd) {
      setCenterPrices([...centerPrices, { centerId, priceTnd: num }]);
    }
  };

  const toggleCenterSelection = (centerId: string) => {
    if (selectedCenterIds.includes(centerId)) {
      setSelectedCenterIds(selectedCenterIds.filter((id) => id !== centerId));
    } else {
      setSelectedCenterIds([...selectedCenterIds, centerId]);
    }
  };

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
      setSkillInput("");
    }
  };

  const addEquipment = () => {
    const trimmed = equipmentInput.trim();
    if (trimmed && !equipment.includes(trimmed)) {
      setEquipment([...equipment, trimmed]);
      setEquipmentInput("");
    }
  };

  const addPhoto = () => {
    const trimmed = photoUrl.trim();
    if (trimmed && !photos.includes(trimmed)) {
      setPhotos([...photos, trimmed]);
      setPhotoUrl("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category === "__NEW__" ? customCategory.trim() : category.trim();
    if (!name.trim()) {
      onError("Veuillez renseigner le nom du service.");
      return;
    }
    if (!finalCategory) {
      onError("Veuillez spécifier une catégorie.");
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        name: name.trim(),
        category: finalCategory,
        durationMinutes: Number(durationMinutes),
        priceTnd: Number(priceTnd),
        description: description.trim(),
        centerIds: selectedCenterIds,
        centerPrices,
        options: options.filter((o) => o.name.trim().length > 0),
        requiredSkills: skills,
        requiredEquipment: equipment,
        photos,
      };

      if (service?.id) {
        payload.id = service.id;
      }

      const res = await saveServiceAction(payload);
      if (res.ok) {
        onSaved(res.message || "Enregistrement effectué.");
        onClose();
      } else {
        onError(res.message || "Erreur lors de l'enregistrement.");
      }
    } catch (err: any) {
      onError(err?.message || "Une erreur inattendue est survenue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={service ? "Modifier le service" : "Nouveau service"}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informations de base */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Nom du service *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Brushing Glamour, Soin Kératine..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 focus:border-rose-gold/60 focus:bg-white/10 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Catégorie *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-plum-950 px-4 py-2.5 text-sm text-white focus:border-rose-gold/60 focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__NEW__">+ Nouvelle catégorie...</option>
            </select>
            {category === "__NEW__" && (
              <input
                type="text"
                required
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Nom de la nouvelle catégorie"
                className="mt-2 w-full rounded-xl border border-rose-gold/30 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 focus:border-rose-gold focus:outline-none"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Durée de base (minutes) *
            </label>
            <div className="relative">
              <ClockIcon className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="number"
                min={5}
                step={5}
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pe-4 ps-11 text-sm text-white focus:border-rose-gold/60 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Prix de base (TND) *
            </label>
            <div className="relative">
              <WalletIcon className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="number"
                min={0}
                step={0.5}
                required
                value={priceTnd}
                onChange={(e) => setPriceTnd(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pe-4 ps-11 text-sm text-white focus:border-rose-gold/60 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Description & Médias */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
            Description détaillée (vitrine publique)
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Détails du soin, bienfaits, étapes, produits utilisés..."
            className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder-white/30 focus:border-rose-gold/60 focus:outline-none"
          />
        </div>

        {/* F2.2 Options et variantes */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Options & Variantes (F2.2)</h3>
              <p className="text-xs text-white/50">
                Ajoutez des choix comme la longueur de cheveux, type de produit, suppléments...
              </p>
            </div>
            <button
              type="button"
              onClick={addOptionGroup}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
            >
              <PlusIcon width={14} height={14} />
              Ajouter une option
            </button>
          </div>

          {options.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/40">
              Aucune variante ou option configurée pour ce service.
            </div>
          ) : (
            <div className="space-y-4">
              {options.map((grp, gIdx) => (
                <div key={gIdx} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Nom du groupe (ex: Longueur, Gamme de soin)"
                      value={grp.name}
                      onChange={(e) => updateGroupName(gIdx, e.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-white/30 focus:border-rose-gold/50 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeOptionGroup(gIdx)}
                      className="rounded-lg p-1.5 text-white/40 transition hover:bg-red-500/10 hover:text-red-300"
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </div>

                  <div className="space-y-2 ps-2">
                    {grp.values.map((v, vIdx) => (
                      <div key={vIdx} className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Libellé (ex: Court, Long)"
                          value={v.label}
                          onChange={(e) => updateOptionValue(gIdx, vIdx, "label", e.target.value)}
                          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white placeholder-white/30 focus:outline-none"
                        />
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-white/40">+ DT</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={v.extraPriceTnd}
                            onChange={(e) =>
                              updateOptionValue(gIdx, vIdx, "extraPriceTnd", Number(e.target.value))
                            }
                            className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-white/40">+ Min</span>
                          <input
                            type="number"
                            min={0}
                            step={5}
                            value={v.extraDurationMinutes}
                            onChange={(e) =>
                              updateOptionValue(gIdx, vIdx, "extraDurationMinutes", Number(e.target.value))
                            }
                            className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white focus:outline-none"
                          />
                        </div>
                        {grp.values.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeOptionValue(gIdx, vIdx)}
                            className="p-1 text-white/40 hover:text-red-400"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addOptionValue(gIdx)}
                      className="mt-1 text-xs text-rose-gold/80 hover:text-rose-gold"
                    >
                      + Ajouter une valeur
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* F2.4 Tarifs et disponibilité par centre (si multi-centres) */}
        {centers.length > 1 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-1 text-sm font-semibold text-white">Tarifs et Disponibilité par centre (F2.4)</h3>
            <p className="mb-3 text-xs text-white/50">
              Définissez un prix personnalisé par centre si nécessaire (le prix global de {priceTnd} DT s'applique par défaut).
            </p>

            <div className="divide-y divide-white/5">
              {centers.map((c) => {
                const isOffered = selectedCenterIds.length === 0 || selectedCenterIds.includes(c.id);
                const currentCenterPrice = centerPrices.find((cp) => cp.centerId === c.id)?.priceTnd;

                return (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <label className="flex items-center gap-2 text-xs text-white">
                      <input
                        type="checkbox"
                        checked={isOffered}
                        onChange={() => toggleCenterSelection(c.id)}
                        className="rounded border-white/20 bg-white/10 text-rose-gold focus:ring-0"
                      />
                      <span>{c.name}</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/40">Tarif centre :</span>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder={String(priceTnd)}
                        value={currentCenterPrice !== undefined ? currentCenterPrice : ""}
                        onChange={(e) => handleCenterPriceChange(c.id, e.target.value)}
                        className="w-24 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white focus:border-rose-gold/50 focus:outline-none"
                      />
                      <span className="text-xs text-white/50">DT</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* F2.6 Compétences & Matériel */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Compétences staff requises (F2.6)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill();
                  }
                }}
                placeholder="Ex: Coloriste, Coiffure mariée"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={addSkill}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
              >
                +
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {skills.map((s, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => setSkills(skills.filter((_, i) => i !== idx))}
                    className="text-white/40 hover:text-white"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Matériel requis (F2.6)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={equipmentInput}
                onChange={(e) => setEquipmentInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEquipment();
                  }
                }}
                placeholder="Ex: Bac shampoing, Casque chauffant"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={addEquipment}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
              >
                +
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {equipment.map((eq, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full bg-champagne/15 px-2.5 py-0.5 text-[11px] text-champagne"
                >
                  {eq}
                  <button
                    type="button"
                    onClick={() => setEquipment(equipment.filter((_, i) => i !== idx))}
                    className="text-white/40 hover:text-white"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Photos URLs */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
            Photos du service (URL)
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://images.unsplash.com/photo-..."
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-rose-gold/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={addPhoto}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15"
            >
              Ajouter
            </button>
          </div>
          {photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((p, idx) => (
                <div key={idx} className="group relative h-16 w-16 overflow-hidden rounded-xl border border-white/10">
                  <img src={p} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, i) => i !== idx))}
                    className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition group-hover:opacity-100 text-white text-xs font-bold"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Boutons d'action */}
        <div className="flex justify-end gap-3 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-gradient-to-r from-blush to-champagne px-6 py-2 text-sm font-semibold text-plum-950 shadow-lg shadow-blush/20 transition hover:opacity-95 disabled:opacity-50"
          >
            {loading ? "Enregistrement..." : service ? "Enregistrer" : "Créer le service"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
