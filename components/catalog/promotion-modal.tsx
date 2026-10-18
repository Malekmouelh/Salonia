"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { savePromotionAction } from "@/app/actions/catalog";
import type { ServiceDetail, PackDetail } from "@/lib/data/catalog";

interface PromotionModalProps {
  open: boolean;
  onClose: () => void;
  services: ServiceDetail[];
  packs: PackDetail[];
  centers: { id: string; name: string }[];
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

export function PromotionModal({
  open,
  onClose,
  services,
  packs,
  centers,
  onSaved,
  onError,
}: PromotionModalProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<"PERCENTAGE" | "FIXED_AMOUNT">("PERCENTAGE");
  const [value, setValue] = useState<number>(20);
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [maxUses, setMaxUses] = useState<string>("");
  const [targetType, setTargetType] = useState<"ALL" | "CUSTOM">("ALL");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [selectedCenterIds, setSelectedCenterIds] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onError("Veuillez renseigner le nom de la promotion.");
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        name: name.trim(),
        code: code.trim().toUpperCase() || undefined,
        type,
        value: Number(value),
        startsAt: new Date(startsAt),
        endsAt: new Date(`${endsAt}T23:59:59`),
        maxUses: maxUses ? Number(maxUses) : null,
        active: true,
        serviceIds: targetType === "ALL" ? [] : selectedServiceIds,
        packIds: targetType === "ALL" ? [] : selectedPackIds,
        centerIds: selectedCenterIds,
      };

      const res = await savePromotionAction(payload);
      if (res.ok) {
        onSaved(res.message || "Promotion créée.");
        onClose();
      } else {
        onError(res.message || "Erreur lors de la création.");
      }
    } catch (err: any) {
      onError(err?.message || "Une erreur inattendue est survenue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Créer une promotion ou code promo (F2.7)">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Nom de l'offre *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Offre Spéciale Printemps, Bienvenue..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 focus:border-rose-gold/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Code promo (optionnel)
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: PRINTEMPS25, SALONIA10"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm uppercase text-white placeholder-white/30 focus:border-rose-gold/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Type de réduction *
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full rounded-xl border border-white/10 bg-plum-950 px-4 py-2.5 text-sm text-white focus:outline-none"
            >
              <option value="PERCENTAGE">Pourcentage (%)</option>
              <option value="FIXED_AMOUNT">Montant fixe (DT)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Valeur de la réduction ({type === "PERCENTAGE" ? "%" : "DT"}) *
            </label>
            <input
              type="number"
              min={1}
              step={1}
              required
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Date de début *
            </label>
            <input
              type="date"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/70">
              Date de fin *
            </label>
            <input
              type="date"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white focus:outline-none"
            />
          </div>
        </div>

        {/* Cibles */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/70">
            Applicable sur :
          </label>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-2 text-xs text-white">
              <input
                type="radio"
                name="targetType"
                checked={targetType === "ALL"}
                onChange={() => setTargetType("ALL")}
                className="text-rose-gold focus:ring-0"
              />
              Tout le catalogue
            </label>
            <label className="flex items-center gap-2 text-xs text-white">
              <input
                type="radio"
                name="targetType"
                checked={targetType === "CUSTOM"}
                onChange={() => setTargetType("CUSTOM")}
                className="text-rose-gold focus:ring-0"
              />
              Services ou packs spécifiques
            </label>
          </div>

          {targetType === "CUSTOM" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-white/5">
              <div>
                <div className="text-xs font-medium text-white/60 mb-1">Services ciblés</div>
                <div className="max-h-32 overflow-y-auto space-y-1 rounded-xl bg-white/5 p-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-white">
                      <input
                        type="checkbox"
                        checked={selectedServiceIds.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedServiceIds([...selectedServiceIds, s.id]);
                          else setSelectedServiceIds(selectedServiceIds.filter((id) => id !== s.id));
                        }}
                        className="rounded border-white/20 bg-white/10 text-rose-gold focus:ring-0"
                      />
                      <span>{s.name} ({s.priceTnd} DT)</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-white/60 mb-1">Packs ciblés</div>
                <div className="max-h-32 overflow-y-auto space-y-1 rounded-xl bg-white/5 p-2">
                  {packs.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-xs text-white">
                      <input
                        type="checkbox"
                        checked={selectedPackIds.includes(p.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedPackIds([...selectedPackIds, p.id]);
                          else setSelectedPackIds(selectedPackIds.filter((id) => id !== p.id));
                        }}
                        className="rounded border-white/20 bg-white/10 text-rose-gold focus:ring-0"
                      />
                      <span>{p.name} ({p.priceTnd} DT)</span>
                    </label>
                  ))}
                </div>
              </div>
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
            {loading ? "Création..." : "Créer la promotion"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
