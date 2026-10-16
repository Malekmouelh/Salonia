"use client";

import { useState, useTransition } from "react";
import { createBlock, deleteBlock, type ActionResult } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import type { CalendarBlock, CalendarData } from "@/lib/booking/types";
import type { BlockKind } from "@/lib/enums";
import { ActionButton } from "./booking-drawer";
import { BLOCK_LABELS, inputClass, labelClass } from "./status";

// F3.2 — Bloquer un créneau, ajouter une pause ou fermer le centre.
export function BlockForm({ day, data, onClose, onResult }: { day: string; data: CalendarData; onClose: () => void; onResult: (r: ActionResult) => void }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<BlockKind>("BLOCK");
  const [staffId, setStaffId] = useState<string>(data.staffFilter ?? data.practitioners[0]?.id ?? "");
  const [form, setForm] = useState({ day, endDay: day, from: "13:00", to: "14:00", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const kinds: BlockKind[] = data.canManage ? ["BLOCK", "BREAK", "CLOSURE"] : ["BLOCK", "BREAK"];

  const submit = () =>
    startTransition(async () => {
      const r = await createBlock({ centerId: data.center.id, staffId: kind === "CLOSURE" ? null : staffId, kind, ...form });
      if (r.error) setError(r.error);
      else {
        onResult(r);
        onClose();
      }
    });

  return (
    <Modal open onClose={onClose} title={t("Bloquer du temps")}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 p-1">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-xl py-2 text-sm transition ${kind === k ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
            >
              {t(BLOCK_LABELS[k])}
            </button>
          ))}
        </div>

        {kind !== "CLOSURE" ? (
          <>
            <label className="block">
              <span className={labelClass}>{t("Praticien")}</span>
              <select className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!data.canManage}>
                {data.practitioners.map((p) => (
                  <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label>
                <span className={labelClass}>{t("Date")}</span>
                <input type="date" className={inputClass} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} dir="ltr" />
              </label>
              <label>
                <span className={labelClass}>{t("De")}</span>
                <input type="time" step={900} className={inputClass} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} dir="ltr" />
              </label>
              <label>
                <span className={labelClass}>{t("À")}</span>
                <input type="time" step={900} className={inputClass} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} dir="ltr" />
              </label>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={labelClass}>{t("Du")}</span>
              <input type="date" className={inputClass} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} dir="ltr" />
            </label>
            <label>
              <span className={labelClass}>{t("Au")}</span>
              <input type="date" className={inputClass} value={form.endDay} min={form.day} onChange={(e) => setForm({ ...form, endDay: e.target.value })} dir="ltr" />
            </label>
            <p className="col-span-2 text-xs text-white/50">{t("Tout le centre sera fermé à la réservation sur ces journées (jour férié, travaux, inventaire…).")}</p>
          </div>
        )}

        <label className="block">
          <span className={labelClass}>{t("Motif")}</span>
          <input className={inputClass} placeholder={t("Ex. : formation, rendez-vous médical, Aïd…")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </label>

        {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{t(error)}</p>}

        <div className="flex gap-2">
          <ActionButton onClick={onClose}>{t("Annuler")}</ActionButton>
          <ActionButton tone="ok" disabled={pending} onClick={submit}>
            {pending ? t("Un instant…") : t("Bloquer")}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

export function BlockDetail({ block, data, onClose, onResult }: { block: CalendarBlock; data: CalendarData; onClose: () => void; onResult: (r: ActionResult) => void }) {
  const { t, lang } = useI18n();
  const [pending, startTransition] = useTransition();
  const staff = data.practitioners.find((p) => p.id === block.staffId);
  return (
    <Modal open onClose={onClose} title={t(BLOCK_LABELS[block.kind])}>
      <div className="space-y-4">
        <p className="text-white/80">
          <span className="capitalize">{fmtDay(block.start, lang)}</span>
          {block.kind !== "CLOSURE" && (
            <span dir="ltr">
              {" "}· {fmtTime(block.start, lang)} – {fmtTime(block.end, lang)}
            </span>
          )}
        </p>
        <p className="text-sm text-white/60">{staff ? `${staff.firstName} ${staff.lastName}` : t("Tout le centre")}</p>
        {block.reason && <p className="rounded-xl bg-white/5 p-3 text-sm text-white/70">{block.reason}</p>}
        <div className="flex gap-2">
          <ActionButton onClick={onClose}>{t("Fermer")}</ActionButton>
          <ActionButton
            tone="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteBlock(block.id);
                onResult(r.ok ? { ok: true, message: "Créneau libéré." } : r);
                if (r.ok) onClose();
              })
            }
          >
            {t("Supprimer le blocage")}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}
