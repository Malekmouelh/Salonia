"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import {
  archiveEquipmentAction,
  createEquipmentAction,
  listMaintenanceHistoryAction,
  recordMaintenanceAction,
  scheduleMaintenanceAction,
  updateEquipmentAction,
} from "@/app/actions/stock";
import { inputClass, labelClass } from "@/components/calendar/status";
import { Panel, selectClass } from "@/components/finance/finance-ui";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert, SubmitButton } from "@/components/ui/form";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { dayKey } from "@/lib/booking/time";
import { EQUIPMENT_STATUSES, type EquipmentStatus } from "@/lib/enums";
import type { EquipmentView, MaintenanceRecordView } from "@/lib/stock/equipment";
import { EQUIPMENT_STATUS_LABELS, MAINTENANCE_STATE_LABELS } from "@/lib/stock/labels";
import { CenterFilter, Chip, DateText, EmptyState, FieldError, centerName, useFeedback, useSubmit, type CenterItem, type ChipTone } from "./stock-shared";

// F5.1 / F5.4 — Matériel et maintenance. Le centre d'un équipement ne change pas après création. L'historique de maintenance est en
// lecture seule : aucune modification ni suppression d'intervention. Les échéances sont calculées à la lecture (pas de rappel de fond).

const STATUS_TONE: Record<EquipmentStatus, ChipTone> = { IN_SERVICE: "ok", IN_MAINTENANCE: "warn", OUT_OF_SERVICE: "bad" };
const STATE_TONE = { NONE: "muted", OVERDUE: "bad", DUE_TODAY: "warn", SCHEDULED: "info" } as const;

type Modal =
  | { type: "edit"; equipment: EquipmentView | null }
  | { type: "schedule"; equipment: EquipmentView }
  | { type: "record"; equipment: EquipmentView }
  | { type: "history"; equipment: EquipmentView };

