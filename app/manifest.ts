import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — Gestion de salons`,
    short_name: BRAND.name,
    description: "Gérez réservations, équipe, stock et finances de vos salons de beauté et coiffure.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#12070f",
    theme_color: "#12070f",
    lang: "fr",
    categories: ["business", "productivity", "lifestyle"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Tableau de bord", url: "/dashboard" },
      { name: "Assistant IA", url: "/dashboard/assistant" },
    ],
  };
}
