// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/api/finance/export/route.ts — L'EXPORT DES DONNÉES (F6.6)
// ═══════════════════════════════════════════════════════════════════════════
// QU'EST-CE QU'UNE « ROUTE API » ? (« Route Handler » de Next.js)
//   Un fichier `route.ts` définit une adresse web qui répond avec des DONNÉES (un fichier, du JSON…)
//   et non avec une page. Ici, l'adresse est /api/finance/export. La fonction `GET` est appelée
//   quand le navigateur ouvre cette adresse (clic sur « Exporter »).
//
// EXEMPLES D'APPELS (paramètres dans l'adresse, après « ? ») :
//   /api/finance/export?type=payments&format=csv&period=month&center=all
//   /api/finance/export?type=report&format=pdf&period=last-month
//   type   = payments | invoices | expenses | report
//   format = csv (fichier Excel) | pdf (seulement pour le rapport)
//
// SÉCURITÉ : réservé au propriétaire et au gérant ; les données sont limitées à leurs centres.
//   Chaque export est inscrit au journal de sécurité (traçabilité : qui a exporté quoi, quand).
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { logEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/dal";
import { listExpenses, listInvoices, listPayments } from "@/lib/data/finance";
import { EXPENSE_LABELS, EXPENSE_METHOD_LABELS, INVOICE_STATUS_META, KIND_LABELS, METHOD_LABELS } from "@/lib/finance/labels";
import { plainTnd } from "@/lib/finance/money";
import { reportPdf } from "@/lib/finance/pdf";
import { compareCenters, financeScope, getBreakdown, getSummary, resolveRange } from "@/lib/finance/reports";
import { canViewFinance } from "@/lib/finance/service";

// F6.6 — Export des données : CSV (ouvrable dans Excel) ou rapport PDF.
// /api/finance/export?type=payments|invoices|expenses|report&format=csv|pdf&period=month&center=all

// Date et heure au format français (JJ/MM/AAAA HH:MM), en heure de Tunis.
const dateFmt = (d: Date | string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Tunis" }).format(new Date(d));

// ───────────── Fabrication d'un fichier CSV ─────────────
// CSV = « Comma-Separated Values » : un fichier texte où chaque ligne est un enregistrement et les
// colonnes sont séparées par un caractère. Excel l'ouvre directement.
// Séparateur « ; » et virgule décimale : format attendu par Excel en français.
// (Excel en français utilise « ; » comme séparateur et « , » pour les décimales : 12,500.)
const num = (v: number) => plainTnd(v).replace(".", ",");
// Protège une cellule : si elle contient un guillemet, un « ; » ou un retour à la ligne, on l'entoure de
// guillemets et on double les guillemets internes (règle standard du CSV). Sans ça, un client nommé
// « Dupont; Jean » décalerait toutes les colonnes.
const cell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Assemble le fichier : en-têtes + lignes, colonnes séparées par « ; », lignes par retour chariot.
// Le caractère ﻿ au début est le « BOM » (marque d'ordre des octets) : il indique à Excel que le
// fichier est en UTF-8, sans quoi les accents (é, è…) s'afficheraient mal.
const csv = (headers: string[], rows: (string | number)[][]) =>
  "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");

// Fonction appelée pour une requête HTTP GET (ouverture de l'adresse).
export async function GET(req: NextRequest) {
  // 1. Qui demande ? Seuls propriétaire et gérant ont le droit. Sinon : erreur HTTP 403 (« Interdit »).
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  // 2. Lecture des paramètres de l'adresse (?type=…&format=…).
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "report";
  const format = sp.get("format") === "pdf" ? "pdf" : "csv";
  const center = sp.get("center");
  // Périmètre : tous les centres autorisés, ou un seul s'il est demandé ET autorisé.
  const scope = financeScope(user, center);
  if (!scope) return NextResponse.json({ error: "Aucun centre accessible" }, { status: 403 });
  const range = resolveRange(sp.get("period"), sp.get("from"), sp.get("to"));
  // Suffixe du nom de fichier : « 2026-10-01_2026-10-18 ».
  const stamp = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;
  const centerId = center && center !== "all" ? center : undefined;

  // Contenu du fichier : du texte (CSV) ou des octets (PDF). Nom proposé au téléchargement.
  let body: string | Uint8Array;
  let filename: string;

  // 3. Selon le type demandé, on fabrique le bon fichier.
  if (type === "payments") {
    // Liste des paiements de la période (1 ligne par paiement).
    const rows = await listPayments(user, { centerIds: scope.centerIds, from: range.from, to: range.to });
    body = csv(
      ["Date", "Reçu", "Facture", "Centre", "Client", "Type", "Moyen", "Montant (DT)", "Référence"],
      rows.map((p) => [dateFmt(p.paidAt), p.receiptNumber, p.invoiceNumber, p.center, p.customer, KIND_LABELS[p.kind], METHOD_LABELS[p.method], num(p.amountTnd), p.reference]),
    );
    filename = `paiements_${stamp}.csv`;
  } else if (type === "invoices") {
    // Liste des factures (jusqu'à 5000 lignes).
    const rows = await listInvoices(user, { centerId, from: range.from, to: range.to, limit: 5000 });
    body = csv(
      ["Numéro", "Date", "Centre", "Client", "Prestations", "Remise (DT)", "Total TTC (DT)", "Réglé (DT)", "Statut"],
      rows.map((i) => [i.number, dateFmt(i.issuedAt), i.center, i.customerName, i.lines, num(i.discountTnd), num(i.totalTnd), num(i.paidTnd), INVOICE_STATUS_META[i.status].label]),
    );
    filename = `factures_${stamp}.csv`;
  } else if (type === "expenses") {
    // Liste des dépenses.
    const rows = await listExpenses(user, { centerId, from: range.from, to: range.to });
    body = csv(
      ["Date", "Centre", "Catégorie", "Libellé", "Fournisseur", "Moyen", "Montant (DT)"],
      rows.map((e) => [e.date, e.center, EXPENSE_LABELS[e.category], e.label, e.supplier ?? "", EXPENSE_METHOD_LABELS[e.method] ?? e.method, num(e.amountTnd)]),
    );
    filename = `depenses_${stamp}.csv`;
  } else {
    // « report » : synthèse. On calcule les 4 jeux de données EN PARALLÈLE avec Promise.all.
    const [summary, centers, services, expenses] = await Promise.all([
      getSummary(scope, range),
      compareCenters(scope, range),
      getBreakdown(scope, range, "service", 15),
      getBreakdown(scope, range, "category", 10),
    ]);
    if (format === "pdf") {
      // Rapport PDF complet (voir lib/finance/pdf.ts).
      body = await reportPdf({
        organization: { name: user.organization.name },
        scopeLabel: scope.centers.length > 1 ? "Vue consolidée" : scope.centers[0].name,
        periodLabel: range.label,
        generatedAt: new Date(),
        summary,
        centers,
        services,
        expenses,
        methods: summary.byMethod.map((m) => ({ label: METHOD_LABELS[m.method], amount: m.amount })),
      });
      filename = `rapport_financier_${stamp}.pdf`;
    } else {
      // Synthèse CSV : une ligne par centre + une ligne « Total ».
      body = csv(
        ["Centre", "CA encaissé (DT)", "Dépenses (DT)", "Résultat (DT)", "Marge", "Ventes", "Panier moyen (DT)"],
        [
          ...centers.map((c) => [c.name, num(c.revenue), num(c.expenses), num(c.profit), c.margin == null ? "" : `${Math.round(c.margin * 100)} %`, c.sales, num(c.averageBasket)]),
          ["Total", num(summary.revenue), num(summary.expenses), num(summary.profit), summary.margin == null ? "" : `${Math.round(summary.margin * 100)} %`, summary.sales, num(summary.averageBasket)],
        ],
      );
      filename = `synthese_${stamp}.csv`;
    }
  }

  // 4. Traçabilité : l'export est inscrit au journal de sécurité.
  await logEvent("FINANCE_EXPORTED", { userId: user.id, organizationId: user.organization.id, detail: `${type}.${format} ${stamp}` });
  // 5. Réponse HTTP : le contenu + des en-têtes qui disent au navigateur quoi en faire.
  return new NextResponse(typeof body === "string" ? body : Buffer.from(body), {
    headers: {
      // Type du contenu (CSV en UTF-8 ou PDF).
      "Content-Type": typeof body === "string" ? "text/csv; charset=utf-8" : "application/pdf",
      // « attachment » = télécharger plutôt qu'afficher, sous le nom indiqué.
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Données confidentielles : interdit aux caches (navigateur, proxy) de les conserver.
      "Cache-Control": "private, no-store",
    },
  });
}
