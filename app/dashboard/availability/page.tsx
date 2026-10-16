import type { Metadata } from "next";
import { Suspense } from "react";
import { AvailabilityEditor } from "@/components/calendar/availability-editor";
import { DashboardHeader } from "@/components/dashboard/header";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { DEFAULT_HOURS, startOfLocalDay } from "@/lib/booking/time";
import { connectDB } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { resolveCenterId } from "@/lib/data/bookings";
import { AvailabilityBlock } from "@/lib/models/booking";
import { Center, User } from "@/lib/models/core";

export const metadata: Metadata = { title: "Disponibilités" };

export default function AvailabilityPage({ searchParams }: PageProps<"/dashboard/availability">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Availability searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Availability({ searchParams }: { searchParams: PageProps<"/dashboard/availability">["searchParams"] }) {
  const [user, params] = await Promise.all([requireRole("OWNER", "MANAGER"), searchParams]);
  const centerId = resolveCenterId(user, typeof params.center === "string" ? params.center : null);
  if (!centerId) return <DashboardHeader user={user} />;

  await connectDB();
  const [center, blocks] = await Promise.all([
    Center.findById(centerId).select("name openingHours").lean(),
    AvailabilityBlock.find({ centerId, end: { $gte: startOfLocalDay(new Date()) } }).sort({ start: 1 }).limit(50).lean(),
  ]);
  const staff = await User.find({ _id: { $in: blocks.map((b) => b.staffId).filter(Boolean) } }).select("firstName lastName").lean();
  const staffName = new Map(staff.map((s) => [String(s._id), `${s.firstName} ${s.lastName}`]));

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Horaires &</T> <span className="text-gradient italic"><T>disponibilités</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Les créneaux proposés en ligne respectent ces horaires, les pauses et les fermetures.</T>
        </p>
      </div>
      <AvailabilityEditor
        centers={(user.organization?.centers ?? []).filter((c) => resolveCenterId(user, c.id) === c.id).map((c) => ({ id: c.id, name: c.name }))}
        center={{ id: centerId, name: center?.name ?? "", openingHours: (center?.openingHours as Record<string, string | null> | null) ?? DEFAULT_HOURS }}
        blocks={blocks.map((b) => ({
          id: String(b._id),
          kind: b.kind as "BREAK" | "CLOSURE" | "BLOCK",
          start: b.start.toISOString(),
          end: b.end.toISOString(),
          reason: b.reason ?? null,
          staff: b.staffId ? staffName.get(String(b.staffId)) ?? null : null,
        }))}
      />
    </>
  );
}
