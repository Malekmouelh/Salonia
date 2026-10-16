"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/i18n/i18n-provider";

// Fenêtre modale (ou panneau latéral) accessible : Échap pour fermer, focus piégé, fond flouté.
export function Modal({
  open,
  onClose,
  title,
  children,
  side = false,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  side?: boolean;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex" role="dialog" aria-modal="true">
      <button aria-label={t("Fermer")} onClick={onClose} className="absolute inset-0 bg-ink/70 backdrop-blur-sm animate-[fade-up_0.3s_ease_both]" />
      <div
        ref={panel}
        className={
          side
            ? "relative ms-auto flex h-full w-full max-w-md flex-col overflow-y-auto border-s border-white/10 bg-plum-950/95 p-6 shadow-2xl animate-[slide-in-right_0.35s_cubic-bezier(0.16,1,0.3,1)_both] rtl:animate-[slide-in-left_0.35s_cubic-bezier(0.16,1,0.3,1)_both]"
            : `relative m-auto max-h-[92dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-[2rem] border border-white/10 bg-plum-950/95 p-6 shadow-2xl animate-fade-up sm:p-8 ${wide ? "max-w-2xl" : "max-w-lg"}`
        }
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t("Fermer")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-white/60 transition hover:rotate-90 hover:text-white"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// Petite notification éphémère (succès / erreur) en bas de l'écran.
export function Toast({ tone, children, onDone }: { tone: "success" | "error"; children: ReactNode; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 4500);
    return () => clearTimeout(id);
  }, [onDone]);
  return createPortal(
    <div role="status" className="fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4 animate-fade-up">
      <div
        className={`max-w-md rounded-2xl border px-5 py-3 text-sm shadow-2xl backdrop-blur ${
          tone === "success" ? "border-emerald-400/30 bg-emerald-950/90 text-emerald-100" : "border-red-400/30 bg-red-950/90 text-red-100"
        }`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
