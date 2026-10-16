import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { LogoutIcon } from "@/components/ui/icons";
import { Logo } from "@/components/ui/logo";
import type { CurrentUser } from "@/lib/dal";
import { ROLE_LABELS } from "@/lib/definitions";
import { DashboardNav } from "./nav";

export function DashboardHeader({ user }: { user: CurrentUser }) {
  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 py-6 animate-fade-up">
        <Link href="/dashboard" aria-label="Tableau de bord">
          <Logo size={38} />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageToggle />
          <div className="hidden text-end sm:block">
            <p className="text-sm font-medium text-white">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-white/50">
              <T>{ROLE_LABELS[user.role]}</T>
            </p>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-blush to-champagne font-semibold text-plum-950 ring-4 ring-white/5">
            {initials}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="group flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/70 transition hover:border-red-300/40 hover:bg-red-400/10 hover:text-red-200"
            >
              <LogoutIcon width={18} height={18} className="transition-transform rtl:-scale-x-100 group-hover:translate-x-0.5" />
              <span className="hidden sm:inline">
                <T>Déconnexion</T>
              </span>
            </button>
          </form>
        </div>
      </header>
      <div className="animate-fade-up [animation-delay:0.05s]">
        <DashboardNav role={user.role} />
      </div>
    </>
  );
}
