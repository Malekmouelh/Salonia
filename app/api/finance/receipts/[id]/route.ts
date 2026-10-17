import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { loadReceiptPdf } from "@/lib/finance/documents";
import { receiptPdf } from "@/lib/finance/pdf";

// F6.3 — Reçu PDF numéroté d'un paiement, d'un acompte ou d'un remboursement.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/finance/receipts/[id]">) {
  const user = await getCurrentUser();
  const data = await loadReceiptPdf(user, (await ctx.params).id);
  if (!data) return NextResponse.json({ error: "Reçu introuvable" }, { status: 404 });
  const pdf = await receiptPdf(data);
  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${data.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
