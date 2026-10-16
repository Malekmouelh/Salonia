import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerList } from "@/components/clients/customer-list";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { searchCustomers } from "@/lib/data/customers";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage({ searchParams }: PageProps<"/dashboard/clients">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Clients searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Clients({ searchParams }: { searchParams: PageProps<"/dashboard/clients">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const q = typeof params.q === "string" ? params.q : "";
  const customers = user.role === "CLIENT" ? [] : await searchCustomers(user, q, 60);

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-4xl text-white">
            <T>Fiches</T> <span className="text-gradient italic"><T>clients</T></span>
          </h1>
          <p className="mt-1 text-white/55">
            <T>Historique des prestations, fidélité et fiabilité de chaque client.</T>
          </p>
        </div>
      </div>
      <CustomerList initialQuery={q} customers={customers} />
    </>
  );
}
