// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : app/api/finance/invoices/[id]/route.ts — TÉLÉCHARGEMENT D'UNE FACTURE EN PDF
// ═══════════════════════════════════════════════════════════════════════════
// ADRESSE : /api/finance/invoices/<identifiant-de-la-facture>
//   Les crochets [id] dans le nom du dossier signifient « segment dynamique » : la valeur écrite à
//   cet endroit de l'adresse est transmise au code (ici, l'identifiant de la facture).
// FLUX : charger les données (avec contrôle d'accès) → dessiner le PDF → l'envoyer au navigateur.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { loadInvoicePdf } from "@/lib/finance/documents";
import { invoicePdf } from "@/lib/finance/pdf";

// F6.3 — Facture PDF numérotée (?download=1 pour forcer le téléchargement).
// `RouteContext<"/api/finance/invoices/[id]">` est un type fourni par Next.js (généré automatiquement)
// qui décrit les paramètres de cette route : ici `ctx.params.id`.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/finance/invoices/[id]">) {
  const user = await getCurrentUser();
  // `params` est asynchrone dans cette version de Next.js, d'où le `await`.
  const data = await loadInvoicePdf(user, (await ctx.params).id);
  // `null` = facture inexistante OU non autorisée → même réponse 404 dans les deux cas (on ne révèle rien).
  if (!data) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
  const pdf = await invoicePdf(data);
  // « inline » = afficher le PDF dans l'onglet ; « attachment » (si ?download est présent) = télécharger.
  const disposition = req.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${data.number}.pdf"`, // le fichier porte le numéro de facture
      "Cache-Control": "private, no-store", // document confidentiel : ne pas mettre en cache
    },
  });
}
