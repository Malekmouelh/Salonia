"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { safeNext } from "@/lib/definitions";
import { ClientRegisterForm } from "./client-register-form";
import { RegisterForm } from "./register-form";

// Deux espaces : le client (réserver dans un salon) et le propriétaire (créer son salon).
export function RegisterSwitch() {
  const { t } = useI18n();
  const params = useSearchParams();
  const next = safeNext(params.get("next")) ?? "";
  // Venu d'une réservation (next) : l'espace client est proposé d'office.
  const type = params.get("type") === "salon" ? "salon" : params.get("type") === "client" || next ? "client" : "salon";
  const href = (k: "client" | "salon") => `/register?type=${k}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <>
      <div role="tablist" className="mb-7 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        {(["client", "salon"] as const).map((k) => (
          <Link
            key={k}
            href={href(k)}
            replace
            role="tab"
            aria-selected={type === k}
            className={`rounded-xl px-3 py-2.5 text-center text-sm font-medium transition ${
              type === k ? "bg-gradient-to-br from-blush to-champagne text-plum-950 shadow-[0_0_20px_rgb(232_180_160/0.35)]" : "text-white/60 hover:text-white"
            }`}
          >
            {t(k === "client" ? "Je suis client(e)" : "J'ai un salon")}
          </Link>
        ))}
      </div>
      {type === "client" ? <ClientRegisterForm key="client" next={next} /> : <RegisterForm key="salon" />}
    </>
  );
}
