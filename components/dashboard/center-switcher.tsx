"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/i18n-provider";
import { LayersIcon, PinIcon } from "@/components/ui/icons";

// F1.4 : sélecteur de centre avec une option « Vue consolidée ».
export function CenterSwitcher({
  centers,
  selected,
}: {
  centers: { id: string; name: string }[];
  selected: string | null;
}) {
  const { t } = useI18n();
  const items = [{ id: null, name: t("Vue consolidée") }, ...centers.map((c) => ({ id: c.id as string | null, name: c.name }))];

  return (
    <nav aria-label={t("Choisir un centre")} className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      <div className="inline-flex gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1.5">
        {items.map((c) => {
          const active = c.id === selected;
          return (
            <Link
              key={c.id ?? "all"}
              href={c.id ? `/dashboard?center=${c.id}` : "/dashboard"}
              scroll={false}
              replace
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition-all duration-300 ${
                active
                  ? "bg-gradient-to-r from-blush to-champagne font-semibold text-plum-950 shadow-[0_6px_24px_-6px_rgb(232_180_160/0.7)]"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              {c.id ? <PinIcon width={15} height={15} /> : <LayersIcon width={15} height={15} />}
              {c.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
