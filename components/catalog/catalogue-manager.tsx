"use client";

import { useState, useTransition } from "react";
import { useI18n, T } from "@/components/i18n/i18n-provider";
import {
  SparkleIcon,
  PlusIcon,
  ClockIcon,
  WalletIcon,
  SearchIcon,
  EditIcon,
  CopyIcon,
  TrashIcon,
  TagIcon,
  CheckIcon,
} from "@/components/ui/icons";
import { Toast } from "@/components/ui/modal";
import {
  toggleServiceAction,
  deleteServiceAction,
  duplicateServiceAction,
  togglePackAction,
  deletePackAction,
  duplicatePackAction,
  togglePromotionAction,
  deletePromotionAction,
  importCatalogDraftAction,
} from "@/app/actions/catalog";
import { ServiceModal } from "./service-modal";
import { PackModal } from "./pack-modal";
import { PromotionModal } from "./promotion-modal";
import type { ServiceDetail, PackDetail, PromotionDetail } from "@/lib/data/catalog";

interface CatalogueManagerProps {
  initialServices: ServiceDetail[];
  initialPacks: PackDetail[];
  initialPromotions: PromotionDetail[];
  categories: string[];
  centers: { id: string; name: string }[];
  canManage: boolean;
  hasCatalogDraft?: boolean;
}

