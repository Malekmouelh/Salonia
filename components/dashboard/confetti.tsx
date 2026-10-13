"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

const COLORS = ["#f7c6d0", "#e8b4a0", "#f3d9a4", "#d4a656", "#c9a0dc", "#ffffff"];

// Pluie de confettis après la création d'un salon (?welcome=1).
export function Confetti() {
  const welcome = useSearchParams().get("welcome");
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 13) % 20) / 10,
        duration: 2.8 + ((i * 7) % 15) / 10,
        drift: ((i * 29) % 160) - 80,
        spin: 360 + ((i * 53) % 720),
        color: COLORS[i % COLORS.length],
        w: 6 + (i % 4) * 2,
        round: i % 3 === 0,
      })),
    [],
  );
  if (!welcome) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.round ? p.w : p.w * 1.6,
            borderRadius: p.round ? "50%" : 2,
            background: p.color,
            ["--drift" as string]: `${p.drift}px`,
            ["--spin" as string]: `${p.spin}deg`,
            animation: `confetti-fall ${p.duration}s ${p.delay}s cubic-bezier(0.25,0.6,0.5,1) forwards`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}
