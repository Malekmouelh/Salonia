// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/api/finance/receipts/[id]/route.ts — TÉLÉCHARGEMENT D'UN REÇU EN PDF
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /api/finance/receipts/<identifiant-du-paiement>
// Même principe que la route des factures. Le reçu prouve un paiement, un acompte ou un remboursement.
// DROITS : un utilisateur connecté ne voit que les reçus de son salon et de ses centres ; le staff ne
// voit que ceux des paiements qu'il a lui-même encaissés (vérifié dans loadReceiptPdf).
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { loadReceiptPdf } from "@/lib/finance/documents";
import { receiptPdf } from "@/lib/finance/pdf";

// F6.3 — Reçu PDF numéroté d'un paiement, d'un acompte ou d'un remboursement.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/finance/receipts/[id]">) {
  const user = await getCurrentUser();
  const data = await loadReceiptPdf(user, (await ctx.params).id);
  // Introuvable ou interdit : 404 dans les deux cas.
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
