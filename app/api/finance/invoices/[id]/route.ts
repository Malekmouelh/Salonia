import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { loadInvoicePdf } from "@/lib/finance/documents";
import { invoicePdf } from "@/lib/finance/pdf";

// F6.3 — Facture PDF numérotée (?download=1 pour forcer le téléchargement).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/finance/invoices/[id]">) {
  const user = await getCurrentUser();
  const data = await loadInvoicePdf(user, (await ctx.params).id);
  if (!data) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
  const pdf = await invoicePdf(data);
  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${data.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
