import type { Metadata } from "next";
import { Suspense } from "react";
import { logout } from "@/app/actions/auth";
import { Confetti } from "@/components/dashboard/confetti";
import { Aurora } from "@/components/ui/aurora";
import {
  BoxIcon,
  CalendarIcon,
  LogoutIcon,
  PaletteIcon,
  PinIcon,
  ShieldIcon,
  SparkleIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { Logo } from "@/components/ui/logo";
import { getCurrentUser } from "@/lib/dal";
import { ROLE_LABELS, governorateLabel } from "@/lib/definitions";
import type { Role } from "@/app/generated/prisma/enums";

export const metadata: Metadata = { title: "Tableau de bord" };

// Droits principaux par rôle (cahier des charges, §4).
const PERMISSIONS: Record<Role, string[]> = {
  SUPER_ADMIN: ["Gérer les organisations", "Abonnements et support", "Paramètres globaux"],
  OWNER: ["Centres et design", "Services et staff", "Finances et abonnement"],
  MANAGER: ["Calendrier du centre", "Staff et matériel", "Caisse du centre"],
  STAFF: ["Consulter son planning", "Gérer ses rendez-vous", "Encaisser selon ses droits"],
  CLIENT: ["Consulter la vitrine", "Réserver et payer", "Voir son historique"],
};

const MODULES = [
  { name: "Noyau & multi-centres", icon: ShieldIcon, status: "Actif", color: "from-blush to-rose-gold" },
  { name: "Vitrine & personnalisation", icon: PaletteIcon, status: "Bientôt", color: "from-rose-gold to-champagne" },
  { name: "Calendrier & réservations", icon: CalendarIcon, status: "Bientôt", color: "from-champagne to-gold" },
  { name: "Équipe", icon: UsersIcon, status: "Bientôt", color: "from-[#c9a0dc] to-blush" },
  { name: "Matériel & stock", icon: BoxIcon, status: "Bientôt", color: "from-gold to-rose-gold" },
  { name: "Paiements & factures", icon: WalletIcon, status: "Bientôt", color: "from-blush to-[#c9a0dc]" },
];

export default function DashboardPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <Suspense>
        <Confetti />
      </Suspense>
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<DashboardSkeleton />}>
          <Dashboard />
        </Suspense>
      </div>
    </main>
  );
}

async function Dashboard() {
  const user = await getCurrentUser();
  const centers = user.role === "OWNER" || user.role === "SUPER_ADMIN"
    ? user.organization?.centers ?? []
    : user.centers.map((c) => c.center);
  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();

  return (
    <>
      <header className="flex items-center justify-between py-6 animate-fade-up">
        <Logo size={38} />
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-white">{user.firstName} {user.lastName}</p>
            <p className="text-xs text-white/50">{ROLE_LABELS[user.role]}</p>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-blush to-champagne font-semibold text-plum-950 ring-4 ring-white/5">
            {initials}
          </span>
          <form action={logout}>
            <button
              type="submit"
              title="Se déconnecter"
              className="group flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/70 transition hover:border-red-300/40 hover:bg-red-400/10 hover:text-red-200"
            >
              <LogoutIcon width={18} height={18} className="transition-transform group-hover:translate-x-0.5" />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </form>
        </div>
      </header>

      <section className="stagger mt-6 grid gap-5 lg:grid-cols-3">
        <div className="glass glow-border relative overflow-hidden rounded-[2rem] p-8 lg:col-span-2">
          <SparkleIcon className="absolute right-8 top-8 h-16 w-16 animate-spin-slow text-champagne/20" />
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-champagne">
            {ROLE_LABELS[user.role]}
          </p>
          <h1 className="mt-5 font-display text-4xl text-white sm:text-5xl">
            Bonjour, <span className="text-gradient italic">{user.firstName}</span>
          </h1>
          <p className="mt-3 max-w-lg text-white/60">
            {user.organization
              ? <>Bienvenue dans l&apos;espace <strong className="text-white">{user.organization.name}</strong>. {user.role === "OWNER" ? "Tout est prêt pour gérer vos centres." : "Voici votre espace personnel."}</>
              : "Bienvenue sur la plateforme d'administration."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-white/60">
            {user.email && <span className="rounded-xl bg-white/5 px-3 py-1.5">{user.email}</span>}
            {user.phone && <span className="rounded-xl bg-white/5 px-3 py-1.5">+216 {user.phone}</span>}
          </div>
        </div>

        <div className="glass rounded-[2rem] p-7">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><ShieldIcon /></span>
            <div>
              <p className="font-medium text-white">Session sécurisée</p>
              <p className="text-xs text-white/50">Cookie httpOnly · JWT signé</p>
            </div>
          </div>
          <p className="mt-5 text-xs uppercase tracking-wider text-white/40">Vos droits</p>
          <ul className="mt-3 space-y-2.5">
            {PERMISSIONS[user.role].map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-sm text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-blush to-champagne" /> {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {centers.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-2xl text-white animate-fade-up">
            {centers.length > 1 ? "Vos centres" : "Votre centre"}
          </h2>
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {centers.map((c) => (
              <div key={c.id} className="glass group rounded-3xl p-6 transition duration-300 hover:-translate-y-1 hover:border-rose-gold/30">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-gold/15 text-rose-gold transition group-hover:scale-110"><PinIcon /></span>
                  <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Ouvert
                  </span>
                </div>
                <p className="mt-4 font-medium text-white">{c.name}</p>
                <p className="text-sm text-white/50">{governorateLabel(c.governorate)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-4 font-display text-2xl text-white animate-fade-up">Modules de la plateforme</h2>
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ name, icon: Icon, status, color }, i) => (
            <div key={name} className="glass group relative overflow-hidden rounded-3xl p-6 transition duration-300 hover:-translate-y-1">
              <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${color} opacity-10 blur-2xl transition-opacity duration-500 group-hover:opacity-30`} />
              <span className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${color} text-plum-950`}><Icon /></span>
              <p className="mt-4 text-xs text-white/40">Module {i + 1}</p>
              <p className="font-medium text-white">{name}</p>
              <span className={`mt-3 inline-block rounded-full px-2.5 py-0.5 text-xs ${status === "Actif" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/50"}`}>
                {status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between py-6">
        <div className="h-10 w-40 rounded-2xl bg-white/5" />
        <div className="h-11 w-32 rounded-full bg-white/5" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="h-64 rounded-[2rem] bg-white/5 lg:col-span-2" />
        <div className="h-64 rounded-[2rem] bg-white/5" />
      </div>
    </div>
  );
}
