"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { SparkleIcon, WalletIcon, ClockIcon } from "@/components/ui/icons";
import { ImageUploader } from "@/components/ui/image-uploader";
import { savePackAction } from "@/app/actions/catalog";
import type { PackDetail, ServiceDetail } from "@/lib/data/catalog";

interface PackModalProps {
  open: boolean;
  onClose: () => void;
  pack: PackDetail | null;
  availableServices: ServiceDetail[];
  centers: { id: string; name: string }[];
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

export function PackModal({
  open,
  onClose,
  pack,
  availableServices,
  centers,
  onSaved,
  onError,
}: PackModalProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [priceTnd, setPriceTnd] = useState(60);
  const [selectedCenterIds, setSelectedCenterIds] = useState<string[]>([]);
  const [centerPrices, setCenterPrices] = useState<{ centerId: string; priceTnd: number }[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);

  // Réinitialise le formulaire à l'ouverture ou au changement de pack (ajustement d'état pendant le rendu).
  const [synced, setSynced] = useState<{ open: boolean; pack: typeof pack } | null>(null);
  if (!synced || synced.open !== open || synced.pack !== pack) {
    setSynced({ open, pack });
    if (pack) {
      setName(pack.name);
      setDescription(pack.description ?? "");
      setSelectedServiceIds(pack.serviceIds ?? []);
      setPriceTnd(pack.priceTnd);
      setSelectedCenterIds(pack.centerIds ?? []);
      setCenterPrices(pack.centerPrices ?? []);
      setPhotos(pack.photos ?? []);
    } else {
      setName("");
      setDescription("");
      setSelectedServiceIds([]);
      setPriceTnd(60);
      setSelectedCenterIds([]);
      setCenterPrices([]);
      setPhotos([]);
    }
  }

  // Calculs en temps réel
  const selectedServices = availableServices.filter((s) => selectedServiceIds.includes(s.id));
  const regularTotalTnd = selectedServices.reduce((sum, s) => sum + s.priceTnd, 0);
  const totalMinutes = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  const savingsTnd = Math.max(0, regularTotalTnd - priceTnd);
  const savingsPct = regularTotalTnd > 0 ? Math.round((savingsTnd / regularTotalTnd) * 100) : 0;

  const toggleService = (id: string) => {
    if (selectedServiceIds.includes(id)) {
      setSelectedServiceIds(selectedServiceIds.filter((sid) => sid !== id));
    } else {
      setSelectedServiceIds([...selectedServiceIds, id]);
    }
  };

  const applySuggestedDiscount = (pct: number) => {
    if (regularTotalTnd <= 0) return;
    const discounted = Math.round(regularTotalTnd * (1 - pct / 100));
    setPriceTnd(discounted);
  };

  const handleCenterPriceChange = (centerId: string, val: number | string) => {
    const num = Number(val);
    const existingIdx = centerPrices.findIndex((cp) => cp.centerId === centerId);
    if (existingIdx >= 0) {
      if (isNaN(num) || num <= 0 || num === priceTnd) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onError("Veuillez renseigner le nom du pack.");
      return;
    }
    if (selectedServiceIds.length === 0) {
      onError("Veuillez sélectionner au moins un service pour composer le pack.");
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        serviceIds: selectedServiceIds,
        priceTnd: Number(priceTnd),
        centerIds: selectedCenterIds,
        centerPrices,
        photos,
      };

      if (pack?.id) {
        payload.id = pack.id;
      }

      const res = await savePackAction(payload);
      if (res.ok) {
        onSaved(res.message || "Pack enregistré.");
        onClose();
      } else {
        onError(res.message || "Erreur lors de l'enregistrement du pack.");
      }
    } catch (err) {
      onError((err instanceof Error ? err.message : "") || "Une erreur inattendue est survenue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={pack ? "Modifier le pack" : "Créer un nouveau pack"}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
            Nom du pack *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Forfait Mariée Reine, Pack Beauté Express..."
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 focus:border-rose-gold/60 focus:bg-white/10 focus:outline-none"
          />
        </div>

        {/* Sélection des services */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-white/70">
              Services inclus dans le pack ({selectedServiceIds.length}) *
            </label>
            <span className="text-xs text-white/40">Cochez les prestations à combiner</span>
          </div>

          <div className="max-h-48 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-2 divide-y divide-white/5 [scrollbar-width:thin]">
            {availableServices.map((s) => {
              const checked = selectedServiceIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center justify-between p-2.5 rounded-xl transition ${
                    checked ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleService(s.id)}
                      className="rounded border-white/20 bg-white/10 text-rose-gold focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-medium text-white">{s.name}</div>
                      <div className="text-[11px] text-white/40">{s.category} · {s.durationMinutes} min</div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-champagne">{s.priceTnd} DT</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Tarification & Économie calculée */}
        <div className="rounded-2xl border border-rose-gold/20 bg-rose-gold/[0.03] p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-white/50">Total tarifs normaux</div>
              <div className="font-display text-xl text-white">{regularTotalTnd} DT</div>
              <div className="text-[11px] text-white/40">Durée totale : {totalMinutes} min</div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-rose-gold">
                Prix promotionnel du pack *
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={priceTnd}
                  onChange={(e) => setPriceTnd(Number(e.target.value))}
                  className="w-full rounded-xl border border-rose-gold/40 bg-white/10 px-3 py-2 text-base font-bold text-white focus:outline-none"
                />
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-white/60">
                  DT
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs text-white/50">Économie client</div>
              {savingsTnd > 0 ? (
                <div>
                  <span className="inline-block rounded-lg bg-emerald-500/20 px-2 py-0.5 text-sm font-bold text-emerald-400">
                    -{savingsPct}% ({savingsTnd} DT)
                  </span>
                  <div className="mt-1 text-[11px] text-emerald-300/70">Pack très attractif</div>
                </div>
              ) : (
                <div className="text-xs text-white/40">Aucune réduction appliquée</div>
              )}
            </div>
          </div>

          {/* Raccourcis de réduction */}
          {regularTotalTnd > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-xs">
              <span className="text-white/50">Appliquer une remise rapide :</span>
              {[10, 15, 20, 25].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => applySuggestedDiscount(pct)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10"
                >
                  -{pct}%
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
            Description du forfait
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ce pack comprend les prestations idéales pour une mise en beauté complète..."
            className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder-white/30 focus:border-rose-gold/60 focus:outline-none"
          />
        </div>

        {/* Disponibilité et Tarifs par centre si multi-centres */}
        {centers.length > 1 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-1 text-sm font-semibold text-white">Disponibilité par centre (F2.4)</h3>
            <p className="mb-3 text-xs text-white/50">
              Choisissez où proposer ce pack et ajustez le prix spécifique par centre si souhaité.
            </p>

            <div className="divide-y divide-white/5">
              {centers.map((c) => {
                const isOffered = selectedCenterIds.length === 0 || selectedCenterIds.includes(c.id);
                const currentCenterPrice = centerPrices.find((cp) => cp.centerId === c.id)?.priceTnd;

                return (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
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
                        step={1}
                        placeholder={String(priceTnd)}
                        value={currentCenterPrice !== undefined ? currentCenterPrice : ""}
                        onChange={(e) => handleCenterPriceChange(c.id, e.target.value)}
                        className="w-24 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white focus:outline-none"
                      />
                      <span className="text-xs text-white/50">DT</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Photos Upload (F2.3) */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <ImageUploader
            label="Photos du pack"
            hint="Téléversez ou glissez les visuels mettant en avant la formule pack / rituel beauté."
            photos={photos}
            onChange={setPhotos}
            maxPhotos={6}
          />
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
            {loading ? "Enregistrement..." : pack ? "Enregistrer" : "Créer le pack"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
