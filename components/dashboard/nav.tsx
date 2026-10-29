"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { BoxIcon, CalendarIcon, ClockIcon, LayersIcon, PaletteIcon, SparkleIcon, StoreIcon, UserIcon, UsersIcon, WalletIcon, WandIcon } from "@/components/ui/icons";
import type { Role } from "@/lib/enums";

const LINKS = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayersIcon, roles: ["OWNER", "MANAGER", "STAFF", "SUPER_ADMIN", "CLIENT"] },
  { href: "/dashboard/vitrine", label: "Vitrine & Design", icon: PaletteIcon, roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/catalogue", label: "Catalogue", icon: SparkleIcon, roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/calendar", label: "Calendrier", icon: CalendarIcon, roles: ["OWNER", "MANAGER", "STAFF"] },
  { href: "/dashboard/planning", label: "Mon planning", icon: UserIcon, roles: ["STAFF"] },
  { href: "/dashboard/clients", label: "Clients", icon: UsersIcon, roles: ["OWNER", "MANAGER", "STAFF"] },
  { href: "/dashboard/availability", label: "Disponibilités", icon: ClockIcon, roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/equipe", label: "Équipe", icon: UsersIcon, roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances", label: "Finances", icon: WalletIcon, roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/stock", label: "Matériel & stock", icon: BoxIcon, roles: ["OWNER", "MANAGER"] },
  { href: "/dashboard/finances/caisse", label: "Caisse", icon: WalletIcon, roles: ["STAFF"] },
  { href: "/dashboard/assistant", label: "Assistant IA", icon: WandIcon, roles: ["OWNER"] },
  { href: "/dashboard/salons", label: "Trouver un salon", icon: StoreIcon, roles: ["CLIENT"] },
] as const;

export function DashboardNav({ role }: { role: Role }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const links = LINKS.filter((l) => (l.roles as readonly string[]).includes(role));
  if (links.length < 2) return null;

  return (
    <nav aria-label={t("Navigation")} className="-mx-4 mb-2 overflow-x-auto px-4 [scrollbar-width:none]">
      <div className="inline-flex gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition-all duration-300 ${
                active
                  ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950 shadow-[0_6px_24px_-6px_rgb(232_180_160/0.6)]"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon width={16} height={16} />
              {t(label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
