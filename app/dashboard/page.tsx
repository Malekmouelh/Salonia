import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AddCenter } from "@/components/dashboard/add-center";
import { CenterSwitcher } from "@/components/dashboard/center-switcher";
import { Confetti } from "@/components/dashboard/confetti";
import { DashboardHeader } from "@/components/dashboard/header";
import { SecurityLog } from "@/components/dashboard/security-log";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import {
  BoxIcon,
  CalendarIcon,
  ClockIcon,
  PaletteIcon,
  PinIcon,
  ShieldIcon,
  SparkleIcon,
  UsersIcon,
  WalletIcon,
  WandIcon,
} from "@/components/ui/icons";
import { describeDevice } from "@/lib/audit";
import { getCurrentUser } from "@/lib/dal";
import { getSecurityEvents, getVisibleCenters, type VisibleCenter } from "@/lib/data/organization";
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

const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <Suspense>
        <Confetti />
      </Suspense>
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<DashboardSkeleton />}>
          <Dashboard searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const user = await getCurrentUser();
  const [centers, events, params] = await Promise.all([getVisibleCenters(user), getSecurityEvents(user), searchParams]);
  const isOwner = user.role === "OWNER";
  const selectedId = typeof params.center === "string" ? params.center : null;
  const selected = centers.find((c) => c.id === selectedId) ?? null;

  return (
    <>
      <DashboardHeader user={user} />

      <section className="stagger mt-6 grid gap-5 lg:grid-cols-3">
        <div className="glass glow-border relative overflow-hidden rounded-[2rem] p-8 lg:col-span-2">
          <SparkleIcon className="absolute end-8 top-8 h-16 w-16 animate-spin-slow text-champagne/20" />
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-champagne">
            <T>{ROLE_LABELS[user.role]}</T>
          </p>
          <h1 className="mt-5 font-display text-4xl text-white sm:text-5xl">
            <T>Bonjour,</T> <span className="text-gradient italic">{user.firstName}</span>
          </h1>
          <p className="mt-3 max-w-lg text-white/60">
            {user.organization ? (
              <>
                <T>Bienvenue dans l&apos;espace</T> <strong className="text-white">{user.organization.name}</strong>.{" "}
                <T>{isOwner ? "Tout est prêt pour gérer vos centres." : "Voici votre espace personnel."}</T>
              </>
            ) : (
              <T>Bienvenue sur la plateforme d&apos;administration.</T>
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-white/60">
            {user.email && <span className="rounded-xl bg-white/5 px-3 py-1.5" dir="ltr">{user.email}</span>}
            {user.phone && <span className="rounded-xl bg-white/5 px-3 py-1.5" dir="ltr">+216 {user.phone}</span>}
            {isOwner && (
              <Link
                href="/dashboard/assistant"
                className="btn-shine group ms-auto inline-flex items-center gap-2 rounded-xl px-4 py-2 font-semibold text-plum-950"
              >
                <WandIcon width={17} height={17} /> <T>Configurer avec l&apos;IA</T>
              </Link>
            )}
          </div>
        </div>

        <div className="glass rounded-[2rem] p-7">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><ShieldIcon /></span>
            <div>
              <p className="font-medium text-white"><T>Session sécurisée</T></p>
              <p className="text-xs text-white/50"><T>Cookie httpOnly · JWT signé</T></p>
            </div>
          </div>
          <p className="mt-5 text-xs uppercase tracking-wider text-white/40"><T>Vos droits</T></p>
          <ul className="mt-3 space-y-2.5">
            {PERMISSIONS[user.role].map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-sm text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-blush to-champagne" /> <T>{p}</T>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {(centers.length > 0 || isOwner) && (
        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-2xl text-white animate-fade-up">
              <T>{isOwner ? "Vos centres" : centers.length > 1 ? "Vos centres" : "Votre centre"}</T>
            </h2>
            {isOwner && centers.length > 1 && <CenterSwitcher centers={centers} selected={selected?.id ?? null} />}
          </div>

          {selected ? (
            <CenterDetail key={selected.id} center={selected} />
          ) : (
            <>
              {isOwner && centers.length > 0 && <ConsolidatedStats centers={centers} />}
              <div className="stagger mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {centers.map((c) => (
                  <Link
                    key={c.id}
                    href={isOwner ? `/dashboard?center=${c.id}` : "#"}
                    scroll={false}
                    className="glass group block rounded-3xl p-6 transition duration-300 hover:-translate-y-1 hover:border-rose-gold/30"
                  >
                    <div className="flex items-center justify-between">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-gold/15 text-rose-gold transition group-hover:scale-110"><PinIcon /></span>
                      <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> <T>Ouvert</T>
                      </span>
                    </div>
                    <p className="mt-4 font-medium text-white">{c.name}</p>
                    <p className="text-sm text-white/50"><T>{governorateLabel(c.governorate)}</T></p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-white/45">
                      <UsersIcon width={14} height={14} /> {c.members.length} <T>{c.members.length > 1 ? "membres" : "membre"}</T>
                    </p>
                  </Link>
                ))}
                {isOwner && <AddCenter />}
              </div>
            </>
          )}
        </section>
      )}

      <section className="mt-10 grid gap-5 lg:grid-cols-5">
        <div className="glass rounded-[2rem] p-7 lg:col-span-3">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-2xl text-white"><T>Journal de sécurité</T></h2>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/50">
              <T>{isOwner ? "Toute l'organisation" : "Votre compte"}</T>
            </span>
          </div>
          <SecurityLog
            events={events.map((e) => ({
              id: e.id,
              type: e.type,
              ip: e.ip,
              device: describeDevice(e.userAgent),
              createdAt: e.createdAt.toISOString(),
              who: isOwner && e.user ? `${e.user.firstName} ${e.user.lastName}` : null,
            }))}
          />
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-4 font-display text-2xl text-white"><T>Modules de la plateforme</T></h2>
          <div className="stagger grid grid-cols-2 gap-3">
            {MODULES.map(({ name, icon: Icon, status, color }, i) => (
              <div key={name} className="glass group relative overflow-hidden rounded-3xl p-4 transition duration-300 hover:-translate-y-1">
                <div className={`absolute -end-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br ${color} opacity-10 blur-2xl transition-opacity duration-500 group-hover:opacity-30`} />
                <span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${color} text-plum-950`}><Icon width={18} height={18} /></span>
                <p className="mt-3 text-[11px] text-white/40"><T>Module</T> {i + 1}</p>
                <p className="text-sm font-medium leading-snug text-white"><T>{name}</T></p>
                <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] ${status === "Actif" ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/50"}`}>
                  <T>{status}</T>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

// Vue consolidée (F1.4) : chiffres réels de toute l'organisation.
function ConsolidatedStats({ centers }: { centers: VisibleCenter[] }) {
  const team = new Map<string, Role>();
  for (const c of centers) for (const m of c.members) team.set(m.user.id, m.user.role);
  const governorates = new Set(centers.map((c) => c.governorate)).size;
  const staff = [...team.values()].filter((r) => r === "STAFF").length;

  const stats = [
    { label: "Centres", value: centers.length },
    { label: "Gouvernorats", value: governorates },
    { label: "Membres d'équipe", value: team.size },
    { label: "Staff", value: staff },
  ];

  return (
    <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="glass rounded-3xl p-5">
          <p className="text-xs uppercase tracking-wider text-white/45"><T>{s.label}</T></p>
          <p className="mt-2 font-display text-4xl text-gradient">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function CenterDetail({ center }: { center: VisibleCenter }) {
  const hours = (center.openingHours ?? null) as Record<string, string | null> | null;

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="glass glow-border rounded-[2rem] p-7 lg:col-span-3 animate-fade-up">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blush to-champagne text-plum-950"><PinIcon width={26} height={26} /></span>
          <div>
            <p className="font-display text-2xl text-white">{center.name}</p>
            <p className="text-sm text-white/50"><T>{governorateLabel(center.governorate)}</T></p>
          </div>
        </div>
        <p className="mb-3 mt-7 text-xs uppercase tracking-wider text-white/40"><T>Équipe du centre</T></p>
        <ul className="stagger space-y-2">
          {center.members.map(({ user: m }) => (
            <li key={m.id} className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3">
              <span className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">
                  {m.firstName[0]}{m.lastName[0]}
                </span>
                <span className="text-sm text-white">{m.firstName} {m.lastName}</span>
              </span>
              <span className="rounded-full bg-rose-gold/10 px-2.5 py-0.5 text-xs text-rose-gold"><T>{ROLE_LABELS[m.role]}</T></span>
            </li>
          ))}
        </ul>
      </div>

      <div className="glass rounded-[2rem] p-7 lg:col-span-2 animate-fade-up [animation-delay:0.1s]">
        <p className="mb-4 flex items-center gap-2 text-xs uppercase tracking-wider text-white/40">
          <ClockIcon width={14} height={14} /> <T>Horaires d&apos;ouverture</T>
        </p>
        {hours ? (
          <ul className="space-y-2 text-sm">
            {DAYS.map((d) => (
              <li key={d} className="flex justify-between border-b border-white/5 pb-2 last:border-0">
                <span className="capitalize text-white/60"><T>{d}</T></span>
                <span className={hours[d] ? "text-white" : "text-white/35"} dir="ltr">{hours[d] ?? "—"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-white/50">
            <T>Pas encore d&apos;horaires.</T>{" "}
            <Link href="/dashboard/assistant" className="text-rose-gold underline-offset-4 hover:underline">
              <T>Les générer avec l&apos;IA</T>
            </Link>
          </div>
        )}
      </div>
    </div>
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
