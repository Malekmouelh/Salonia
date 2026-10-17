import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardHeader } from "@/components/dashboard/header";
import { AnomalyList, FinanceAssistant } from "@/components/finance/finance-assistant";
import { BarList, ExportMenu, FinanceFilters, FinanceTabs, Panel, StatTile } from "@/components/finance/finance-ui";
import { CenterTable, ForecastSummary, Money } from "@/components/finance/finance-widgets";
import { RevenueChart } from "@/components/finance/revenue-chart";
import { T } from "@/components/i18n/i18n-provider";
import { Aurora } from "@/components/ui/aurora";
import { getCurrentUser } from "@/lib/dal";
import { METHOD_LABELS } from "@/lib/finance/labels";
import {
  PERIODS,
  compareCenters,
  financeScope,
  getAnomalies,
  getBreakdown,
  getDailyRevenue,
  getForecast,
  getSummary,
  previousRange,
  resolveRange,
} from "@/lib/finance/reports";
import { canViewFinance } from "@/lib/finance/service";

export const metadata: Metadata = { title: "Finances" };

export default function FinancesPage({ searchParams }: PageProps<"/dashboard/finances">) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <Aurora sparkles={false} />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-8">
        <Suspense fallback={<div className="mt-24 h-96 animate-pulse rounded-[2rem] bg-white/5" />}>
          <Finances searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Finances({ searchParams }: { searchParams: PageProps<"/dashboard/finances">["searchParams"] }) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  if (user.role === "STAFF") redirect("/dashboard/finances/caisse");
  if (!canViewFinance(user)) redirect("/dashboard");

  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const center = str(params.center) ?? "all";
  const scope = financeScope(user, center);
  if (!scope) redirect("/dashboard");
  const range = resolveRange(str(params.period));
  const prev = previousRange(range);
  const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);

  const [summary, previous, daily, months, services, categories, centers, forecast, anomalies] = await Promise.all([
    getSummary(scope, range),
    getSummary(scope, prev),
    days <= 92 ? getDailyRevenue(scope, range) : null,
    days > 92 ? getBreakdown(scope, range, "month", 24) : null,
    getBreakdown(scope, range, "service", 8),
    getBreakdown(scope, range, "category", 8),
    scope.centers.length > 1 ? compareCenters(scope, range) : Promise.resolve([]),
    getForecast(scope),
    getAnomalies(scope),
  ]);

  const points = daily
    ? daily.total.map((d) => ({ key: d.day, value: d.value }))
    : months!.map((m) => ({ key: m.key, value: m.amount, label: m.key.slice(5) + "/" + m.key.slice(2, 4) }));
  const query = `period=${range.key}&center=${center}`;
  const scopeLabel = scope.centers.length > 1 ? "Vue consolidée" : scope.centers[0].name;

  return (
    <>
      <DashboardHeader user={user} />
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Pilotage</T> <span className="text-gradient italic"><T>financier</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Chiffre d&apos;affaires, dépenses et rentabilité de vos centres.</T>
        </p>
      </div>
      <FinanceTabs role={user.role} />
      <FinanceFilters periods={PERIODS} period={range.key} centers={financeScope(user)!.centers} center={center}>
        <ExportMenu query={query} />
      </FinanceFilters>

      <section className="stagger mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Chiffre d'affaires encaissé" value={<Money value={summary.revenue} />} current={summary.revenue} previous={previous.revenue} />
        <StatTile label="Dépenses" value={<Money value={summary.expenses} />} current={summary.expenses} previous={previous.expenses} upIsGood={false} />
        <StatTile label="Résultat" value={<Money value={summary.profit} />} current={summary.profit} previous={previous.profit} />
        <StatTile label="Panier moyen" value={<Money value={summary.averageBasket} />} current={summary.averageBasket} previous={previous.averageBasket} />
      </section>
      <p className="mt-2 text-xs text-white/40">
        <T>{scopeLabel}</T> · <T>{range.label}</T> · {summary.sales} <T>ventes facturées</T> · <T>marge</T> {summary.margin == null ? "—" : `${Math.round(summary.margin * 100)} %`}
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title={days <= 92 ? "Encaissements par jour" : "Encaissements par mois"} subtitle="Paiements et acomptes, moins les remboursements" className="lg:col-span-2">
          <RevenueChart points={points} caption="Chiffre d'affaires encaissé sur la période" />
        </Panel>
        <Panel title="Prévision du mois" subtitle="IA · moyenne par jour de la semaine + tendance">
          <ForecastSummary forecast={forecast} />
        </Panel>
      </div>

      {centers.length > 1 && (
        <Panel title="Comparaison entre centres" subtitle="Rentabilité par centre sur la période" className="mt-5">
          <CenterTable rows={centers} />
        </Panel>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="Services les plus demandés" subtitle="D'après les factures de la période">
          <BarList rows={services.map((s) => ({ key: s.key, label: s.label, amount: s.amount, detail: `× ${s.count}` }))} empty="Aucune vente sur la période." />
        </Panel>
        <Panel title="Dépenses par catégorie">
          <BarList rows={categories} empty="Aucune dépense sur la période." translateLabels />
        </Panel>
        <Panel title="Moyens de paiement">
          <BarList rows={summary.byMethod.map((m) => ({ key: m.method, label: METHOD_LABELS[m.method], amount: m.amount }))} empty="Aucun encaissement sur la période." translateLabels />
          {summary.deposits > 0 && (
            <p className="mt-4 text-xs text-white/45">
              <T>Dont acomptes</T> : <Money value={summary.deposits} /> · <T>Remboursements</T> : <Money value={summary.refunds} />
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Panel title="Alertes" subtitle="IA · détection d'anomalies sur les dernières semaines" className="lg:col-span-2">
          <AnomalyList anomalies={anomalies} />
        </Panel>
        <Panel title="Assistant d'analyse" subtitle="IA · posez une question sur vos chiffres" className="lg:col-span-3">
          <FinanceAssistant centerId={center} />
        </Panel>
      </div>
    </>
  );
}
