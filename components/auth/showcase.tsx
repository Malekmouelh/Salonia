import { Logo } from "@/components/ui/logo";
import { CalendarIcon, PinIcon, SparkleIcon } from "@/components/ui/icons";

// Panneau vitrine (gauche) des pages d'authentification.
export function Showcase() {
  return (
    <div className="relative hidden h-full flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
      <div className="animate-fade-up">
        <Logo size={44} />
      </div>

      <div className="relative z-10 max-w-xl">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-champagne/90 animate-fade-up [animation-delay:0.1s]">
          <SparkleIcon width={14} height={14} /> Propulsé par l&apos;IA
        </p>
        <h1 className="font-display text-5xl leading-[1.08] text-white xl:text-6xl animate-fade-up [animation-delay:0.2s]">
          Votre salon,
          <br />
          <span className="relative inline-block h-[1.15em] overflow-hidden align-bottom">
            <span className="flex animate-[rotate-words_10s_cubic-bezier(0.7,0,0.3,1)_infinite] flex-col italic">
              <span className="text-gradient h-[1.15em]">sublimé.</span>
              <span className="text-gradient h-[1.15em]">organisé.</span>
              <span className="text-gradient h-[1.15em]">rentable.</span>
              <span className="text-gradient h-[1.15em]">connecté.</span>
            </span>
          </span>
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-white/60 animate-fade-up [animation-delay:0.35s]">
          Réservations, équipe, stock et finances de tous vos centres, de Tunis à Djerba, réunis dans un seul outil.
        </p>
      </div>

      {/* Cartes flottantes */}
      <div className="pointer-events-none absolute right-[-40px] top-[18%] z-0 hidden xl:block">
        <div className="glass w-64 animate-float rounded-3xl p-5 [--tilt:4deg]" style={{ animationDelay: "-1s" }}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-gold/20 text-rose-gold">
              <CalendarIcon />
            </span>
            <div>
              <p className="text-sm font-medium text-white">Nouvelle réservation</p>
              <p className="text-xs text-white/50">Brushing + soin · 14:30</p>
            </div>
          </div>
          <div className="mt-4 flex -space-x-2">
            {["#f7c6d0", "#e8b4a0", "#f3d9a4", "#c9a0dc"].map((c) => (
              <span key={c} className="h-7 w-7 rounded-full border-2 border-plum-900" style={{ background: c }} />
            ))}
            <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-plum-900 bg-white/10 text-[10px] text-white">+12</span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-[26%] right-[12%] z-0 hidden xl:block">
        <div className="glass w-56 animate-float rounded-3xl p-5 [--tilt:-3deg]" style={{ animationDelay: "-3s", animationDuration: "7s" }}>
          <p className="text-xs uppercase tracking-wider text-white/50">Chiffre d&apos;affaires</p>
          <p className="mt-1 font-display text-3xl text-white">
            12 480 <span className="text-base text-white/50">DT</span>
          </p>
          <svg viewBox="0 0 160 40" className="mt-2 h-10 w-full" aria-hidden>
            <defs>
              <linearGradient id="spark" x1="0" x2="1">
                <stop offset="0" stopColor="#f7c6d0" />
                <stop offset="1" stopColor="#f3d9a4" />
              </linearGradient>
            </defs>
            <path
              d="M0 32 L20 28 L40 30 L60 20 L80 24 L100 14 L120 16 L140 6 L160 8"
              fill="none"
              stroke="url(#spark)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="220"
              strokeDashoffset="220"
              style={{ animation: "draw 2.5s 0.8s ease forwards" }}
            />
          </svg>
          <p className="mt-1 text-xs font-medium text-emerald-300">▲ 38 % ce mois-ci</p>
        </div>
      </div>

      <div className="relative z-10 flex flex-wrap gap-3 animate-fade-up [animation-delay:0.5s]">
        {["Tunis", "Sousse", "Djerba"].map((city, i) => (
          <span
            key={city}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/70 backdrop-blur"
          >
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full rounded-full bg-emerald-400"
                style={{ animation: `pulse-ring 2s ${i * 0.4}s cubic-bezier(0,0,0.2,1) infinite` }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <PinIcon width={14} height={14} /> {city}
          </span>
        ))}
      </div>
    </div>
  );
}
