"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createOnlineBooking, getPublicMonthAvailability, getPublicSlots, joinPublicWaitlist, validatePromoCodeAction } from "@/app/actions/public-booking";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PinIcon, SparkleIcon } from "@/components/ui/icons";
import type { Slot } from "@/lib/booking/availability";
import { fmtDay, fmtDuration, fmtMoney, fmtTime } from "@/lib/booking/format";
import { addDays, dayKey, parseDayKey, toLocal } from "@/lib/booking/time";
import type { PublicSalon } from "@/lib/data/public-salon";
import { governorateLabel } from "@/lib/definitions";
import { BookingChat } from "./booking-chat";
import { encodeDraft, type BookingDraft } from "@/lib/booking/draft";
import type { BookingClient } from "@/lib/data/booking-client";
import { BookingSuccess } from "./booking-success";

const STEPS = ["Prestation", "Praticien", "Créneau", "Confirmation"];

export type Choice = {
  centerId: string;
  serviceIds: string[];
  packId: string | null;
  staffId: string | null;
  selectedOptions?: Record<string, Record<string, string>>;
  promoCode?: string;
};

export type AppliedPromo = {
  code: string;
  name: string;
  type: string;
  value: number;
  discountTnd: number;
  newTotalTnd: number;
};

function getServiceBasePrice(service: PublicSalon["services"][number], centerId: string): number {
  if (service.centerPrices && service.centerPrices.length > 0) {
    const cp = service.centerPrices.find((c) => c.centerId === centerId);
    if (cp) return cp.priceTnd;
  }
  return service.priceTnd;
}

function getServiceOptionsExtra(
  service: PublicSalon["services"][number],
  selectedOptions?: Record<string, string>,
): { price: number; minutes: number } {
  if (!service.options || !selectedOptions) return { price: 0, minutes: 0 };
  let price = 0;
  let minutes = 0;
  for (const opt of service.options) {
    const chosenLabel = selectedOptions[opt.name];
    if (chosenLabel) {
      const val = opt.values.find((v) => v.label === chosenLabel);
      if (val) {
        price += val.extraPriceTnd;
        minutes += val.extraDurationMinutes;
      }
    }
  }
  return { price, minutes };
}

function getPackPrice(pack: PublicSalon["packs"][number], centerId: string): number {
  if (pack.centerPrices && pack.centerPrices.length > 0) {
    const cp = pack.centerPrices.find((c) => c.centerId === centerId);
    if (cp) return cp.priceTnd;
  }
  return pack.priceTnd;
}

// F3.3 — Réservation en ligne en 4 étapes (cahier des charges §7 : 4 étapes maximum).
export type BookingDone = { bookingId: string; start: string; manageUrl: string; staffName: string; totalTnd: number };

