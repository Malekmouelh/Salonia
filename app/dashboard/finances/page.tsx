// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/dashboard/finances/page.tsx — LE TABLEAU DE BORD FINANCIER (F6.5)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /dashboard/finances    (propriétaire et gérant ; le staff est redirigé vers la caisse)
//
// RAPPEL — LE ROUTAGE PAR DOSSIERS DE NEXT.JS (« App Router »)
//   Le chemin du dossier = l'adresse de la page. Le fichier `page.tsx` d'un dossier est la page affichée.
//   app/dashboard/finances/page.tsx          → /dashboard/finances
//   app/dashboard/finances/caisse/page.tsx   → /dashboard/finances/caisse
//
// SERVER COMPONENT : cette page s'exécute sur le SERVEUR (pas de "use client"). Elle peut donc lire la
//   base de données directement, et seul le HTML résultant est envoyé au navigateur. Les parties
//   interactives (graphique, assistant, filtres) sont des « Client Components » importés depuis
//   components/finance/.
//
// CE QUE FAIT LA PAGE
//   1. lit les filtres dans l'adresse (?period=…&center=…),
//   2. calcule tous les chiffres EN PARALLÈLE (Promise.all),
//   3. affiche : 4 indicateurs, graphique du CA, prévision IA, comparaison des centres, classements,
//      alertes IA et assistant IA.
// ═══════════════════════════════════════════════════════════════════════════
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

// Titre de l'onglet du navigateur.
export const metadata: Metadata = { title: "Finances" };

// La page elle-même : une simple « coquille » (fond animé + conteneur centré) qui affiche un squelette
// gris pendant le chargement (`Suspense` + `fallback`) pendant que le contenu réel se calcule.
// `PageProps<"/dashboard/finances">` : type généré par Next.js (c'est ce type global qui posait problème
// au début de la conversation : il vient de `next typegen`).
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

// Le contenu réel (fonction asynchrone : elle peut utiliser `await`).
async function Finances({ searchParams }: { searchParams: PageProps<"/dashboard/finances">["searchParams"] }) {
  // Utilisateur connecté + paramètres de l'adresse, lus en parallèle.
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  // Redirections selon le rôle : le staff va à la caisse ; un client (ou autre) retourne au tableau de bord.
  if (user.role === "STAFF") redirect("/dashboard/finances/caisse");
  if (!canViewFinance(user)) redirect("/dashboard");

  // Un paramètre d'adresse peut être un texte, une liste ou absent : on ne garde que les textes.
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const center = str(params.center) ?? "all"; // « all » = tous les centres (vue consolidée)
  const scope = financeScope(user, center); // périmètre autorisé (null si interdit)
  if (!scope) redirect("/dashboard");
  const range = resolveRange(str(params.period)); // période choisie (par défaut : ce mois-ci)
  const prev = previousRange(range); // période précédente (pour les variations ▲▼)
  const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);

  // Tous les calculs lancés EN MÊME TEMPS : la page met le temps du plus lent, pas la somme des 9.
  // Selon la durée de la période, on affiche le CA jour par jour (≤ 92 jours) ou mois par mois (au-delà).
  const [summary, previous, daily, months, services, categories, centers, forecast, anomalies] = await Promise.all([
    getSummary(scope, range),
    getSummary(scope, prev),
    days <= 92 ? getDailyRevenue(scope, range) : null,
    days > 92 ? getBreakdown(scope, range, "month", 24) : null,
    getBreakdown(scope, range, "service", 8),
    getBreakdown(scope, range, "category", 8),
    // La comparaison n'a de sens qu'avec plusieurs centres.
    scope.centers.length > 1 ? compareCenters(scope, range) : Promise.resolve([]),
    getForecast(scope),
    getAnomalies(scope),
  ]);

  // Points du graphique : une valeur par jour, ou par mois (libellé « 10/26 » = octobre 2026).
  const points = daily
    ? daily.total.map((d) => ({ key: d.day, value: d.value }))
    : months!.map((m) => ({ key: m.key, value: m.amount, label: m.key.slice(5) + "/" + m.key.slice(2, 4) }));
  // Filtres à transmettre au menu d'export, pour exporter exactement ce qui est affiché.
  const query = `period=${range.key}&center=${center}`;
  const scopeLabel = scope.centers.length > 1 ? "Vue consolidée" : scope.centers[0].name;

  return (
    <>
      <DashboardHeader user={user} />
      {/* Titre de la page (<T> traduit le texte en arabe si l'utilisateur a choisi l'arabe) */}
      <div className="mt-6 animate-fade-up">
        <h1 className="font-display text-4xl text-white">
          <T>Pilotage</T> <span className="text-gradient italic"><T>financier</T></span>
        </h1>
        <p className="mt-1 text-white/55">
          <T>Chiffre d&apos;affaires, dépenses et rentabilité de vos centres.</T>
        </p>
      </div>
      {/* Onglets (Tableau de bord / Caisse / Factures / Dépenses) et filtres période + centre */}
      <FinanceTabs role={user.role} />
      <FinanceFilters periods={PERIODS} period={range.key} centers={financeScope(user)!.centers} center={center}>
        <ExportMenu query={query} />
      </FinanceFilters>

      {/* 4 indicateurs clés, avec variation par rapport à la période précédente.
          Pour les dépenses, `upIsGood={false}` : une hausse s'affiche en rouge (mauvaise nouvelle). */}
      <section className="stagger mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Chiffre d'affaires encaissé" value={<Money value={summary.revenue} />} current={summary.revenue} previous={previous.revenue} />
        <StatTile label="Dépenses" value={<Money value={summary.expenses} />} current={summary.expenses} previous={previous.expenses} upIsGood={false} />
        <StatTile label="Résultat" value={<Money value={summary.profit} />} current={summary.profit} previous={previous.profit} />
        <StatTile label="Panier moyen" value={<Money value={summary.averageBasket} />} current={summary.averageBasket} previous={previous.averageBasket} />
      </section>
      <p className="mt-2 text-xs text-white/40">
        <T>{scopeLabel}</T> · <T>{range.label}</T> · {summary.sales} <T>ventes facturées</T> · <T>marge</T> {summary.margin == null ? "—" : `${Math.round(summary.margin * 100)} %`}
      </p>

      {/* Graphique du CA (2/3 de la largeur) + prévision IA du mois (1/3) */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title={days <= 92 ? "Encaissements par jour" : "Encaissements par mois"} subtitle="Paiements et acomptes, moins les remboursements" className="lg:col-span-2">
          <RevenueChart points={points} caption="Chiffre d'affaires encaissé sur la période" />
        </Panel>
        <Panel title="Prévision du mois" subtitle="IA · moyenne par jour de la semaine + tendance">
          <ForecastSummary forecast={forecast} />
        </Panel>
      </div>

      {/* Tableau comparatif des centres : seulement s'il y en a plusieurs */}
      {centers.length > 1 && (
        <Panel title="Comparaison entre centres" subtitle="Rentabilité par centre sur la période" className="mt-5">
          <CenterTable rows={centers} />
        </Panel>
      )}

      {/* Trois classements : services les plus demandés, dépenses par catégorie, moyens de paiement */}
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

      {/* Les deux fonctions IA interactives : alertes (anomalies) et assistant de questions */}
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