export function MaterielManager({
  centers,
  selectedCenterId,
  equipment,
  schedule,
}: {
  centers: CenterItem[];
  selectedCenterId: string | null;
  equipment: EquipmentView[];
  schedule: EquipmentView[];
}) {
  const { t } = useI18n();
  const feedback = useFeedback();
  const [modal, setModal] = useState<Modal | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EquipmentStatus | "">("");
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();
  const done = (message: string) => feedback.show(message);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => equipment.filter((e) => (showArchived || e.active) && (!status || e.status === status) && (!needle || `${e.name} ${e.category}`.toLowerCase().includes(needle))),
    [equipment, showArchived, status, needle],
  );
  const dueSoon = schedule.filter((e) => e.maintenanceState !== "NONE");

  const archive = (e: EquipmentView) => {
    if (!confirm(t("Archiver cet équipement ? Son historique de maintenance est conservé."))) return;
    startTransition(async () => {
      const r = await archiveEquipmentAction({ equipmentId: e.id });
      feedback.show(r.ok ? (r.message ?? "Équipement archivé.") : (r.message ?? "Une erreur est survenue. Réessayez."), r.ok ? "success" : "error");
    });
  };

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <CenterFilter centers={centers} selectedId={selectedCenterId} basePath="/dashboard/stock/materiel" />
        <button type="button" onClick={() => setModal({ type: "edit", equipment: null })} className="btn-shine ms-auto flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-plum-950">
          <PlusIcon width={16} height={16} /> {t("Ajouter un équipement")}
        </button>
      </div>

      <Panel title="Échéances de maintenance" subtitle="Matériel actif avec une date programmée, de la plus proche à la plus lointaine">
        {dueSoon.length === 0 ? (
          <p className="py-4 text-center text-sm text-white/45">{t("Aucune maintenance programmée.")}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {dueSoon.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{e.name}</p>
                  <p className="text-xs text-white/45">{centerName(centers, e.centerId)}</p>
                </div>
                {e.nextMaintenanceAt && <DateText value={e.nextMaintenanceAt} />}
                <Chip tone={STATE_TONE[e.maintenanceState]}>{t(MAINTENANCE_STATE_LABELS[e.maintenanceState])}</Chip>
                <button type="button" onClick={() => setModal({ type: "record", equipment: e })} className="text-xs font-medium text-champagne hover:underline">
                  {t("Enregistrer l'intervention")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">{t("Rechercher un équipement")}</span>
          <SearchIcon width={16} height={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Rechercher un équipement")} className="w-full rounded-xl border border-white/10 bg-white/[0.05] py-2 pe-3 ps-9 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-rose-gold/60" />
        </label>
        <select aria-label={t("État")} value={status} onChange={(e) => setStatus(e.target.value as EquipmentStatus | "")} className={selectClass}>
          <option value="">{t("Tous les états")}</option>
          {EQUIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(EQUIPMENT_STATUS_LABELS[s])}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-rose-gold" />
          {t("Afficher les archivés")}
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState>{equipment.length === 0 ? t("Aucun équipement. Ajoutez séchoirs, fauteuils et appareils de chaque centre.") : t("Aucun équipement ne correspond.")}</EmptyState>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((e) => (
            <li key={e.id} className={`glass rounded-3xl p-5 ${e.active ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{e.name}</p>
                  <p className="text-xs text-white/45">
                    {e.category} · {centerName(centers, e.centerId)}
                  </p>
                </div>
                {e.active ? <Chip tone={STATUS_TONE[e.status]}>{t(EQUIPMENT_STATUS_LABELS[e.status])}</Chip> : <Chip tone="muted">{t("Archivé")}</Chip>}
              </div>
              <dl className="mt-4 space-y-1 text-xs text-white/55">
                <div className="flex justify-between gap-2">
                  <dt>{t("Prochaine maintenance")}</dt>
                  <dd className="text-white/80">{e.nextMaintenanceAt ? <DateText value={e.nextMaintenanceAt} /> : "—"}</dd>
                </div>
                {e.maintenanceState !== "NONE" && e.active && (
                  <div className="flex justify-end">
                    <Chip tone={STATE_TONE[e.maintenanceState]}>{t(MAINTENANCE_STATE_LABELS[e.maintenanceState])}</Chip>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt>{t("Acquis le")}</dt>
                  <dd className="text-white/80">{e.acquiredAt ? <DateText value={e.acquiredAt} /> : "—"}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {e.active && (
                  <>
                    <button type="button" onClick={() => setModal({ type: "record", equipment: e })} className="font-medium text-champagne hover:underline">
                      {t("Intervention")}
                    </button>
                    <button type="button" onClick={() => setModal({ type: "schedule", equipment: e })} className="text-white/60 hover:text-white">
                      {t("Programmer")}
                    </button>
                    <button type="button" onClick={() => setModal({ type: "edit", equipment: e })} className="text-white/60 hover:text-white">
                      {t("Modifier")}
                    </button>
                  </>
                )}
                <button type="button" onClick={() => setModal({ type: "history", equipment: e })} className="text-white/60 hover:text-white">
                  {t("Historique")}
                </button>
                {e.active && (
                  <button type="button" disabled={pending} onClick={() => archive(e)} className="text-white/60 hover:text-red-300 disabled:opacity-60">
                    {t("Archiver")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal?.type === "edit" && <EquipmentModal equipment={modal.equipment} centers={centers} defaultCenterId={selectedCenterId} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "schedule" && <ScheduleModal equipment={modal.equipment} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "record" && <RecordModal equipment={modal.equipment} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "history" && <MaintenanceHistoryModal equipment={modal.equipment} onClose={() => setModal(null)} />}
      {feedback.node}
    </div>
  );
}

const dateInput = `${inputClass} [color-scheme:dark]`;

function EquipmentModal({ equipment, centers, defaultCenterId, onClose, onDone }: { equipment: EquipmentView | null; centers: CenterItem[]; defaultCenterId: string | null; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const [form, setForm] = useState({
    centerId: equipment?.centerId ?? defaultCenterId ?? centers[0]?.id ?? "",
    name: equipment?.name ?? "",
    category: equipment?.category ?? "",
    status: (equipment?.status ?? "IN_SERVICE") as EquipmentStatus,
    acquiredAt: equipment?.acquiredAt ?? "",
    nextMaintenanceAt: equipment?.nextMaintenanceAt ?? "",
  });
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={t(equipment ? "Modifier l'équipement" : "Ajouter un équipement")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() =>
            equipment
              ? updateEquipmentAction({ equipmentId: equipment.id, name: form.name, category: form.category, status: form.status, acquiredAt: form.acquiredAt || null, nextMaintenanceAt: form.nextMaintenanceAt || null })
              : createEquipmentAction({ centerId: form.centerId, name: form.name, category: form.category, status: form.status, acquiredAt: form.acquiredAt || undefined, nextMaintenanceAt: form.nextMaintenanceAt || undefined }),
          );
        }}
      >
        {!equipment && (
          <div>
            <label className={labelClass} htmlFor={`${uid}-center`}>{t("Centre")}</label>
            <select id={`${uid}-center`} value={form.centerId} onChange={set("centerId")} className={`${selectClass} w-full`}>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-white/40">{t("Le centre ne pourra plus être modifié.")}</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${uid}-name`}>{t("Nom")}</label>
            <input id={`${uid}-name`} required maxLength={80} value={form.name} onChange={set("name")} className={inputClass} />
            <FieldError errors={errors} name="name" />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-category`}>{t("Catégorie")}</label>
            <input id={`${uid}-category`} required maxLength={60} value={form.category} onChange={set("category")} placeholder={t("Séchoir, fauteuil, appareil…")} className={inputClass} />
            <FieldError errors={errors} name="category" />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${uid}-status`}>{t("État")}</label>
          <select id={`${uid}-status`} value={form.status} onChange={set("status")} className={`${selectClass} w-full`}>
            {EQUIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(EQUIPMENT_STATUS_LABELS[s])}
              </option>
            ))}
          </select>
          <FieldError errors={errors} name="status" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${uid}-acquired`}>{t("Date d'acquisition")} ({t("facultatif")})</label>
            <input id={`${uid}-acquired`} type="date" value={form.acquiredAt} onChange={set("acquiredAt")} className={dateInput} />
            <FieldError errors={errors} name="acquiredAt" />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-next`}>{t("Prochaine maintenance")} ({t("facultatif")})</label>
            <input id={`${uid}-next`} type="date" value={form.nextMaintenanceAt} onChange={set("nextMaintenanceAt")} className={dateInput} />
            <FieldError errors={errors} name="nextMaintenanceAt" />
          </div>
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <FieldError errors={errors} name="equipmentId" />
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}

function ScheduleModal({ equipment, onClose, onDone }: { equipment: EquipmentView; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const [date, setDate] = useState(equipment.nextMaintenanceAt ?? "");
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Programmer la maintenance")}>
      <p className="mb-4 text-sm text-white/60">{equipment.name}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => scheduleMaintenanceAction({ equipmentId: equipment.id, nextMaintenanceAt: date || null }));
        }}
      >
        <div>
          <label className={labelClass} htmlFor={`${uid}-date`}>{t("Prochaine maintenance")}</label>
          <input id={`${uid}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={dateInput} />
          <p className="mt-1 text-xs text-white/40">{t("Laissez vide pour retirer l'échéance.")}</p>
          <FieldError errors={errors} name="nextMaintenanceAt" />
        </div>
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer")}</SubmitButton>
      </form>
    </Modal>
  );
}

function RecordModal({ equipment, onClose, onDone }: { equipment: EquipmentView; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const uid = useId();
  const [performedAt, setPerformedAt] = useState(dayKey(new Date()));
  const [note, setNote] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");
  const { pending, errors, message, submit } = useSubmit((m) => {
    onDone(m);
    onClose();
  });
  return (
    <Modal open onClose={onClose} title={t("Enregistrer une intervention")}>
      <p className="mb-4 text-sm text-white/60">{equipment.name}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(() => recordMaintenanceAction({ equipmentId: equipment.id, performedAt, note, nextDueAt: nextDueAt || undefined }));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${uid}-date`}>{t("Date de l'intervention")}</label>
            <input id={`${uid}-date`} type="date" required value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} className={dateInput} />
            <FieldError errors={errors} name="performedAt" />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${uid}-next`}>{t("Prochaine échéance")} ({t("facultatif")})</label>
            <input id={`${uid}-next`} type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} className={dateInput} />
            <FieldError errors={errors} name="nextDueAt" />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor={`${uid}-note`}>{t("Description")} ({t("facultatif")})</label>
          <textarea id={`${uid}-note`} rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          <FieldError errors={errors} name="note" />
        </div>
        <p className="text-xs text-white/40">{t("Une intervention enregistrée ne peut plus être modifiée ni supprimée. Sans échéance suivante, la prochaine maintenance est retirée de la fiche.")}</p>
        {message && <Alert>{t(message)}</Alert>}
        <SubmitButton pending={pending}>{t("Enregistrer l'intervention")}</SubmitButton>
      </form>
    </Modal>
  );
}

function MaintenanceHistoryModal({ equipment, onClose }: { equipment: EquipmentView; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<MaintenanceRecordView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listMaintenanceHistoryAction({ equipmentId: equipment.id });
      if (cancelled) return;
      if (result.ok) {
        setRows(result.history);
        setState("ready");
      } else {
        setError(result.message ?? "Une erreur est survenue. Réessayez.");
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [equipment.id]);
  return (
    <Modal open onClose={onClose} title={t("Historique de maintenance")}>
      <p className="mb-4 text-sm text-white/60">
        {equipment.name} · {equipment.category}
      </p>
      {state === "loading" && <div className="h-32 animate-pulse rounded-2xl bg-white/5" />}
      {state === "error" && <Alert>{t(error ?? "")}</Alert>}
      {state === "ready" && rows.length === 0 && <p className="py-6 text-center text-sm text-white/50">{t("Aucune intervention enregistrée.")}</p>}
      {state === "ready" && rows.length > 0 && (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <p className="text-sm text-white">
                <DateText value={r.performedAt} />
              </p>
              {r.note && <p className="mt-0.5 text-sm text-white/70">{r.note}</p>}
              <p className="mt-0.5 text-xs text-white/45">
                {t("Échéance suivante")} : {r.nextDueAt ? <DateText value={r.nextDueAt} /> : "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
