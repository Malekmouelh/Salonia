import { BRAND } from "@/lib/brand";

// Logo : des ciseaux stylisés qui se dessinent à l'apparition.
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="relative inline-grid place-items-center rounded-2xl bg-gradient-to-br from-blush via-rose-gold to-champagne shadow-[0_8px_30px_-6px_rgb(232_160_180/0.7)]"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 32 32"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        stroke="#2a0f25"
        strokeWidth={2.2}
        strokeLinecap="round"
        className="draw"
        aria-hidden
      >
        <circle cx="9" cy="23" r="4" />
        <circle cx="23" cy="23" r="4" />
        <path d="M11.5 20 24 5" />
        <path d="M20.5 20 8 5" />
      </svg>
    </span>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark size={size} />
      <span className="font-display text-2xl font-semibold tracking-tight text-white">
        {BRAND.name}
      </span>
    </span>
  );
}
