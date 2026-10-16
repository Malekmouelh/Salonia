"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createStaffBooking, findCustomers, type ActionResult } from "@/app/actions/bookings";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Modal } from "@/components/ui/modal";
import { fmtDuration, fmtMoney } from "@/lib/booking/format";
import type { CalendarData, PackOption, ServiceOption } from "@/lib/booking/types";
import { ActionButton } from "./booking-drawer";
import { inputClass, labelClass } from "./status";

export type BookingDraft = { day: string; time: string; staffId: string | null };

export function BookingForm({
  draft,
  data,
  services,
  packs,
  onClose,
  onResult,
}: {
  draft: BookingDraft | null;
  data: CalendarData;
  services: ServiceOption[];
  packs: PackOption[];
  onClose: () => void;
  onResult: (r: ActionResult) => void;
}) {
  const { t, lang } = useI18n();
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState(draft?.day ?? "");
  const [time, setTime] = useState(draft?.time ?? "10:00");
  const [staffId, setStaffId] = useState(draft?.staffId ?? data.staffFilter ?? data.practitioners[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [packId, setPackId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [newCustomer, setNewCustomer] = useState({ firstName: "", lastName: "", phone: "" });
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recherche du client par nom ou téléphone (à partir de 2 caractères).
  useEffect(() => {
    if (customer || query.trim().length < 2) return;
    const id = setTimeout(() => findCustomers(query).then(setMatches), 250);
    return () => clearTimeout(id);
  }, [query, customer]);

  const total = useMemo(() => {
    if (packId) {
      const p = packs.find((x) => x.id === packId);
      return { price: p?.priceTnd ?? 0, minutes: p?.durationMinutes ?? 0 };
    }
    const list = services.filter((s) => selected.includes(s.id));
    return { price: list.reduce((n, s) => n + s.priceTnd, 0), minutes: list.reduce((n, s) => n + s.durationMinutes, 0) };
  }, [packId, selected, services, packs]);

  const categories = useMemo(() => [...new Set(services.map((s) => s.category))], [services]);

  if (!draft) return null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await createStaffBooking({
        centerId: data.center.id,
        staffId,
        day,
        time,
        serviceIds: packId ? [] : selected,
        packId: packId ?? undefined,
        customerId: customer?.id,
        ...(customer ? {} : newCustomer),
        notes,
        force,
      });
      if (r.error) setError(r.error);
      else {
        onResult(r);
        onClose();
      }
    });
  }

  const toggle = (id: string) => {
    setPackId(null);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <Modal open onClose={onClose} title={t("Nouveau rendez-vous")} wide>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <span className={labelClass}>{t("Date")}</span>
            <input type="date" className={inputClass} value={day} onChange={(e) => setDay(e.target.value)} dir="ltr" />
          </label>
          <label>
            <span className={labelClass}>{t("Heure")}</span>
            <input type="time" step={900} className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" />
          </label>
          <label>
            <span className={labelClass}>{t("Praticien")}</span>
            <select className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!data.canManage && data.practitioners.length <= 1}>
              {data.practitioners.map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Client */}
        <div>
          <span className={labelClass}>{t("Client")}</span>
          {customer ? (
            <div className="flex items-center justify-between rounded-xl border border-rose-gold/40 bg-rose-gold/10 px-3.5 py-2.5 text-sm text-white">
              {customer.name}
              <button type="button" onClick={() => setCustomer(null)} className="text-xs text-white/60 hover:text-white">{t("Changer")}</button>
            </div>
          ) : (
            <>
              <input className={inputClass} placeholder={t("Rechercher par nom ou téléphone…")} value={query} onChange={(e) => setQuery(e.target.value)} />
              {matches.length > 0 && query.length >= 2 && (
                <ul className="mt-1 overflow-hidden rounded-xl border border-white/10 bg-plum-900">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomer({ id: m.id, name: m.name });
                          setMatches([]);
                        }}
                        className="flex w-full justify-between px-3.5 py-2 text-start text-sm text-white hover:bg-white/5"
                      >
                        {m.name}
                        <span className="text-white/40" dir="ltr">{m.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-white/40">{t("Ou nouveau client :")}</p>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                <input className={inputClass} placeholder={t("Prénom")} value={newCustomer.firstName} onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })} />
                <input className={inputClass} placeholder={t("Nom")} value={newCustomer.lastName} onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })} />
                <input className={inputClass} placeholder={t("Téléphone")} inputMode="tel" dir="ltr" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              </div>
            </>
          )}
        </div>

        {/* Prestations */}
        <div>
          <span className={labelClass}>{t("Prestations")}</span>
          <div className="max-h-56 space-y-3 overflow-y-auto pe-1">
            {categories.map((cat) => (
              <div key={cat}>
                <p className="mb-1.5 text-[11px] text-white/35">{t(cat)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {services.filter((s) => s.category === cat).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        selected.includes(s.id) && !packId ? "border-rose-gold bg-rose-gold/20 text-white" : "border-white/10 text-white/70 hover:border-white/30"
                      }`}
                    >
                      {s.name} · {fmtDuration(s.durationMinutes)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {packs.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] text-white/35">{t("Packs")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {packs.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPackId(packId === p.id ? null : p.id);
                        setSelected([]);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${packId === p.id ? "border-champagne bg-champagne/20 text-white" : "border-champagne/25 text-champagne/80 hover:border-champagne/50"}`}
                    >
                      ✨ {p.name} · {fmtMoney(p.priceTnd, lang)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <label className="block">
          <span className={labelClass}>{t("Note interne (facultatif)")}</span>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {data.canManage && (
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-rose-gold" />
            {t("Autoriser en dehors des horaires d'ouverture")}
          </label>
        )}

        {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 animate-shake">{t(error)}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-sm text-white/60">
            {total.minutes > 0 ? (
              <>
                <span className="font-semibold text-white">{fmtMoney(total.price, lang)}</span> · {fmtDuration(total.minutes)}
              </>
            ) : (
              t("Aucune prestation choisie")
            )}
          </p>
          <div className="flex gap-2">
            <ActionButton onClick={onClose}>{t("Annuler")}</ActionButton>
            <ActionButton tone="ok" disabled={pending || total.minutes === 0} onClick={submit}>
              {pending ? t("Un instant…") : t("Enregistrer")}
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
