"use client";

import type { PointerEvent, ReactNode } from "react";

// Carte en verre avec halo qui suit le pointeur et bordure lumineuse animée.
export function AuthCard({ title, subtitle, children }: { title: ReactNode; subtitle: ReactNode; children: ReactNode }) {
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }

  return (
    <div
      onPointerMove={onPointerMove}
      className="glass glow-border relative w-full max-w-[460px] rounded-[2rem] p-7 animate-fade-up sm:p-10"
    >
      <div className="spotlight pointer-events-none absolute inset-0 rounded-[2rem]" />
      <div className="relative">
        <h2 className="font-display text-3xl text-white sm:text-[2.1rem] animate-fade-up [animation-delay:0.1s]">{title}</h2>
        <p className="mt-2 text-[15px] text-white/55 animate-fade-up [animation-delay:0.18s]">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
