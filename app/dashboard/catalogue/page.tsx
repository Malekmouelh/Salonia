import { Suspense } from "react";
import { requireRole } from "@/lib/dal";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import {
  getServicesByOrganization,
  getPacksByOrganization,
  getCategories,
  getPromotionsByOrganization,
} from "@/lib/data/catalog";
import { connectDB } from "@/lib/db";
import { Organization } from "@/lib/models/core";
import { CatalogueManager } from "@/components/catalog/catalogue-manager";

export const metadata = {
  title: "Catalogue & Packs — Salonia",
  description: "Gestion des prestations, options, forfaits et tarifs de votre salon.",
};

export default function CataloguePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-8">
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

  const [services, packs, categories, promotions, orgDoc] = await Promise.all([
    getServicesByOrganization(organizationId),
    getPacksByOrganization(organizationId),
    getCategories(organizationId),
    getPromotionsByOrganization(organizationId),
    (async () => { await connectDB(); return Organization.findById(organizationId).select("catalogDraft").lean(); })(),
  ]);

  const hasCatalogDraft = !!(orgDoc?.catalogDraft as { services?: unknown[] } | null)?.services?.length;

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
      <DashboardHeader user={user} />

      <div className="mb-8 mt-6 flex flex-col gap-2 animate-fade-up">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-rose-gold/15 px-3 py-1 text-xs font-semibold text-rose-gold">
            <T>Module 2 · Catalogue</T>
          </span>
          <span className="text-xs text-white/40">• {user.organization.name}</span>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          <T>Catalogue de prestations & packs</T>
        </h1>
        <p className="max-w-2xl text-sm text-white/60">
          <T>Configurez vos services, options et suppléments, composez des forfaits attractifs et ajustez les prix selon vos centres en Tunisie.</T>
        </p>
      </div>

      <CatalogueManager
        initialServices={services}
        initialPacks={packs}
        initialPromotions={promotions}
        categories={combinedCategories}
        centers={centers}
        canManage={user.role === "OWNER" || user.role === "MANAGER"}
        hasCatalogDraft={hasCatalogDraft}
      />
    </>
  );
}
