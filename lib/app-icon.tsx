import { ImageResponse } from "next/og";

// Icône de l'application (ciseaux sur dégradé or rose), générée en PNG.
export function appIcon(size: number, { maskable = false, rounded = true } = {}) {
  const inner = maskable ? size * 0.6 : size * 0.78;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: maskable ? "#e8b4a0" : "transparent",
        }}
      >
        <div
          style={{
            width: inner,
            height: inner,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: maskable || !rounded ? 0 : inner * 0.24,
            background: "linear-gradient(135deg, #f7c6d0, #e8b4a0 50%, #f3d9a4)",
          }}
        >
          <svg width={inner * 0.6} height={inner * 0.6} viewBox="0 0 32 32" fill="none" stroke="#2a0f25" strokeWidth={2.4} strokeLinecap="round">
            <circle cx="9" cy="23" r="4" />
            <circle cx="23" cy="23" r="4" />
            <path d="M11.5 20 24 5" />
            <path d="M20.5 20 8 5" />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
