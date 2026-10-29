import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PublicSalonPage } from "@/components/vitrine/public-salon-page";
import { getPublicSalonShowcase } from "@/lib/data/vitrine";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const salon = await getPublicSalonShowcase(slug);
  if (!salon) return { title: "Salon introuvable · Salonia" };

  const title = `${salon.name} · Vitrine & Réservation en ligne`;
  const description =
    salon.theme.tagline ||
    salon.theme.description ||
    `Découvrez ${salon.name}, nos prestations, avis clientes et réservez en ligne en Tunisie.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: salon.theme.banner ? [salon.theme.banner] : salon.theme.logo ? [salon.theme.logo] : [],
    },
  };
}

// Next.js 16 : données lues à la requête, donc rendues dans un <Suspense>.
export default function Page(props: Props) {
  return (
    <Suspense fallback={<div className="min-h-screen animate-pulse bg-[#180916]" />}>
      <SalonShowcase {...props} />
    </Suspense>
  );
}

async function SalonShowcase({ params }: Props) {
  const { slug } = await params;
  const salon = await getPublicSalonShowcase(slug);
  if (!salon) notFound();

  return <PublicSalonPage salon={salon} />;
}
