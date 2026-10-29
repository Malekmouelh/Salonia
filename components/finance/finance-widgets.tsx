"use client";

// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : components/finance/finance-widgets.tsx — TROIS PETITS WIDGETS DU TABLEAU DE BORD
// ═══════════════════════════════════════════════════════════════════════════
// POURQUOI UN FICHIER « CLIENT » ? La page du tableau de bord est un Server Component : elle ne peut
// pas appeler useI18n() (le hook de langue, qui vit dans le navigateur). Ces widgets reçoivent donc les
// données en paramètres et gèrent eux-mêmes l'affichage dans la bonne langue.
//   • Money         : affiche un montant formaté selon la langue (« 1 234,500 DT » / « 1٬234٫500 د.ت »)
//   • ForecastSummary : le bloc de la PRÉVISION IA du mois
//   • CenterTable   : le tableau de COMPARAISON des centres
// ═══════════════════════════════════════════════════════════════════════════

import { useI18n } from "@/components/i18n/i18n-provider";
import { fmtMoney } from "@/lib/booking/format";
import type { Forecast } from "@/lib/finance/analytics";
import type { CenterComparison } from "@/lib/finance/reports";
import { RevenueChart } from "./revenue-chart";

// Montant formaté dans la langue courante. Le `<>…</>` est un « fragment » : un conteneur invisible.
export function Money({ value }: { value: number }) {
  const { lang } = useI18n();
  return <>{fmtMoney(value, lang)}</>;
}

// IA — Prévision du CA du mois : chiffre principal, fourchette et qualité mesurée du modèle.
// Les chiffres viennent de forecastMonth (lib/finance/analytics.ts).
export function ForecastSummary({ forecast }: { forecast: Forecast }) {
  const { t, lang } = useI18n();
  // Part du CA prévu déjà encaissée (0 à 100 %), pour la barre de progression.
  const progress = forecast.forecastTotal > 0 ? Math.min(100, (forecast.actualToDate / forecast.forecastTotal) * 100) : 0;
  return (
    <div>
      <p className="text-xs text-white/50">{t("Chiffre d'affaires attendu ce mois-ci")}</p>
      <p className="mt-1 text-3xl font-semibold text-white">{fmtMoney(forecast.forecastTotal, lang)}</p>
      {/* Fourchette basse – haute (intervalle de confiance d'environ 80 %). */}
      <p className="mt-1 text-xs text-white/50">
        {t("entre")} {fmtMoney(forecast.low, lang)} {t("et")} {fmtMoney(forecast.high, lang)}
      </p>
      {/* Barre de progression : `role="meter"` + attributs aria-* la décrivent aux lecteurs d'écran. */}
      <div className="mt-4 h-2.5 rounded-full bg-rose-gold/15" role="meter" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={t("Part déjà encaissée")}>
        <div className="h-full rounded-e-full bg-rose-gold" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1.5 flex justify-between text-xs text-white/50">
        <span>{t("Encaissé")} : {fmtMoney(forecast.actualToDate, lang)}</span>
        <span>{t("À venir")} : {fmtMoney(forecast.forecastRemaining, lang)}</span>
      </p>
      {/* Mini-graphique jour par jour : barres pleines (réel) puis hachurées (prévu). */}
      <div className="mt-4">
        <RevenueChart points={forecast.days.map((d) => ({ key: d.day, value: d.value, predicted: d.predicted }))} height={150} caption={t("Encaissé et prévu, jour par jour, pour le mois en cours")} />
      </div>
      {/* Tendance récente + erreur du modèle mesurée par « backtest » : on indique honnêtement la fiabilité de la prévision. */}
      <p className="mt-2 text-[11px] leading-relaxed text-white/40">
        {t("Tendance récente")} : {forecast.trend >= 1 ? "+" : ""}
        {Math.round((forecast.trend - 1) * 100)} %
        {forecast.backtestError != null && (
          <>
            {" · "}
            {t("erreur moyenne mesurée sur les 4 dernières semaines")} : {Math.round(forecast.backtestError * 100)} %
          </>
        )}
      </p>
    </div>
  );
}

// Tableau comparatif des centres (F6.5). Une ligne par centre ; badge ★ sur le plus rentable.
export function CenterTable({ rows }: { rows: CenterComparison[] }) {
  const { t, lang } = useI18n();
  // Centre au plus grand résultat : `reduce` garde le meilleur rencontré au fil de la liste.
  const best = rows.reduce((a, b) => (b.profit > a.profit ? b : a), rows[0]);
  return (
    // `overflow-x-auto` : sur mobile, le tableau défile horizontalement au lieu de déborder de l'écran.
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-xs text-white/45">
            <th className="px-2 py-2 text-start font-medium">{t("Centre")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("CA encaissé")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("Dépenses")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("Résultat")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("Marge")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("Ventes")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("Panier moyen")}</th>
          </tr>
        </thead>
        {/* `tabular-nums` : chiffres de même largeur → les colonnes de nombres s'alignent proprement. */}
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/5">
              <td className="px-2 py-3 text-white">
                {r.name}
                {/* Badge « le plus rentable » : seulement si plusieurs centres ET résultat positif. */}
                {r.id === best.id && rows.length > 1 && r.profit > 0 && (
                  <span className="ms-2 rounded-full bg-champagne/15 px-2 py-0.5 text-[10px] text-champagne">★ {t("le plus rentable")}</span>
                )}
              </td>
              <td className="px-2 py-3 text-end text-white/85">{fmtMoney(r.revenue, lang)}</td>
              <td className="px-2 py-3 text-end text-white/60">{fmtMoney(r.expenses, lang)}</td>
              {/* Résultat négatif : rouge ET flèche ▼ (l'information ne repose pas sur la seule couleur → accessibilité). */}
              <td className={`px-2 py-3 text-end font-medium ${r.profit < 0 ? "text-red-300" : "text-white"}`}>
                {r.profit < 0 ? "▼ " : ""}
                {fmtMoney(r.profit, lang)}
              </td>
              <td className="px-2 py-3 text-end text-white/70">{r.margin == null ? "—" : `${Math.round(r.margin * 100)} %`}</td>
              <td className="px-2 py-3 text-end text-white/70">{r.sales}</td>
              <td className="px-2 py-3 text-end text-white/70">{fmtMoney(r.averageBasket, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
