import { Suspense } from "react";
import { requireRole } from "@/lib/dal";
import { DashboardNav } from "@/components/dashboard/nav";
import { Aurora } from "@/components/ui/aurora";
import {
  getServicesByOrganization,
  getPacksByOrganization,
  getCategories,
  getPromotionsByOrganization,
} from "@/lib/data/catalog";
import { CatalogueManager } from "@/components/catalog/catalogue-manager";

export const metadata = {
  title: "Catalogue & Packs — Salonia",
  description: "Gestion des prestations, options, forfaits et tarifs de votre salon.",
};

export default function CataloguePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-plum-950 pb-16 pt-8 text-white">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Suspense fallback={<CatalogueSkeleton />}>
          <CatalogueContent />
        </Suspense>
      </div>
    </main>
  );
}

function CatalogueSkeleton() {
  return (
    <div className="animate-pulse space-y-6 pt-2">
      <div className="h-10 w-96 rounded-2xl bg-white/5" />
      <div className="h-6 w-72 rounded-xl bg-white/5" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-white/5 bg-white/[0.02]" />
        ))}
      </div>
      <div className="h-12 w-80 rounded-2xl bg-white/5" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-44 rounded-2xl border border-white/5 bg-white/[0.02]" />
        ))}
      </div>
    </div>
  );
}

async function CatalogueContent() {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">
        Aucune organisation rattachée à ce compte.
      </div>
    );
  }

  const organizationId = user.organization.id;
  const centers = user.organization.centers.map((c) => ({ id: c.id, name: c.name }));

  const [services, packs, categories, promotions] = await Promise.all([
    getServicesByOrganization(organizationId),
    getPacksByOrganization(organizationId),
    getCategories(organizationId),
    getPromotionsByOrganization(organizationId),
  ]);

  const defaultCategories = [
    "Coiffure & Coupe",
    "Coloration & Mèches",
    "Soins du Visage",
    "Manucure & Onglerie",
    "Épilation",
    "Massage & Bien-être",
    "Maquillage & Regard",
  ];
  const combinedCategories = Array.from(new Set([...categories, ...defaultCategories])).sort();

  return (
    <>
      <DashboardNav role={user.role} />

      <div className="mb-8 mt-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-rose-gold/15 px-3 py-1 text-xs font-semibold text-rose-gold">
            Module 2 · Catalogue
          </span>
          <span className="text-xs text-white/40">• {user.organization.name}</span>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Catalogue de prestations & packs
        </h1>
        <p className="max-w-2xl text-sm text-white/60">
          Configurez vos services, options et suppléments, composez des forfaits attractifs et
          ajustez les prix selon vos centres en Tunisie.
        </p>
      </div>

      <CatalogueManager
        initialServices={services}
        initialPacks={packs}
        initialPromotions={promotions}
        categories={combinedCategories}
        centers={centers}
        canManage={user.role === "OWNER" || user.role === "MANAGER"}
      />
    </>
  );
}