export function CatalogueManager({
  initialServices,
  initialPacks,
  initialPromotions,
  categories,
  centers,
  canManage,
  hasCatalogDraft = false,
}: CatalogueManagerProps) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"services" | "packs" | "promotions">("services");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedCenter, setSelectedCenter] = useState<string>("ALL");
  const [onlyActive, setOnlyActive] = useState<boolean>(false);

  // Modals state
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceDetail | null>(null);

  const [packModalOpen, setPackModalOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<PackDetail | null>(null);

  const [promotionModalOpen, setPromotionModalOpen] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const showSuccess = (msg: string) => setToast({ tone: "success", message: msg });
  const showError = (msg: string) => setToast({ tone: "error", message: msg });

  // Import brouillon IA
  const [importingDraft, setImportingDraft] = useState(false);
  const [draftDismissed, setDraftDismissed] = useState(false);

  const handleImportDraft = async () => {
    setImportingDraft(true);
    try {
      const res = await importCatalogDraftAction();
      if (res.ok) {
        showSuccess(res.message ?? "Brouillon importé avec succès.");
        setDraftDismissed(true);
        // Reload to show new services
        window.location.reload();
      } else {
        showError(res.message ?? "Erreur lors de l'import.");
        setDraftDismissed(true);
      }
    } finally {
      setImportingDraft(false);
    }
  };

  // Filtering services
  const filteredServices = initialServices.filter((s) => {
    if (onlyActive && !s.active) return false;
    if (selectedCategory !== "ALL" && s.category !== selectedCategory) return false;
    if (selectedCenter !== "ALL" && s.centerIds.length > 0 && !s.centerIds.includes(selectedCenter)) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = s.name.toLowerCase().includes(q);
      const matchCat = s.category.toLowerCase().includes(q);
      const matchDesc = (s.description || "").toLowerCase().includes(q);
      if (!matchName && !matchCat && !matchDesc) return false;
    }
    return true;
  });

  // Filtering packs
  const filteredPacks = initialPacks.filter((p) => {
    if (onlyActive && !p.active) return false;
    if (selectedCenter !== "ALL" && p.centerIds.length > 0 && !p.centerIds.includes(selectedCenter)) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchDesc = (p.description || "").toLowerCase().includes(q);
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  // Filtering promotions
  const filteredPromotions = initialPromotions.filter((pr) => {
    if (onlyActive && !pr.active) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = pr.name.toLowerCase().includes(q);
      const matchCode = (pr.code || "").toLowerCase().includes(q);
      if (!matchName && !matchCode) return false;
    }
    return true;
  });

  // Quick action handlers
  const handleToggleService = (id: string) => {
    startTransition(async () => {
      const res = await toggleServiceAction(id);
      if (res.ok) showSuccess(res.message || "Statut mis à jour.");
      else showError(res.message || "Erreur.");
    });
  };

  const handleDuplicateService = (id: string) => {
    startTransition(async () => {
      const res = await duplicateServiceAction(id);
      if (res.ok) showSuccess("Service dupliqué avec succès.");
      else showError(res.message || "Erreur lors de la duplication.");
    });
  };

  const handleDeleteService = (id: string, name: string) => {
    if (!confirm(`Supprimer définitivement le service "${name}" ?`)) return;
    startTransition(async () => {
      const res = await deleteServiceAction(id);
      if (res.ok) showSuccess("Service supprimé.");
      else showError(res.message || "Impossible de supprimer le service.");
    });
  };

  const handleTogglePack = (id: string) => {
    startTransition(async () => {
      const res = await togglePackAction(id);
      if (res.ok) showSuccess(res.message || "Statut mis à jour.");
      else showError(res.message || "Erreur.");
    });
  };

  const handleDuplicatePack = (id: string) => {
    startTransition(async () => {
      const res = await duplicatePackAction(id);
      if (res.ok) showSuccess("Pack dupliqué avec succès.");
      else showError(res.message || "Erreur lors de la duplication.");
    });
  };

  const handleDeletePack = (id: string, name: string) => {
    if (!confirm(`Supprimer définitivement le pack "${name}" ?`)) return;
    startTransition(async () => {
      const res = await deletePackAction(id);
      if (res.ok) showSuccess("Pack supprimé.");
      else showError(res.message || "Impossible de supprimer le pack.");
    });
  };

  const handleTogglePromotion = (id: string) => {
    startTransition(async () => {
      const res = await togglePromotionAction(id);
      if (res.ok) showSuccess(res.message || "Statut promo mis à jour.");
      else showError(res.message || "Erreur.");
    });
  };

  const handleDeletePromotion = (id: string, name: string) => {
    if (!confirm(`Supprimer définitivement la promotion "${name}" ?`)) return;
    startTransition(async () => {
      const res = await deletePromotionAction(id);
      if (res.ok) showSuccess("Promotion supprimée.");
      else showError(res.message || "Erreur.");
    });
  };

  // Metrics
  const totalServices = initialServices.length;
  const activeServices = initialServices.filter((s) => s.active).length;
  const totalPacks = initialPacks.length;
  const activePromos = initialPromotions.filter((pr) => pr.active && !pr.isExpired).length;
  const avgPrice =
    totalServices > 0
      ? Math.round(initialServices.reduce((sum, s) => sum + s.priceTnd, 0) / totalServices)
      : 0;

  return (
    <div className="space-y-6">
      {/* Toast feedback */}
      {toast && (
        <Toast tone={toast.tone} onDone={() => setToast(null)}>
          {toast.message}
        </Toast>
      )}

      {/* Bannière import brouillon IA */}
      {hasCatalogDraft && !draftDismissed && (
        <div className="flex flex-col gap-3 rounded-2xl border border-champagne/30 bg-gradient-to-r from-champagne/10 to-blush/10 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-champagne/20 text-champagne">
              <SparkleIcon width={18} height={18} />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">
                {t("Brouillon IA disponible")}
              </p>
              <p className="mt-0.5 text-xs text-white/60">
                {t("L'assistant IA a préparé une liste de services pour votre salon. Importez-les en un clic pour démarrer rapidement.")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setDraftDismissed(true)}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/50 transition hover:text-white"
            >
              {t("Ignorer")}
            </button>
            <button
              onClick={handleImportDraft}
              disabled={importingDraft}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-champagne to-blush px-4 py-2 text-xs font-bold text-plum-950 shadow-lg transition hover:opacity-90 disabled:opacity-50"
            >
              <SparkleIcon width={14} height={14} />
              {importingDraft ? t("Importation…") : t("Importer le brouillon IA")}
            </button>
          </div>
        </div>
      )}

      {/* Hero Stats Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-white/50">
            <SparkleIcon width={16} height={16} className="text-blush" />
            <span>{t("Services au catalogue")}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-white sm:text-3xl">
              {totalServices}
            </span>
            <span className="text-xs text-emerald-400">({activeServices} {t("Actif").toLowerCase()}s)</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-white/50">
            <TagIcon width={16} height={16} className="text-champagne" />
            <span>{t("Packs & Forfaits")}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-white sm:text-3xl">
              {totalPacks}
            </span>
            <span className="text-xs text-white/40">{t("Packs")}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-white/50">
            <WalletIcon width={16} height={16} className="text-rose-gold" />
            <span>{t("Prix moyen prestation")}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-white sm:text-3xl">
              {avgPrice}
            </span>
            <span className="text-xs text-white/50">DT</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-medium text-white/50">
            <TagIcon width={16} height={16} className="text-emerald-400" />
            <span>{t("Offres & Promos (F2.7)")}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-white sm:text-3xl">
              {activePromos}
            </span>
            <span className="text-xs text-emerald-400">{t("Actif").toLowerCase()}s</span>
          </div>
        </div>
      </div>

      {/* Navigation Onglets & Boutons d'Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 backdrop-blur-md">
          <button
            onClick={() => setTab("services")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              tab === "services"
                ? "bg-gradient-to-r from-blush to-champagne text-plum-950 shadow-md"
                : "text-white/60 hover:text-white"
            }`}
          >
            <SparkleIcon width={14} height={14} />
            {t("Services au catalogue")} ({initialServices.length})
          </button>
          <button
            onClick={() => setTab("packs")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              tab === "packs"
                ? "bg-gradient-to-r from-blush to-champagne text-plum-950 shadow-md"
                : "text-white/60 hover:text-white"
            }`}
          >
            <TagIcon width={14} height={14} />
            {t("Packs & Forfaits")} ({initialPacks.length})
          </button>
          <button
            onClick={() => setTab("promotions")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${
              tab === "promotions"
                ? "bg-gradient-to-r from-blush to-champagne text-plum-950 shadow-md"
                : "text-white/60 hover:text-white"
            }`}
          >
            <TagIcon width={14} height={14} />
            {t("Offres & Promos")} ({initialPromotions.length})
          </button>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {tab === "services" && (
              <button
                onClick={() => {
                  setEditingService(null);
                  setServiceModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blush to-champagne px-4 py-2.5 text-xs font-bold text-plum-950 shadow-lg shadow-blush/20 transition hover:opacity-95"
              >
                <PlusIcon width={16} height={16} />
                {t("Nouveau service")}
              </button>
            )}
            {tab === "packs" && (
              <button
                onClick={() => {
                  setEditingPack(null);
                  setPackModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blush to-champagne px-4 py-2.5 text-xs font-bold text-plum-950 shadow-lg shadow-blush/20 transition hover:opacity-95"
              >
                <PlusIcon width={16} height={16} />
                {t("Nouveau pack")}
              </button>
            )}
            {tab === "promotions" && (
              <button
                onClick={() => setPromotionModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blush to-champagne px-4 py-2.5 text-xs font-bold text-plum-950 shadow-lg shadow-blush/20 transition hover:opacity-95"
              >
                <PlusIcon width={16} height={16} />
                {t("Nouvelle promotion")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Barre de Filtres et Recherche */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 backdrop-blur-md">
        <div className="relative min-w-[220px] flex-1">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Rechercher par nom, catégorie, description...")}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pe-4 ps-9 text-xs text-white placeholder-white/40 focus:border-rose-gold/60 focus:bg-white/10 focus:outline-none"
          />
        </div>

        {tab === "services" && (
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-xl border border-white/10 bg-plum-950 px-3 py-2 text-xs text-white focus:outline-none"
          >
            <option value="ALL">{t("Toutes les catégories")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        )}

        {centers.length > 1 && (
          <select
            value={selectedCenter}
            onChange={(e) => setSelectedCenter(e.target.value)}
            className="rounded-xl border border-white/10 bg-plum-950 px-3 py-2 text-xs text-white focus:outline-none"
          >
            <option value="ALL">{t("Tous les centres")}</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
            className="rounded border-white/20 bg-white/10 text-rose-gold focus:ring-0"
          />
          {t("Actifs uniquement")}
        </label>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* CONTENU ONGLET 1 : SERVICES */}
      {/* ───────────────────────────────────────────────────────────── */}
      {tab === "services" && (
        <div>
          {filteredServices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <SparkleIcon width={32} height={32} className="mx-auto mb-3 text-white/30" />
              <h3 className="font-display text-lg text-white">Aucun service trouvé</h3>
              <p className="mt-1 text-xs text-white/50">
                {search || selectedCategory !== "ALL"
                  ? "Modifiez vos critères de recherche ou réinitialisez les filtres."
                  : "Commencez par ajouter votre premier service au catalogue."}
              </p>
              {canManage && (
                <button
                  onClick={() => {
                    setEditingService(null);
                    setServiceModalOpen(true);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  <PlusIcon width={14} height={14} />
                  Créer un service
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredServices.map((service) => (
                <div
                  key={service.id}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 ${
                    service.active
                      ? "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                      : "border-white/5 bg-white/[0.01] opacity-60"
                  }`}
                >
                  <div>
                    {/* Header carte */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-block rounded-full bg-rose-gold/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-gold">
                          {service.category}
                        </span>
                        <h3 className="mt-2 font-display text-lg font-semibold text-white">
                          {service.name}
                        </h3>
                      </div>

                      {/* Switch actif/inactif */}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleToggleService(service.id)}
                          title={service.active ? "Désactiver" : "Activer"}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            service.active ? "bg-emerald-500" : "bg-white/20"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                              service.active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {/* Description si présente */}
                    {service.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-white/60">
                        {service.description}
                      </p>
                    )}

                    {/* Détails : Durée & Prix */}
                    <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                      <div className="flex items-center gap-1.5 text-xs text-white/70">
                        <ClockIcon width={14} height={14} className="text-white/40" />
                        <span>{service.durationMinutes} min</span>
                      </div>
                      <div className="font-display text-lg font-bold text-champagne">
                        {service.priceTnd} DT
                      </div>
                    </div>

                    {/* Badges : Options, Compétences, Centres */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {service.options.length > 0 && (
                        <span className="rounded-lg bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                          {service.options.length} option{service.options.length > 1 ? "s" : ""}
                        </span>
                      )}
                      {service.centerPrices.length > 0 && (
                        <span className="rounded-lg bg-champagne/10 px-2 py-0.5 text-[10px] text-champagne">
                          Tarif multi-centres
                        </span>
                      )}
                      {service.requiredSkills.map((sk, i) => (
                        <span
                          key={i}
                          className="rounded-lg bg-blush/10 px-2 py-0.5 text-[10px] text-blush"
                        >
                          {sk}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Boutons d'action carte */}
                  {canManage && (
                    <div className="mt-4 flex items-center justify-end gap-1 border-t border-white/5 pt-3 text-xs">
                      <button
                        onClick={() => {
                          setEditingService(service);
                          setServiceModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                      >
                        <EditIcon width={13} height={13} />
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDuplicateService(service.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                      >
                        <CopyIcon width={13} height={13} />
                        Dupliquer
                      </button>
                      <button
                        onClick={() => handleDeleteService(service.id, service.name)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-white/40 transition hover:bg-red-500/10 hover:text-red-300"
                      >
                        <TrashIcon width={13} height={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* CONTENU ONGLET 2 : PACKS & FORFAITS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {tab === "packs" && (
        <div>
          {filteredPacks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <TagIcon width={32} height={32} className="mx-auto mb-3 text-white/30" />
              <h3 className="font-display text-lg text-white">Aucun pack configuré</h3>
              <p className="mt-1 text-xs text-white/50">
                Combinez plusieurs services pour proposer des forfaits avantageux à vos clients.
              </p>
              {canManage && (
                <button
                  onClick={() => {
                    setEditingPack(null);
                    setPackModalOpen(true);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  <PlusIcon width={14} height={14} />
                  Créer un pack
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredPacks.map((pack) => (
                <div
                  key={pack.id}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 ${
                    pack.active
                      ? "border-rose-gold/20 bg-white/[0.03] hover:border-rose-gold/40 hover:bg-white/[0.05]"
                      : "border-white/5 bg-white/[0.01] opacity-60"
                  }`}
                >
                  <div>
                    {/* Header Pack */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded-full bg-champagne/15 px-2.5 py-0.5 text-[11px] font-medium text-champagne">
                            Forfait {pack.services.length} prestations
                          </span>
                          {pack.savingsTnd > 0 && (
                            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                              -{pack.savingsPercent}%
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 font-display text-lg font-semibold text-white">
                          {pack.name}
                        </h3>
                      </div>

                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleTogglePack(pack.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            pack.active ? "bg-emerald-500" : "bg-white/20"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                              pack.active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {pack.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-white/60">
                        {pack.description}
                      </p>
                    )}

                    {/* Liste des services inclus */}
                    <div className="mt-4 space-y-1.5 rounded-xl bg-white/[0.02] p-2.5 border border-white/5">
                      <div className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
                        Services inclus
                      </div>
                      {pack.services.map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-xs text-white/80">
                          <span className="truncate">• {s.name}</span>
                          <span className="text-[11px] text-white/40">{s.priceTnd} DT</span>
                        </div>
                      ))}
                    </div>

                    {/* Comparaison tarifaire & Durée */}
                    <div className="mt-4 flex items-end justify-between border-t border-white/5 pt-3">
                      <div>
                        <div className="text-[11px] text-white/40 line-through">
                          {pack.regularTotalTnd} DT normal
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-white/60">
                          <ClockIcon width={13} height={13} />
                          <span>{pack.totalDurationMinutes} min</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-display text-xl font-bold text-champagne">
                          {pack.priceTnd} DT
                        </div>
                        {pack.savingsTnd > 0 && (
                          <div className="text-[10px] text-emerald-400 font-medium">
                            Économie : {pack.savingsTnd} DT
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {canManage && (
                    <div className="mt-4 flex items-center justify-end gap-1 border-t border-white/5 pt-3 text-xs">
                      <button
                        onClick={() => {
                          setEditingPack(pack);
                          setPackModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                      >
                        <EditIcon width={13} height={13} />
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDuplicatePack(pack.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                      >
                        <CopyIcon width={13} height={13} />
                        Dupliquer
                      </button>
                      <button
                        onClick={() => handleDeletePack(pack.id, pack.name)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-white/40 transition hover:bg-red-500/10 hover:text-red-300"
                      >
                        <TrashIcon width={13} height={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* CONTENU ONGLET 3 : PROMOTIONS & CODES (F2.7) */}
      {/* ───────────────────────────────────────────────────────────── */}
      {tab === "promotions" && (
        <div>
          {filteredPromotions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <TagIcon width={32} height={32} className="mx-auto mb-3 text-white/30" />
              <h3 className="font-display text-lg text-white">Aucune promotion en cours</h3>
              <p className="mt-1 text-xs text-white/50">
                Créez des remises temporaires ou des codes de réduction pour fidéliser vos clients.
              </p>
              {canManage && (
                <button
                  onClick={() => setPromotionModalOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  <PlusIcon width={14} height={14} />
                  Créer une offre
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredPromotions.map((promo) => (
                <div
                  key={promo.id}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 ${
                    promo.active && !promo.isExpired
                      ? "border-emerald-500/20 bg-white/[0.03] hover:border-emerald-500/40"
                      : "border-white/5 bg-white/[0.01] opacity-60"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
                            {promo.type === "PERCENTAGE" ? `-${promo.value}%` : `-${promo.value} DT`}
                          </span>
                          {promo.isExpired && (
                            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300">
                              Expirée
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 font-display text-base font-semibold text-white">
                          {promo.name}
                        </h3>
                      </div>

                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleTogglePromotion(promo.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            promo.active ? "bg-emerald-500" : "bg-white/20"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                              promo.active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {promo.code && (
                      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
                        <span className="text-xs font-mono font-bold text-champagne">
                          {promo.code}
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(promo.code || "");
                            showSuccess("Code copié dans le presse-papier.");
                          }}
                          className="text-[11px] text-white/50 hover:text-white"
                        >
                          Copier
                        </button>
                      </div>
                    )}

                    <div className="mt-4 space-y-1 text-xs text-white/50">
                      <div>
                        Validité : du {new Date(promo.startsAt).toLocaleDateString("fr-FR")} au{" "}
                        {new Date(promo.endsAt).toLocaleDateString("fr-FR")}
                      </div>
                      <div>
                        Utilisations : {promo.usedCount}{" "}
                        {promo.maxUses ? `/ ${promo.maxUses}` : "(illimité)"}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <div className="mt-4 flex justify-end border-t border-white/5 pt-3">
                      <button
                        onClick={() => handleDeletePromotion(promo.id, promo.name)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-white/40 transition hover:bg-red-500/10 hover:text-red-300"
                      >
                        <TrashIcon width={13} height={13} />
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modales */}
      <ServiceModal
        open={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        service={editingService}
        categories={categories}
        centers={centers}
        onSaved={showSuccess}
        onError={showError}
      />

      <PackModal
        open={packModalOpen}
        onClose={() => setPackModalOpen(false)}
        pack={editingPack}
        availableServices={initialServices}
        centers={centers}
        onSaved={showSuccess}
        onError={showError}
      />

      <PromotionModal
        open={promotionModalOpen}
        onClose={() => setPromotionModalOpen(false)}
        services={initialServices}
        packs={initialPacks}
        centers={centers}
        onSaved={showSuccess}
        onError={showError}
      />
    </div>
  );
}
