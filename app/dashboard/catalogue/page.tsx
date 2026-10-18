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

export default async function CataloguePage() {
  const user = await requireRole("OWNER", "MANAGER");
  if (!user.organization) {
    return (
      <main className="min-h-screen p-8 text-white">
        Aucune organisation rattachée à ce compte.
      </main>
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

  // Si aucune catégorie n'est encore enregistrée en base, suggérer les classiques de la beauté
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
    <main className="relative min-h-dvh overflow-hidden bg-plum-950 pb-16 pt-8 text-white">
      <Aurora sparkles={false} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
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
      </div>
    </main>
  );
}
