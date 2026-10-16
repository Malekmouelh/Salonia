import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CustomerProfileView } from "@/components/clients/customer-profile";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getCustomerProfile } from "@/lib/data/customers";

export const metadata: Metadata = { title: "Fiche client" };

export default function CustomerPage({ params }: PageProps<"/dashboard/clients/[id]">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Customer params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Customer({ params }: { params: PageProps<"/dashboard/clients/[id]">["params"] }) {
  const [user, { id }] = await Promise.all([getCurrentUser(), params]);
  const profile = user.role === "CLIENT" ? null : await getCustomerProfile(user, id);

  return (
    <>
      <DashboardHeader user={user} />
      {profile ? (
        <CustomerProfileView profile={profile} salonName={user.organization?.name ?? ""} />
      ) : (
        <div className="glass mt-8 rounded-[2rem] p-10 text-center text-white/60">
          <T>Client introuvable.</T>{" "}
          <Link href="/dashboard/clients" className="text-rose-gold underline-offset-4 hover:underline">
            <T>Retour à la liste</T>
          </Link>
        </div>
      )}
    </>
  );
}
