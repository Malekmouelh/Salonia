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

const dateFmt = (d: Date | string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Tunis" }).format(new Date(d));

// Séparateur « ; » et virgule décimale : format attendu par Excel en français.
const num = (v: number) => plainTnd(v).replace(".", ",");
const cell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (headers: string[], rows: (string | number)[][]) =>
  "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!canViewFinance(user) || !user.organization) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "report";
  const format = sp.get("format") === "pdf" ? "pdf" : "csv";
  const center = sp.get("center");
  const scope = financeScope(user, center);
  if (!scope) return NextResponse.json({ error: "Aucun centre accessible" }, { status: 403 });
  const range = resolveRange(sp.get("period"), sp.get("from"), sp.get("to"));
  const stamp = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;
  const centerId = center && center !== "all" ? center : undefined;

  let body: string | Uint8Array;
  let filename: string;

  if (type === "payments") {
    const rows = await listPayments(user, { centerIds: scope.centerIds, from: range.from, to: range.to });
    body = csv(
      ["Date", "Reçu", "Facture", "Centre", "Client", "Type", "Moyen", "Montant (DT)", "Référence"],
      rows.map((p) => [dateFmt(p.paidAt), p.receiptNumber, p.invoiceNumber, p.center, p.customer, KIND_LABELS[p.kind], METHOD_LABELS[p.method], num(p.amountTnd), p.reference]),
    );
    filename = `paiements_${stamp}.csv`;
  } else if (type === "invoices") {
    const rows = await listInvoices(user, { centerId, from: range.from, to: range.to, limit: 5000 });
    body = csv(
      ["Numéro", "Date", "Centre", "Client", "Prestations", "Remise (DT)", "Total TTC (DT)", "Réglé (DT)", "Statut"],
      rows.map((i) => [i.number, dateFmt(i.issuedAt), i.center, i.customerName, i.lines, num(i.discountTnd), num(i.totalTnd), num(i.paidTnd), INVOICE_STATUS_META[i.status].label]),
    );
    filename = `factures_${stamp}.csv`;
  } else if (type === "expenses") {
    const rows = await listExpenses(user, { centerId, from: range.from, to: range.to });
    body = csv(
      ["Date", "Centre", "Catégorie", "Libellé", "Fournisseur", "Moyen", "Montant (DT)"],
      rows.map((e) => [e.date, e.center, EXPENSE_LABELS[e.category], e.label, e.supplier ?? "", EXPENSE_METHOD_LABELS[e.method] ?? e.method, num(e.amountTnd)]),
    );
    filename = `depenses_${stamp}.csv`;
  } else {
    const [summary, centers, services, expenses] = await Promise.all([
      getSummary(scope, range),
      compareCenters(scope, range),
      getBreakdown(scope, range, "service", 15),
      getBreakdown(scope, range, "category", 10),
    ]);
    if (format === "pdf") {
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

  await logEvent("FINANCE_EXPORTED", { userId: user.id, organizationId: user.organization.id, detail: `${type}.${format} ${stamp}` });
  return new NextResponse(typeof body === "string" ? body : Buffer.from(body), {
    headers: {
      "Content-Type": typeof body === "string" ? "text/csv; charset=utf-8" : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
