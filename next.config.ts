import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Réessaie navigations et Server Actions au retour du réseau + hook useOffline.
    useOffline: true,
    // Garde 5 min en mémoire (cache client) les pages déjà visitées : hors ligne, on y revient avec les
    // données de la dernière visite. Toute Server Action qui revalide vide ce cache (pas de donnée périmée
    // après une modification) ; un rechargement complet le vide aussi. Rien n'est écrit sur l'appareil.
    staleTimes: { dynamic: 300 },
    // Photos du catalogue et des centres envoyées par Server Action (6 × ~440 Ko max, vérifié côté serveur).
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
