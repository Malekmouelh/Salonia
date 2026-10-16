import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarApp } from "@/components/calendar/calendar-app";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { getCalendarData, getCatalog, getFillSuggestions, getWaitlist } from "@/lib/data/bookings";

export const metadata: Metadata = { title: "Calendrier" };

export default function CalendarPage({ searchParams }: PageProps<"/dashboard/calendar">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-[1500px] px-4 pb-16 sm:px-8">
        <Suspense fallback={<CalendarSkeleton />}>
          <Calendar searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Calendar({ searchParams }: { searchParams: PageProps<"/dashboard/calendar">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const data = await getCalendarData(user, { view: str(params.view), date: str(params.date), centerId: str(params.center), staffId: str(params.staff) });

  if (!data || user.role === "CLIENT") {
    return (
      <>
        <DashboardHeader user={user} />
        <div className="glass mt-8 rounded-[2rem] p-10 text-center text-white/60">
          <T>Aucun centre accessible pour ce compte.</T>
        </div>
      </>
    );
  }

  const [catalog, suggestions, waitlist] = await Promise.all([
    getCatalog(user.organization!.id, data.center.id),
    data.canManage ? getFillSuggestions(user, data.center.id) : Promise.resolve([]),
    getWaitlist(user, data.center.id),
  ]);

  return (
    <>
      <DashboardHeader user={user} />
      <CalendarApp
        data={data}
        services={catalog.services}
        packs={catalog.packs}
        suggestions={suggestions}
        waitlist={waitlist}
        salonName={user.organization!.name}
      />
    </>
  );
}

function CalendarSkeleton() {
  return (
    <div className="animate-pulse pt-6">
      <div className="h-11 w-48 rounded-2xl bg-white/5" />
      <div className="mt-6 h-12 w-full max-w-xl rounded-2xl bg-white/5" />
      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="h-[70vh] rounded-[1.75rem] bg-white/5" />
        <div className="h-96 rounded-[1.75rem] bg-white/5" />
      </div>
    </div>
  );
}
