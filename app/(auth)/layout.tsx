import { Showcase } from "@/components/auth/showcase";
import { Aurora } from "@/components/ui/aurora";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora />
      <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
        <Showcase />
        <div className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
          <div className="mb-8 lg:hidden animate-fade-up">
            <Logo size={40} />
          </div>
          {children}
          <p className="mt-8 text-center text-xs text-white/35">
            Données hébergées de façon sécurisée · Français / العربية bientôt
          </p>
        </div>
      </div>
    </main>
  );
}
