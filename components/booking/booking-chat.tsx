"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { sendChatMessage } from "@/app/actions/chatbot";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ArrowRightIcon, SparkleIcon } from "@/components/ui/icons";
import type { Slot } from "@/lib/booking/availability";
import type { ChatProposal } from "@/lib/booking/chatbot";
import { fmtDay, fmtTime } from "@/lib/booking/format";
import type { PublicSalon } from "@/lib/data/public-salon";
import type { Choice } from "./booking-wizard";

type Bubble = { role: "user" | "assistant"; text: string; chips?: string[]; proposals?: ChatProposal[]; source?: "ai" | "offline" };

// IA Module 3 — Chatbot de réservation : « un brushing demain vers 15h à Sousse ».
export function BookingChat({ salon, onPick }: { salon: PublicSalon; onPick: (c: Choice, s: Slot) => void }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const welcome = t("Bonjour ! Dites-moi ce que vous souhaitez, par exemple « un brushing demain vers 15h ».");

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [bubbles, pending]);

  function send(text: string) {
    const clean = text.trim();
    if (!clean || pending) return;
    const next: Bubble[] = [...bubbles, { role: "user", text: clean }];
    setBubbles(next);
    setInput("");
    startTransition(async () => {
      const reply = await sendChatMessage(
        salon.slug,
        next.slice(-12).map((b) => ({ role: b.role, text: b.text || "…" })),
      );
      setBubbles((b) => [...b, { role: "assistant", text: reply.text, chips: reply.chips, proposals: reply.proposals, source: reply.source }]);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group fixed bottom-5 end-5 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-[#c9a0dc] via-blush to-champagne py-3 pe-5 ps-4 font-semibold text-plum-950 shadow-[0_12px_40px_-8px_rgb(201_160_220/0.8)] transition hover:scale-105"
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-full bg-plum-950/15">
          <SparkleIcon width={16} height={16} className="transition-transform duration-700 group-hover:rotate-180" />
          {!open && <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-white" />}
        </span>
        {open ? t("Fermer") : t("Réserver par message")}
      </button>

      {open && (
        <div className="glass fixed bottom-24 end-5 z-50 flex h-[min(560px,calc(100dvh-8rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[1.75rem] animate-fade-up">
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-[#c9a0dc] to-blush text-plum-950">
              <SparkleIcon width={18} height={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-white">{t("Assistant de réservation")}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {t("Répond instantanément · FR / العربية")}
              </p>
            </div>
          </div>

          <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <Assistant text={welcome} />
            {bubbles.length === 0 && (
              <Chips
                items={lang === "ar" ? ["تصفيف غدا في الصباح", "مكياج يوم السبت"] : ["Un brushing demain vers 15h", "Manucure samedi matin", "Pack Mariée"]}
                onPick={send}
              />
            )}
            {bubbles.map((b, i) =>
              b.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-ee-md bg-gradient-to-r from-blush to-champagne px-4 py-2.5 text-sm text-plum-950" dir="auto">
                    {b.text}
                  </p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {b.text && <Assistant text={b.text} />}
                  {b.proposals && b.proposals.length > 0 && (
                    <div className="space-y-2 ps-1">
                      {b.proposals.map((p) => (
                        <button
                          key={p.slot.start}
                          type="button"
                          onClick={() => {
                            onPick({ centerId: p.centerId, serviceIds: p.serviceIds, packId: p.packId, staffId: p.staffId }, p.slot);
                            setOpen(false);
                          }}
                          className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-champagne/30 bg-champagne/10 px-4 py-3 text-start transition hover:border-champagne/60 animate-fade-up"
                        >
                          <div>
                            <p className="text-sm font-medium capitalize text-white">{fmtDay(p.slot.start, lang, { weekday: "long", day: "numeric", month: "short" })}</p>
                            <p className="text-xs text-white/60">
                              <span dir="ltr">{fmtTime(p.slot.start, lang)}</span> · {p.label.split(" · ")[0]}
                            </p>
                          </div>
                          <span className="flex items-center gap-1 text-xs font-semibold text-champagne">
                            {t("Choisir")} <ArrowRightIcon width={14} height={14} className="rtl:-scale-x-100" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {b.chips && <Chips items={b.chips} onPick={send} />}
                  {b.source === "offline" && i === bubbles.length - 1 && (
                    <p className="ps-1 text-[10px] text-white/30">{t("Mode hors ligne (sans IA)")}</p>
                  )}
                </div>
              ),
            )}
            {pending && (
              <div className="flex w-16 items-center justify-center gap-1 rounded-2xl rounded-ss-md bg-white/10 px-4 py-3">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/70" style={{ animationDelay: `${d * 0.15}s` }} />
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-white/10 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("Écrivez votre demande…")}
              dir="auto"
              maxLength={600}
              className="flex-1 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-rose-gold/60"
            />
            <button type="submit" disabled={pending || !input.trim()} aria-label={t("Envoyer")} className="btn-shine grid h-11 w-11 place-items-center rounded-2xl text-plum-950 disabled:opacity-50">
              <ArrowRightIcon width={18} height={18} className="rtl:-scale-x-100" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Assistant({ text }: { text: string }) {
  return (
    <p className="max-w-[90%] whitespace-pre-line rounded-2xl rounded-ss-md bg-white/10 px-4 py-2.5 text-sm text-white" dir="auto">
      {text}
    </p>
  );
}

function Chips({ items, onPick }: { items: string[]; onPick: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 ps-1">
      {items.map((c) => (
        <button key={c} type="button" onClick={() => onPick(c)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/80 transition hover:border-rose-gold/50 hover:text-white" dir="auto">
          {c}
        </button>
      ))}
    </div>
  );
}
