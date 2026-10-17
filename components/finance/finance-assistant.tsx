"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askFinanceAssistantAction } from "@/app/actions/finance";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";
import type { Anomaly } from "@/lib/finance/analytics";

// IA Module 6 — Assistant d'analyse : poser une question sur ses chiffres.

type Message = { role: "user" | "assistant"; text: string; consulted?: string[]; source?: "ai" | "offline" };

const SUGGESTIONS = [
  "Quel est mon chiffre d'affaires ce mois-ci ?",
  "Quel centre est le plus rentable ce mois-ci ?",
  "Quelles prestations se vendent le mieux ce trimestre ?",
  "Combien vais-je encaisser d'ici la fin du mois ?",
  "Y a-t-il des anomalies à surveiller ?",
  "Comment évoluent mes dépenses le mois dernier ?",
];

// Gras **…** et listes « - » : le reste est affiché tel quel (aucun HTML interprété).
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? <strong key={j} className="font-semibold text-white">{part.slice(2, -2)}</strong> : part,
        );
        return line.trim() === "" ? <br key={i} /> : <p key={i} className={/^\s*[-•]\s/.test(line) ? "ps-3" : ""}>{parts}</p>;
      })}
    </>
  );
}

export function FinanceAssistant({ centerId }: { centerId: string }) {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, pending]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    const next: Message[] = [...messages, { role: "user", text: q }];
    setMessages(next);
    setInput("");
    setError(null);
    startTransition(async () => {
      const reply = await askFinanceAssistantAction({ centerId, messages: next.map(({ role, text }) => ({ role, text })) });
      if ("error" in reply) {
        setError(reply.error);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", text: reply.text, consulted: reply.consulted, source: reply.source }]);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[26rem] min-h-40 flex-1 space-y-3 overflow-y-auto pe-1" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {(lang === "ar"
              ? ["كم مداخيل هذا الشهر؟", "أي فرع هو الأكثر ربحًا؟", "ما هي الخدمات الأكثر مبيعًا؟", "كم سأحصّل حتى آخر الشهر؟"]
              : SUGGESTIONS
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-start text-xs text-white/70 transition hover:border-rose-gold/40 hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={`max-w-[90%] space-y-1 rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "bg-gradient-to-r from-blush to-champagne text-plum-950" : "bg-white/[0.06] text-white/85"
              }`}
            >
              <Rich text={m.text} />
              {m.consulted && m.consulted.length > 0 && (
                <p className="pt-1 text-[11px] text-white/40">
                  {t("Données consultées")} : {m.consulted.map((c) => t(c)).join(", ")}
                  {m.source === "offline" && ` · ${t("mode hors ligne")}`}
                </p>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <SparkleIcon className="h-4 w-4 animate-spin-slow text-champagne" /> {t("Analyse de vos chiffres…")}
          </div>
        )}
        {error && <p className="text-sm text-red-300">{t(error)}</p>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
          placeholder={t("Posez une question sur vos chiffres…")}
          aria-label={t("Question pour l'assistant financier")}
          className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-rose-gold/60"
        />
        <button type="submit" disabled={pending || !input.trim()} className="btn-shine rounded-2xl px-5 text-sm font-semibold text-plum-950 disabled:opacity-50">
          {t("Demander")}
        </button>
      </form>
      <p className="mt-2 text-[11px] text-white/35">{t("L'IA consulte vos chiffres en lecture seule et ne modifie aucune donnée.")}</p>
    </div>
  );
}

export function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  const { t } = useI18n();
  if (anomalies.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
        <span aria-hidden>✓</span> {t("Aucune anomalie détectée sur les dernières semaines.")}
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {anomalies.map((a) => (
        <li key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-medium text-white">
            <span
              className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                a.severity === "high" ? "bg-red-400/15 text-red-200" : "bg-amber-400/15 text-amber-200"
              }`}
            >
              {a.severity === "high" ? `⚠ ${t("Important")}` : `! ${t("À surveiller")}`}
            </span>
            {a.title}
          </p>
          <p className="mt-1 text-xs text-white/55">{a.detail}</p>
        </li>
      ))}
    </ul>
  );
}
