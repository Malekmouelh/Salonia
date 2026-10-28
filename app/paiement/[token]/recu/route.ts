// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/paiement/[token]/recu/route.ts — REÇU PDF POUR LE CLIENT (paiement en ligne)
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /paiement/<jeton>/recu   (le jeton = celui du lien de paiement envoyé au client)
// DIFFÉRENCE AVEC /api/finance/receipts/[id] : ici AUCUNE connexion n'est demandée, car le client n'a
// pas de compte. Le jeton secret (impossible à deviner, 192 bits aléatoires) prouve que c'est bien lui.
// Cette route est hors de /api et /dashboard : le middleware de session (proxy.ts) ne la protège pas.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { loadReceiptPdfByToken } from "@/lib/finance/documents";
import { receiptPdf } from "@/lib/finance/pdf";

// Reçu du paiement en ligne, téléchargeable par le client depuis son lien de paiement.
// `_req` : le préfixe « _ » indique qu'on n'utilise pas ce paramètre.
export async function GET(_req: NextRequest, ctx: RouteContext<"/paiement/[token]/recu">) {
  const data = await loadReceiptPdfByToken((await ctx.params).token);
  // Jeton inconnu, ou paiement pas encore confirmé (pas de reçu) : 404.
  if (!data) return NextResponse.json({ error: "Reçu indisponible" }, { status: 404 });
  const pdf = await receiptPdf(data);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
      // Demande aux moteurs de recherche de ne pas indexer ce document.
      "X-Robots-Tag": "noindex",
    },
  });
}
