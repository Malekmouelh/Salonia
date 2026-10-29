// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/api/finance/closings/[id]/route.ts — RAPPORT DE CLÔTURE DE CAISSE EN PDF
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /api/finance/closings/<identifiant-de-la-clôture>
// Même principe que les routes des factures et des reçus : on charge les données avec contrôle d'accès
// (propriétaire et gérant, pour leurs centres), on dessine le PDF, on l'envoie au navigateur.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { loadClosingPdf } from "@/lib/finance/documents";
import { closingPdf } from "@/lib/finance/pdf";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/finance/closings/[id]">) {
  const user = await getCurrentUser();
  const data = await loadClosingPdf(user, (await ctx.params).id);
  // Introuvable ou interdit : 404 dans les deux cas (on ne révèle rien).
  if (!data) return NextResponse.json({ error: "Clôture introuvable" }, { status: 404 });
  const pdf = await closingPdf(data);
  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="cloture_${data.day}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
