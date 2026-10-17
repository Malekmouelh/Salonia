import { NextResponse, type NextRequest } from "next/server";
import { loadReceiptPdfByToken } from "@/lib/finance/documents";
import { receiptPdf } from "@/lib/finance/pdf";

// Reçu du paiement en ligne, téléchargeable par le client depuis son lien de paiement.
export async function GET(_req: NextRequest, ctx: RouteContext<"/paiement/[token]/recu">) {
  const data = await loadReceiptPdfByToken((await ctx.params).token);
  if (!data) return NextResponse.json({ error: "Reçu indisponible" }, { status: 404 });
  const pdf = await receiptPdf(data);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