export function BookingWizard({ salon, client, draft }: { salon: PublicSalon; client: BookingClient; draft: BookingDraft | null }) {
  const { t, lang } = useI18n();
  // Reprise après connexion / inscription : directement à l'étape de confirmation.
  const [step, setStep] = useState(draft ? 3 : 0);
  const [choice, setChoice] = useState<Choice>(
    draft
      ? { centerId: draft.centerId, serviceIds: draft.serviceIds, packId: draft.packId, staffId: draft.staffId, selectedOptions: draft.selectedOptions ?? {} }
      : { centerId: salon.centers[0]?.id ?? "", serviceIds: [], packId: null, staffId: null, selectedOptions: {} },
  );
  const [day, setDay] = useState(draft ? dayKey(new Date(draft.slot.start)) : dayKey(new Date()));
  const [slot, setSlot] = useState<Slot | null>(draft?.slot ?? null);
  const [done, setDone] = useState<BookingDone | null>(null);
  const [viaChatbot, setViaChatbot] = useState(draft?.viaChatbot ?? false);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);

  const center = salon.centers.find((c) => c.id === choice.centerId)!;
  const selection = useMemo(
    () => ({ serviceIds: choice.serviceIds, packId: choice.packId, selectedOptions: choice.selectedOptions }),
    [choice.serviceIds, choice.packId, choice.selectedOptions],
  );

  const summary = useMemo(() => {
    if (choice.packId) {
      const p = salon.packs.find((x) => x.id === choice.packId)!;
      return { label: p.name, price: getPackPrice(p, choice.centerId), minutes: p.durationMinutes };
    }
    const list = salon.services.filter((s) => choice.serviceIds.includes(s.id));
    let totalPrice = 0;
    let totalMinutes = 0;
    const names: string[] = [];

    for (const s of list) {
      const base = getServiceBasePrice(s, choice.centerId);
      const extra = getServiceOptionsExtra(s, choice.selectedOptions?.[s.id]);
      totalPrice += base + extra.price;
      totalMinutes += s.durationMinutes + extra.minutes;

      const chosenValues = Object.values(choice.selectedOptions?.[s.id] ?? {});
      if (chosenValues.length > 0) {
        names.push(`${s.name} (${chosenValues.join(", ")})`);
      } else {
        names.push(s.name);
      }
    }

    return {
      label: names.join(" + "),
      price: totalPrice,
      minutes: totalMinutes,
    };
  }, [choice, salon]);

  const canNext = [summary.minutes > 0, center.practitioners.length > 0, Boolean(slot), false][step];
  const go = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (done) {
    return <BookingSuccess salon={salon} center={center} summary={summary} done={done} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div>
        {/* Progression */}
        <ol className="mb-6 flex items-center gap-2 animate-fade-up">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                disabled={i > step}
                onClick={() => go(i)}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition-all duration-500 ${
                  i < step ? "bg-emerald-400/20 text-emerald-200" : i === step ? "bg-gradient-to-br from-blush to-champagne text-plum-950 shadow-[0_0_20px_rgb(232_180_160/0.5)]" : "border border-white/15 text-white/40"
                }`}
              >
                {i < step ? <CheckIcon width={14} height={14} /> : i + 1}
              </button>
              <span className={`hidden text-sm sm:inline ${i <= step ? "text-white" : "text-white/40"}`}>{t(s)}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-white/10" />}
            </li>
          ))}
        </ol>

        <div key={step} className="animate-[slide-in-right_0.45s_cubic-bezier(0.16,1,0.3,1)_both] rtl:animate-[slide-in-left_0.45s_cubic-bezier(0.16,1,0.3,1)_both]">
          {step === 0 && <StepServices salon={salon} choice={choice} setChoice={(c) => { setChoice(c); setSlot(null); setAppliedPromo(null); }} />}
          {/* Centre sans praticien (équipe pas encore créée, Module 4) : aucun créneau possible. */}
          {(step === 1 || step === 2) && center.practitioners.length === 0 && (
            <div className="glass rounded-[2rem] p-8 text-center">
              <p className="font-display text-2xl text-white">{t("Réservation en ligne bientôt disponible")}</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
                {t("Ce centre n'a pas encore d'équipe disponible en ligne. Choisissez un autre centre ou contactez directement le salon.")}
              </p>
              <button type="button" onClick={() => go(0)} className="mt-5 rounded-2xl border border-white/15 px-5 py-2.5 text-sm text-white hover:border-rose-gold/50">
                {t("Choisir un autre centre")}
              </button>
            </div>
          )}
          {step === 1 && center.practitioners.length > 0 && <StepStaff center={center} choice={choice} setChoice={(c) => { setChoice(c); setSlot(null); }} />}
          {step === 2 && center.practitioners.length > 0 && <StepSlot salon={salon} choice={choice} selection={selection} day={day} setDay={setDay} slot={slot} setSlot={setSlot} />}
          {step === 3 && slot && (
            <StepDetails
              salon={salon}
              client={client}
              choice={choice}
              selection={selection}
              slot={slot}
              summary={summary}
              appliedPromo={appliedPromo}
              setAppliedPromo={setAppliedPromo}
              viaChatbot={viaChatbot}
              onDone={setDone}
            />
          )}
        </div>

        {step === 0 && summary.minutes > 300 && (
          <p className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 animate-fade-up">
            {t("Sélection très longue")} ({fmtDuration(summary.minutes)}) : {t("il faut un praticien libre sans interruption sur toute la durée. Pour plus de choix, réservez en deux rendez-vous.")}
          </p>
        )}

        {step < 3 && (
          <div className="mt-6 flex gap-3">
            {step > 0 && (
              <button type="button" onClick={() => go(step - 1)} className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 text-white/70 hover:text-white" aria-label={t("Étape précédente")}>
                <ArrowLeftIcon className="rtl:-scale-x-100" />
              </button>
            )}
            <button
              type="button"
              disabled={!canNext}
              onClick={() => go(step + 1)}
              className="btn-shine group flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl font-semibold text-plum-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("Continuer")}
              <ArrowRightIcon className="transition-transform rtl:-scale-x-100 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
            </button>
          </div>
        )}
      </div>

      {/* Récapitulatif */}
      <aside className="glass h-fit rounded-[1.75rem] p-5 lg:sticky lg:top-6 animate-fade-up [animation-delay:0.1s]">
        <p className="text-xs uppercase tracking-wider text-white/40">{t("Votre réservation")}</p>
        <div className="mt-3 space-y-3 text-sm">
          <Row icon={<PinIcon width={16} height={16} />} label={center.name} sub={t(governorateLabel(center.governorate))} />
          <Row icon={<SparkleIcon width={16} height={16} />} label={summary.label || t("Aucune prestation choisie")} sub={summary.minutes ? `${fmtDuration(summary.minutes)} · ${fmtMoney(summary.price, lang)}` : undefined} />
          {step >= 1 && (
            <Row
              icon={<span className="text-xs">✂</span>}
              label={choice.staffId ? center.practitioners.find((p) => p.id === choice.staffId)?.name ?? "" : t("Peu importe le praticien")}
            />
          )}
          {slot && (
            <Row icon={<span className="text-xs">🕐</span>} label={fmtDay(slot.start, lang)} sub={`${fmtTime(slot.start, lang)} – ${fmtTime(slot.end, lang)}`} />
          )}
        </div>
        {summary.price > 0 && (
          <div className="mt-4 border-t border-white/10 pt-3 space-y-1.5">
            {appliedPromo && appliedPromo.discountTnd > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-white/50">
                  <span>{t("Sous-total")}</span>
                  <span>{fmtMoney(summary.price, lang)}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                  <span>{t("Code promo")} ({appliedPromo.code})</span>
                  <span>−{fmtMoney(appliedPromo.discountTnd, lang)}</span>
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-white/60">{t("Total")}</span>
              <span className="font-display text-2xl text-white">
                {fmtMoney(Math.max(0, summary.price - (appliedPromo?.discountTnd ?? 0)), lang)}
              </span>
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-white/40">{t("Paiement en ligne ou au salon. Annulation gratuite jusqu'à 2 h avant.")}</p>
      </aside>

      <BookingChat
        salon={salon}
        onPick={(c, s) => {
          setChoice(c);
          setDay(dayKey(new Date(s.start)));
          setSlot(s);
          setViaChatbot(true);
          go(3);
        }}
      />
    </div>
  );
}

function Row({ icon, label, sub }: { icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/5 text-rose-gold">{icon}</span>
      <div className="min-w-0">
        <p className="text-white first-letter:uppercase">{label}</p>
        {sub && <p className="text-xs text-white/50">{sub}</p>}
      </div>
    </div>
  );
}

// ── Étape 1 : centre et prestations ──
function StepServices({ salon, choice, setChoice }: { salon: PublicSalon; choice: Choice; setChoice: (c: Choice) => void }) {
  const { t, lang } = useI18n();
  const categories = [...new Set(salon.services.map((s) => s.category))];
  const [cat, setCat] = useState(categories[0]);

  return (
    <div className="space-y-5">
      {salon.centers.length > 1 && (
        <div>
          <h2 className="mb-3 font-display text-2xl text-white">{t("Choisissez votre salon")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {salon.centers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChoice({ ...choice, centerId: c.id, staffId: null })}
                className={`group overflow-hidden rounded-2xl border text-start transition ${choice.centerId === c.id ? "border-rose-gold bg-rose-gold/10 shadow-lg shadow-rose-gold/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
              >
                {c.photos && c.photos.length > 0 && (
                  <div className="h-28 w-full overflow-hidden bg-white/5">
                    <img
                      src={c.photos[0]}
                      alt={c.name}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  </div>
                )}
                <div className="p-4">
                  <p className="text-sm font-medium text-white">{c.name}</p>
                  <p className="text-xs text-white/50">{t(governorateLabel(c.governorate))}</p>
                  {c.photos && c.photos.length > 1 && (
                    <span className="mt-2 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
                      {c.photos.length} photos
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {salon.packs.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-2xl text-white">{t("Nos packs")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {salon.packs.map((p) => {
              const active = choice.packId === p.id;
              const packPrice = getPackPrice(p, choice.centerId);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setChoice({ ...choice, packId: active ? null : p.id, serviceIds: [], selectedOptions: {} })}
                  className={`group relative overflow-hidden rounded-2xl border p-4 text-start transition ${active ? "border-champagne bg-champagne/10" : "border-champagne/20 bg-white/[0.03] hover:border-champagne/50"}`}
                >
                  <div className="absolute -end-6 -top-6 h-20 w-20 rounded-full bg-champagne/10 blur-xl" />
                  {/* Badge économies */}
                  {p.savingsTnd && p.savingsTnd > 0 && (
                    <div className="absolute end-3 top-3 flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                      <span>−{p.savingsTnd} DT</span>
                      {p.savingsPercent && p.savingsPercent > 0 && (
                        <span className="text-emerald-300/70">({p.savingsPercent}%)</span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-3">
                    {p.photos && p.photos.length > 0 && (
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10">
                        <img src={p.photos[0]} alt={p.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white">✨ {p.name}</p>
                      <p className="mt-1 line-clamp-1 text-xs text-white/50">{p.serviceNames.join(" · ")}</p>
                      <p className="mt-2 text-sm font-semibold text-champagne">
                        {fmtMoney(packPrice, lang)} · {fmtDuration(p.durationMinutes)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 font-display text-2xl text-white">{t("Ou composez votre moment")}</h2>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full px-4 py-1.5 text-sm transition ${cat === c ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}>
              {t(c)}
            </button>
          ))}
        </div>
        <div className="grid gap-2">
          {salon.services.filter((s) => s.category === cat).map((s) => {
            const active = choice.serviceIds.includes(s.id);
            const extra = getServiceOptionsExtra(s, choice.selectedOptions?.[s.id]);
            const servicePrice = getServiceBasePrice(s, choice.centerId) + extra.price;
            const serviceDuration = s.durationMinutes + extra.minutes;

            return (
              <div
                key={s.id}
                className={`group rounded-2xl border transition overflow-hidden ${
                  active ? "border-rose-gold bg-rose-gold/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                }`}
              >
                <button
                  type="button"
                  disabled={!active && choice.serviceIds.length >= 6}
                  onClick={() => {
                    if (active) {
                      const nextOpts = { ...(choice.selectedOptions ?? {}) };
                      delete nextOpts[s.id];
                      setChoice({
                        ...choice,
                        packId: null,
                        serviceIds: choice.serviceIds.filter((x) => x !== s.id),
                        selectedOptions: nextOpts,
                      });
                    } else {
                      setChoice({
                        ...choice,
                        packId: null,
                        serviceIds: [...choice.serviceIds, s.id],
                      });
                    }
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-start disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {s.photos && s.photos.length > 0 && (
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10">
                        <img src={s.photos[0]} alt={s.name} className="h-full w-full object-cover transition group-hover:scale-105" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-white font-medium">{s.name}</p>
                      {s.description && (
                        <p className="line-clamp-1 text-xs text-white/40">{s.description}</p>
                      )}
                      <p className="text-xs text-white/50">{fmtDuration(serviceDuration)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-white">{fmtMoney(servicePrice, lang)}</span>
                    <span className={`grid h-6 w-6 place-items-center rounded-full border transition ${active ? "border-rose-gold bg-rose-gold text-plum-950" : "border-white/20"}`}>
                      {active && <CheckIcon width={14} height={14} />}
                    </span>
                  </div>
                </button>

                {/* Options si le service est sélectionné et dispose d'options */}
                {active && s.options && s.options.length > 0 && (
                  <div className="border-t border-rose-gold/20 bg-black/25 p-3 space-y-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-gold flex items-center gap-1.5">
                      <SparkleIcon width={12} height={12} />
                      {t("Options & finitions")}
                    </p>
                    {s.options.map((opt) => {
                      const currentSelected = choice.selectedOptions?.[s.id]?.[opt.name];
                      return (
                        <div key={opt.name} className="space-y-1.5">
                          <p className="text-xs font-medium text-white/70">{opt.name}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {opt.values.map((val) => {
                              const isValSelected = currentSelected === val.label;
                              return (
                                <button
                                  key={val.label}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const serviceMap = { ...(choice.selectedOptions?.[s.id] ?? {}) };
                                    if (isValSelected) {
                                      delete serviceMap[opt.name];
                                    } else {
                                      serviceMap[opt.name] = val.label;
                                    }
                                    const updatedSelectedOptions = {
                                      ...(choice.selectedOptions ?? {}),
                                      [s.id]: serviceMap,
                                    };
                                    setChoice({ ...choice, selectedOptions: updatedSelectedOptions });
                                  }}
                                  className={`rounded-lg px-2.5 py-1 text-xs transition border flex items-center gap-1.5 ${
                                    isValSelected
                                      ? "border-rose-gold bg-gradient-to-r from-rose-gold/30 to-champagne/20 font-semibold text-white shadow-sm ring-1 ring-rose-gold/40"
                                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
                                  }`}
                                >
                                  <span>{val.label}</span>
                                  {(val.extraPriceTnd > 0 || val.extraDurationMinutes > 0) && (
                                    <span className="text-[10px] text-champagne/90">
                                      {val.extraPriceTnd > 0 && `+${val.extraPriceTnd} DT`}
                                      {val.extraPriceTnd > 0 && val.extraDurationMinutes > 0 && " · "}
                                      {val.extraDurationMinutes > 0 && `+${val.extraDurationMinutes} min`}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {choice.serviceIds.length >= 6 && (
          <p className="mt-3 text-sm text-amber-200">{t("6 prestations maximum par rendez-vous.")}</p>
        )}
      </div>
    </div>
  );
}

// ── Étape 2 : praticien ──
function StepStaff({ center, choice, setChoice }: { center: PublicSalon["centers"][number]; choice: Choice; setChoice: (c: Choice) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <h2 className="mb-3 font-display text-2xl text-white">{t("Avec qui ?")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ id: null, name: t("Peu importe"), hint: t("Premier praticien disponible") }, ...center.practitioners.map((p) => ({ id: p.id, name: p.name, hint: "" }))].map((o) => {
          const active = choice.staffId === o.id;
          return (
            <button
              key={o.id ?? "any"}
              type="button"
              onClick={() => setChoice({ ...choice, staffId: o.id })}
              className={`flex flex-col items-center gap-3 rounded-2xl border p-5 text-center transition ${active ? "border-rose-gold bg-rose-gold/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
            >
              <span className={`grid h-14 w-14 place-items-center rounded-full font-display text-xl ${o.id ? "bg-gradient-to-br from-blush to-champagne text-plum-950" : "border border-dashed border-white/30 text-white/60"}`}>
                {o.id ? o.name[0] : "✦"}
              </span>
              <span className="text-sm font-medium text-white">{o.name}</span>
              {o.hint && <span className="-mt-2 text-xs text-white/45">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Étape 3 : jour et créneau ──
function StepSlot({
  salon,
  choice,
  selection,
  day,
  setDay,
  slot,
  setSlot,
}: {
  salon: PublicSalon;
  choice: Choice;
  selection: { serviceIds: string[]; packId: string | null; selectedOptions?: Record<string, Record<string, string>> };
  day: string;
  setDay: (d: string) => void;
  slot: Slot | null;
  setSlot: (s: Slot | null) => void;
}) {
  const { t, lang } = useI18n();
  const todayKey = dayKey(new Date());
  const [month, setMonth] = useState(day.slice(0, 7)); // YYYY-MM affiché
  const [availability, setAvailability] = useState<{ month: string; counts: Record<string, number> } | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loading, startLoading] = useTransition();
  const [waitlist, setWaitlist] = useState({ open: false, firstName: "", lastName: "", phone: "", sent: false, error: "" });
  const selectionKey = JSON.stringify(selection);

  // Mois navigables : du mois courant jusqu'à 12 mois plus tard.
  const firstMonth = todayKey.slice(0, 7);
  const lastMonth = dayKey(addDays(new Date(), 365)).slice(0, 7);
  const shiftMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  // Grille du mois : du lundi précédant le 1er au dimanche suivant la fin du mois.
  const grid = useMemo(() => {
    const first = parseDayKey(`${month}-01`)!;
    const start = addDays(first, -((toLocal(first).weekday + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    getPublicMonthAvailability({ slug: salon.slug, centerId: choice.centerId, selection, staffId: choice.staffId, month }).then((r) => {
      if (cancelled) return;
      setAvailability({ month, counts: r.counts });
      // Jour choisi complet : on sélectionne le premier jour disponible du mois affiché.
      if (day.startsWith(month) && !r.counts[day]) {
        const firstFree = Object.keys(r.counts).sort().find((k) => r.counts[k] > 0);
        if (firstFree) {
          setDay(firstFree);
          setSlot(null);
        }
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salon.slug, choice.centerId, choice.staffId, selectionKey, month]);

  useEffect(() => {
    let cancelled = false;
    startLoading(async () => {
      const r = await getPublicSlots({ slug: salon.slug, centerId: choice.centerId, selection, staffId: choice.staffId, day });
      if (!cancelled) setSlots(r.slots);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salon.slug, choice.centerId, choice.staffId, selectionKey, day]);

  const counts = availability?.month === month ? availability.counts : null;
  const monthHasSlots = counts ? Object.values(counts).some((n) => n > 0) : true;

  const groups = [
    { label: "Matin", list: (slots ?? []).filter((s) => toLocal(new Date(s.start)).hour < 12) },
    { label: "Après-midi", list: (slots ?? []).filter((s) => toLocal(new Date(s.start)).hour >= 12 && toLocal(new Date(s.start)).hour < 17) },
    { label: "Soir", list: (slots ?? []).filter((s) => toLocal(new Date(s.start)).hour >= 17) },
  ].filter((g) => g.list.length);

  return (
    <div>
      <h2 className="mb-3 font-display text-2xl text-white">{t("Quand ?")}</h2>

      {/* Calendrier mensuel, jusqu'à 12 mois à l'avance */}
      <div className="glass rounded-[1.5rem] p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={month <= firstMonth}
            aria-label={t("Mois précédent")}
            className="grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 disabled:opacity-25"
          >
            <ArrowLeftIcon width={18} height={18} className="rtl:-scale-x-100" />
          </button>
          <p className="font-display text-xl capitalize text-white">{fmtDay(`${month}-15T12:00:00Z`, lang, { month: "long", year: "numeric" })}</p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={month >= lastMonth}
            aria-label={t("Mois suivant")}
            className="grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 disabled:opacity-25"
          >
            <ArrowRightIcon width={18} height={18} className="rtl:-scale-x-100" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {grid.slice(0, 7).map((d) => (
            <span key={dayKey(d)} className="pb-1 text-[11px] uppercase text-white/40">
              {fmtDay(d, lang, { weekday: "short" })}
            </span>
          ))}
          {grid.map((d) => {
            const key = dayKey(d);
            const inMonth = key.startsWith(month);
            const count = counts?.[key] ?? 0;
            const past = key < todayKey;
            const disabled = !inMonth || past || (counts !== null && count === 0);
            const active = key === day;
            return (
              <button
                key={key}
                type="button"
                disabled={!inMonth || past}
                onClick={() => {
                  setDay(key);
                  setSlot(null);
                }}
                className={`relative flex h-12 flex-col items-center justify-center rounded-xl text-sm transition ${
                  !inMonth ? "invisible" : active ? "bg-gradient-to-br from-blush to-champagne font-semibold text-plum-950" : disabled ? "text-white/25" : "text-white hover:bg-white/10"
                }`}
              >
                {toLocal(d).day}
                {inMonth && !past && (
                  <span
                    className={`absolute bottom-1.5 h-1 w-1 rounded-full ${
                      active ? "bg-plum-950/50" : counts === null ? "bg-white/15" : count === 0 ? "bg-transparent" : count > 10 ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-white/45">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {t("Beaucoup de créneaux")}</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {t("Peu de créneaux")}</span>
          <span className="flex items-center gap-1.5"><span className="text-white/25">12</span> {t("Complet ou fermé")}</span>
        </div>
        {counts !== null && !monthHasSlots && (
          <p className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            {t("Aucun créneau assez long ce mois-ci pour cette sélection. Essayez le mois suivant, un autre praticien ou moins de prestations.")}
          </p>
        )}
      </div>

      <p className="mb-2 mt-5 text-sm capitalize text-white/70">{fmtDay(`${day}T12:00:00Z`, lang)}</p>
      <div className="min-h-48">
        {loading || slots === null ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-white/5" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center">
            <p className="text-white/70">{t("Plus aucun créneau ce jour-là.")}</p>
            {!waitlist.sent ? (
              waitlist.open ? (
                <div className="mx-auto mt-4 grid max-w-md gap-2 sm:grid-cols-3">
                  <input placeholder={t("Prénom")} value={waitlist.firstName} onChange={(e) => setWaitlist({ ...waitlist, firstName: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
                  <input placeholder={t("Nom")} value={waitlist.lastName} onChange={(e) => setWaitlist({ ...waitlist, lastName: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
                  <input placeholder={t("Téléphone")} dir="ltr" value={waitlist.phone} onChange={(e) => setWaitlist({ ...waitlist, phone: e.target.value })} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" />
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await joinPublicWaitlist({
                        slug: salon.slug,
                        centerId: choice.centerId,
                        serviceId: selection.serviceIds[0] ?? salon.packs.find((p) => p.id === selection.packId)?.serviceIds[0] ?? "",
                        day,
                        ...waitlist,
                      });
                      setWaitlist({ ...waitlist, sent: !r.error, error: r.error ?? "" });
                    }}
                    className="btn-shine rounded-xl py-2 text-sm font-semibold text-plum-950 sm:col-span-3"
                  >
                    {t("Me prévenir si une place se libère")}
                  </button>
                  {waitlist.error && <p className="text-sm text-red-300 sm:col-span-3">{t(waitlist.error)}</p>}
                </div>
              ) : (
                <button type="button" onClick={() => setWaitlist({ ...waitlist, open: true })} className="mt-3 text-sm text-rose-gold underline-offset-4 hover:underline">
                  {t("Rejoindre la liste d'attente")}
                </button>
              )
            ) : (
              <p className="mt-3 text-sm text-emerald-300">{t("C'est noté ! Nous vous prévenons dès qu'une place se libère.")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t(g.label)}</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {g.list.map((s, i) => {
                    const active = slot?.start === s.start;
                    return (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => setSlot(s)}
                        className={`rounded-xl border py-2.5 text-sm transition animate-fade-up ${active ? "border-rose-gold bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950" : "border-white/10 bg-white/[0.04] text-white hover:border-white/30"}`}
                        style={{ animationDelay: `${Math.min(i, 12) * 0.02}s` }}
                        dir="ltr"
                      >
                        {fmtTime(s.start, lang)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Étape 4 : coordonnées et confirmation ──
function StepDetails({
  salon,
  client,
  choice,
  selection,
  slot,
  summary,
  appliedPromo,
  setAppliedPromo,
  viaChatbot,
  onDone,
}: {
  salon: PublicSalon;
  client: BookingClient;
  choice: Choice;
  selection: { serviceIds: string[]; packId: string | null; selectedOptions?: Record<string, Record<string, string>> };
  slot: Slot;
  summary: { label: string; price: number; minutes: number };
  appliedPromo: AppliedPromo | null;
  setAppliedPromo: (p: AppliedPromo | null) => void;
  viaChatbot: boolean;
  onDone: (d: BookingDone) => void;
}) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState({ notes: "", remindersConsent: true, website: "" });
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [promoInput, setPromoInput] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoChecking, startPromoTransition] = useTransition();

  const handleApplyPromo = () => {
    const raw = promoInput.trim().toUpperCase();
    if (!raw) return setPromoError(t("Veuillez saisir un code promo."));
    setPromoError(null);
    startPromoTransition(async () => {
      const res = await validatePromoCodeAction({
        slug: salon.slug,
        centerId: choice.centerId,
        code: raw,
        selection,
      });
      if (res.ok) {
        setAppliedPromo(res);
        setPromoInput("");
      } else {
        setPromoError(res.error);
      }
    });
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    setPromoError(null);
  };

  const field = "w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3.5 text-white outline-none transition placeholder:text-white/35 focus:border-rose-gold/60";

  // Adresse de retour après connexion / inscription : la réservation en cours y est encodée.
  const resume = `/reserver/${salon.slug}?reprise=${encodeDraft({
    centerId: choice.centerId,
    serviceIds: choice.serviceIds,
    packId: choice.packId,
    staffId: choice.staffId,
    selectedOptions: choice.selectedOptions,
    slot,
    viaChatbot,
  })}`;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await createOnlineBooking({
        slug: salon.slug,
        centerId: choice.centerId,
        selection,
        staffId: choice.staffId,
        start: slot.start,
        promoCode: appliedPromo?.code,
        viaChatbot,
        ...form,
      });
      if (r.ok) onDone({ bookingId: r.bookingId, start: r.start, manageUrl: r.manageUrl, staffName: r.staffName, totalTnd: r.totalTnd });
      else setError({ text: r.error, field: r.field });
    });
  };

  return (
    <div>
      <h2 className="mb-3 font-display text-2xl text-white">{t("Confirmation")}</h2>
      <AccountPanel client={client} resume={resume} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <textarea className={`${field} sm:col-span-2`} rows={2} placeholder={t("Une précision pour le salon ? (facultatif)")} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {/* Piège à robots : champ invisible pour les humains */}
        <input tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      </div>

      {/* Code promo */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <SparkleIcon width={16} height={16} className="text-champagne" />
          <span className="text-sm font-medium text-white">{t("Code promo")}</span>
        </div>

        {appliedPromo ? (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckIcon width={16} height={16} className="text-emerald-400" />
              <span>
                <strong>{appliedPromo.code}</strong> : −{fmtMoney(appliedPromo.discountTnd, lang)}{" "}
                <span className="text-xs text-emerald-400/70">({appliedPromo.name})</span>
              </span>
            </div>
            <button
              type="button"
              onClick={handleRemovePromo}
              className="text-xs text-white/50 hover:text-white transition underline underline-offset-2"
            >
              {t("Retirer")}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white uppercase placeholder:normal-case placeholder:text-white/35 outline-none focus:border-rose-gold/60"
              placeholder={t("Code promo (facultatif)")}
              value={promoInput}
              onChange={(e) => {
                setPromoInput(e.target.value);
                if (promoError) setPromoError(null);
              }}
            />
            <button
              type="button"
              disabled={promoChecking || !promoInput.trim()}
              onClick={handleApplyPromo}
              className="rounded-xl bg-white/15 px-4 py-2 text-xs font-semibold text-white hover:bg-white/25 transition disabled:opacity-40"
            >
              {promoChecking ? "…" : t("Appliquer")}
            </button>
          </div>
        )}

        {promoError && (
          <p className="text-xs text-red-300 animate-shake">{t(promoError)}</p>
        )}

        {appliedPromo && (
          <div className="flex items-center justify-between border-t border-white/10 pt-2 text-sm">
            <span className="text-white/60">{t("Total après réduction")}</span>
            <span className="font-display text-lg text-emerald-300 font-bold">
              {fmtMoney(Math.max(0, summary.price - appliedPromo.discountTnd), lang)}
            </span>
          </div>
        )}
      </div>

      <label className="mt-4 flex items-start gap-3 text-sm text-white/70">
        <input type="checkbox" checked={form.remindersConsent} onChange={(e) => setForm({ ...form, remindersConsent: e.target.checked })} className="mt-1 accent-rose-gold" />
        {t("J'accepte de recevoir la confirmation et un rappel par WhatsApp ou SMS.")}
      </label>
      {error && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200 animate-shake">{t(error.text)}</p>}
      {client?.kind === "client" ? (
        <button type="button" disabled={pending} onClick={submit} className="btn-shine mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-plum-950 disabled:opacity-70">
          {pending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-plum-950/30 border-t-plum-950" /> : <CheckIcon />}
          {t("Confirmer ma réservation")}
        </button>
      ) : client === null ? (
        <a href={`/login?next=${encodeURIComponent(resume)}`} className="btn-shine mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-plum-950">
          {t("Se connecter pour confirmer")}
        </a>
      ) : null}
    </div>
  );
}

// Compte utilisé pour la réservation : client connecté, invitation à se connecter, ou compte salon.
function AccountPanel({ client, resume }: { client: BookingClient; resume: string }) {
  const { t } = useI18n();
  if (client?.kind === "client") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] px-4 py-3.5">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-blush to-champagne font-semibold text-plum-950">
          {client.firstName[0]}
          {client.lastName[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white">
            {t("Réservé au nom de")} <strong>{client.firstName} {client.lastName}</strong>
          </p>
          <p className="truncate text-xs text-white/55" dir="ltr">
            {client.phone ? `+216 ${client.phone}` : ""}
            {client.email ? ` · ${client.email}` : ""}
          </p>
        </div>
      </div>
    );
  }
  if (client?.kind === "staff") {
    return (
      <p className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3.5 text-sm text-amber-100">
        {t("Vous êtes connecté avec un compte salon. Pour réserver comme client, déconnectez-vous puis connectez-vous avec un compte client.")}
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-rose-gold/30 bg-rose-gold/[0.08] p-5">
      <p className="font-medium text-white">{t("Plus qu'une étape : votre compte client")}</p>
      <p className="mt-1 text-sm text-white/60">
        {t("Votre créneau est prêt. Connectez-vous ou créez votre compte pour confirmer, payer en ligne et retrouver vos rendez-vous.")}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <a href={`/register?type=client&next=${encodeURIComponent(resume)}`} className="btn-shine rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-plum-950">
          {t("Créer mon compte")}
        </a>
        <a href={`/login?next=${encodeURIComponent(resume)}`} className="rounded-xl border border-white/15 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:border-white/30">
          {t("J'ai déjà un compte")}
        </a>
      </div>
    </div>
  );
}
