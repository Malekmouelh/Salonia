"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/finance-assistant.tsx — L'INTERFACE DES FONCTIONS IA
// ═══════════════════════════════════════════════════════════════════════════
// Deux composants :
//   • FinanceAssistant : la fenêtre de DISCUSSION avec l'assistant d'analyse (type chat).
//       → envoie la question à la Server Action `askFinanceAssistantAction` (app/actions/finance.ts),
//         qui appelle lib/finance/assistant.ts (Claude, ou le moteur par mots-clés).
//   • AnomalyList : la liste des ALERTES détectées par l'IA statistique (lib/finance/analytics.ts).
//
// CE FICHIER NE FAIT AUCUN CALCUL : il affiche et transmet. Toute l'intelligence est côté serveur
// (la clé d'API de l'IA ne doit JAMAIS être exposée au navigateur).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from "react";
import { askFinanceAssistantAction } from "@/app/actions/finance";
import { useI18n } from "@/components/i18n/i18n-provider";
import { SparkleIcon } from "@/components/ui/icons";
import type { Anomaly } from "@/lib/finance/analytics";

// IA Module 6 — Assistant d'analyse : poser une question sur ses chiffres.

// Un message de la conversation affichée. `consulted` et `source` ne concernent que les réponses de l'assistant.
type Message = { role: "user" | "assistant"; text: string; consulted?: string[]; source?: "ai" | "offline" };

// Questions suggérées (boutons) affichées tant que la conversation est vide : aide l'utilisateur à démarrer.
const SUGGESTIONS = [
  "Quel est mon chiffre d'affaires ce mois-ci ?",
  "Quel centre est le plus rentable ce mois-ci ?",
  "Quelles prestations se vendent le mieux ce trimestre ?",
  "Combien vais-je encaisser d'ici la fin du mois ?",
  "Y a-t-il des anomalies à surveiller ?",
  "Comment évoluent mes dépenses le mois dernier ?",
];

// Gras **…** et listes « - » : le reste est affiché tel quel (aucun HTML interprété).
// SÉCURITÉ : la réponse de l'IA est traitée comme du TEXTE, jamais comme du HTML (on ne met pas
// `dangerouslySetInnerHTML`), donc impossible qu'elle injecte du code malveillant dans la page.
function Rich({ text }: { text: string }) {
  return (
    <>
      {/* Une ligne de texte = un paragraphe ; une ligne vide = un saut de ligne. */}
      {text.split("\n").map((line, i) => {
        // `split` avec une expression régulière capturante garde les passages « **gras** » comme éléments à part.
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? <strong key={j} className="font-semibold text-white">{part.slice(2, -2)}</strong> : part,
        );
        // Les lignes de liste (commençant par « - » ou « • ») sont légèrement décalées (`ps-3`).
        return line.trim() === "" ? <br key={i} /> : <p key={i} className={/^\s*[-•]\s/.test(line) ? "ps-3" : ""}>{parts}</p>;
      })}
    </>
  );
}

export function FinanceAssistant({ centerId }: { centerId: string }) {
  const { t, lang } = useI18n();
  // ── L'état du composant (sa « mémoire ») ──
  const [messages, setMessages] = useState<Message[]>([]); // la conversation
  const [input, setInput] = useState(""); // le texte en cours de saisie
  const [error, setError] = useState<string | null>(null); // message d'erreur éventuel
  const [pending, startTransition] = useTransition(); // true pendant que l'IA « réfléchit »
  // `useRef` : une référence vers un élément HTML (ici, un repère invisible en bas de la conversation).
  const end = useRef<HTMLDivElement>(null);

  // `useEffect` : exécute du code APRÈS l'affichage, ici à chaque nouveau message : fait défiler
  // la conversation jusqu'en bas pour voir la dernière réponse.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, pending]);

  // Envoi d'une question.
  const ask = (question: string) => {
    const q = question.trim();
    // Rien à envoyer, ou une réponse est déjà en cours : on ignore (évite les doubles envois).
    if (!q || pending) return;
    // On ajoute la question à la conversation et on vide le champ de saisie.
    const next: Message[] = [...messages, { role: "user", text: q }];
    setMessages(next);
    setInput("");
    setError(null);
    // Appel de la Server Action (code serveur) : on envoie le centre et l'historique de la conversation.
    startTransition(async () => {
      const reply = await askFinanceAssistantAction({ centerId, messages: next.map(({ role, text }) => ({ role, text })) });
      // `"error" in reply` : la réponse est soit une erreur, soit une réponse normale.
      if ("error" in reply) {
        setError(reply.error);
        return;
      }
      // On ajoute la réponse à la conversation (avec la liste des « données consultées »).
      setMessages((m) => [...m, { role: "assistant", text: reply.text, consulted: reply.consulted, source: reply.source }]);
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Zone des messages. `aria-live="polite"` : un lecteur d'écran annonce les nouveaux messages. */}
      <div className="max-h-[26rem] min-h-40 flex-1 space-y-3 overflow-y-auto pe-1" aria-live="polite">
        {/* Conversation vide : boutons de questions suggérées (en arabe ou en français selon la langue). */}
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
        {/* Les messages : ceux de l'utilisateur alignés à droite sur fond doré, ceux de l'assistant à gauche sur fond sombre. */}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={`max-w-[90%] space-y-1 rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user" ? "bg-gradient-to-r from-blush to-champagne text-plum-950" : "bg-white/[0.06] text-white/85"
              }`}
            >
              <Rich text={m.text} />
              {/* Transparence : on montre quelles données l'IA a consultées (et si c'est le mode hors ligne). */}
              {m.consulted && m.consulted.length > 0 && (
                <p className="pt-1 text-[11px] text-white/40">
                  {t("Données consultées")} : {m.consulted.map((c) => t(c)).join(", ")}
                  {m.source === "offline" && ` · ${t("mode hors ligne")}`}
                </p>
              )}
            </div>
          </div>
        ))}
        {/* Indicateur « l'assistant réfléchit » pendant l'appel serveur. */}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <SparkleIcon className="h-4 w-4 animate-spin-slow text-champagne" /> {t("Analyse de vos chiffres…")}
          </div>
        )}
        {error && <p className="text-sm text-red-300">{t(error)}</p>}
        {/* Repère invisible en bas : c'est lui que le défilement automatique vise (voir `end`). */}
        <div ref={end} />
      </div>
      {/* Formulaire de saisie. `e.preventDefault()` empêche le rechargement de la page à l'envoi (comportement par défaut d'un formulaire HTML). */}
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
        {/* Bouton désactivé tant qu'une réponse est en cours ou que le champ est vide. */}
        <button type="submit" disabled={pending || !input.trim()} className="btn-shine rounded-2xl px-5 text-sm font-semibold text-plum-950 disabled:opacity-50">
          {t("Demander")}
        </button>
      </form>
      {/* Rappel du principe du cahier des charges : l'IA propose, elle ne modifie rien. */}
      <p className="mt-2 text-[11px] text-white/35">{t("L'IA consulte vos chiffres en lecture seule et ne modifie aucune donnée.")}</p>
    </div>
  );
}

// Liste des alertes (anomalies) détectées automatiquement. Données calculées par getAnomalies (reports.ts).
export function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  const { t } = useI18n();
  // Aucune anomalie : message rassurant.
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
            {/* Pastille de gravité : couleur ET texte/symbole (⚠ / !) — l'info ne dépend pas que de la couleur. */}
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
