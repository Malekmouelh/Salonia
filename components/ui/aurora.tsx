// Fond animé : halos colorés qui dérivent lentement + étincelles.
const SPARKLES = [
  { top: "12%", left: "18%", delay: "0s", size: 10 },
  { top: "28%", left: "82%", delay: "1.2s", size: 14 },
  { top: "64%", left: "8%", delay: "2.1s", size: 8 },
  { top: "78%", left: "70%", delay: "0.6s", size: 12 },
  { top: "45%", left: "48%", delay: "1.8s", size: 6 },
  { top: "88%", left: "30%", delay: "2.6s", size: 10 },
  { top: "8%", left: "60%", delay: "0.9s", size: 8 },
];

export function Aurora({ sparkles = true }: { sparkles?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(61_22_54)_0%,rgb(18_7_15)_60%)]" />
      <div className="absolute -top-1/4 -left-1/4 h-[70vmax] w-[70vmax] animate-aurora rounded-full bg-[radial-gradient(circle,rgb(232_120_160/0.35),transparent_60%)] blur-3xl" />
      <div
        className="absolute -right-1/4 top-1/4 h-[60vmax] w-[60vmax] animate-aurora rounded-full bg-[radial-gradient(circle,rgb(243_217_164/0.22),transparent_60%)] blur-3xl"
        style={{ animationDelay: "-6s", animationDuration: "22s" }}
      />
      <div
        className="absolute -bottom-1/3 left-1/4 h-[55vmax] w-[55vmax] animate-aurora rounded-full bg-[radial-gradient(circle,rgb(140_70_200/0.25),transparent_60%)] blur-3xl"
        style={{ animationDelay: "-12s", animationDuration: "26s" }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      {sparkles &&
        SPARKLES.map((s, i) => (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="absolute animate-twinkle text-champagne"
            style={{ top: s.top, left: s.left, width: s.size, height: s.size, animationDelay: s.delay }}
          >
            <path fill="currentColor" d="M12 0c.6 6 3 9 12 12-9 3-11.4 6-12 12-.6-6-3-9-12-12 9-3 11.4-6 12-12Z" />
          </svg>
        ))}
    </div>
  );
}
