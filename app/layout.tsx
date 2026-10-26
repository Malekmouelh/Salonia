import type { Metadata, Viewport } from "next";
import { Amiri, Cairo, Inter, Playfair_Display } from "next/font/google";
import { LANG_BOOT_SCRIPT } from "@/components/i18n/i18n-provider";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Polices arabes (interface en arabe, affichage de droite à gauche).
const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} · ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    "La plateforme tout-en-un pour gérer, promouvoir et développer votre salon de beauté et de coiffure.",
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#12070f",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      dir="ltr"
      // La langue et la direction sont corrigées avant l'affichage par LANG_BOOT_SCRIPT.
      suppressHydrationWarning
      className={`${inter.variable} ${playfair.variable} ${cairo.variable} ${amiri.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning className="grain min-h-full flex flex-col">
        {children}
        <PwaProvider />
      </body>
    </html>
  );
}
