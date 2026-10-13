import { Showcase } from "@/components/auth/showcase";
import { LanguageToggle, T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora />
      <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
        <Showcase />
        <div className="relative flex flex-col items-center justify-center px-4 pb-10 pt-20 sm:px-8">
          <div className="absolute end-4 top-4 z-20 animate-fade-up sm:end-6 sm:top-6">
            <LanguageToggle />
          </div>
          <div className="mb-8 lg:hidden animate-fade-up">
            <Logo size={40} />
          </div>
          {children}
          <p className="mt-8 text-center text-xs text-white/35">
            <T>Données hébergées de façon sécurisée</T> · Français / العربية
          </p>
        </div>
      </div>
    </main>
  );
}
