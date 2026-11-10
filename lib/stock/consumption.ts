import { connectDB } from "@/lib/db";
import { Booking } from "@/lib/models/booking";
import { ServiceRecipe, StockLevel } from "@/lib/models/stock";
import { commitConsumption, projectLevel } from "./ledger";

// Module 5 (F5.3) — Consommation automatique : quand un rendez-vous est terminé, chaque produit des recettes de ses prestations sort du
// stock du CENTRE du rendez-vous. Seuls les produits consommables ont une recette ; le matériel durable (sèche-cheveux, fauteuil…) n'est
// jamais décrémenté : il reste dans l'onglet Matériel.
//
// Règles :
//  - Une seule sortie par (rendez-vous, produit), quels que soient le nombre d'appels, de chemins (calendrier, caisse) ou de reprises :
//    l'idempotence est portée par l'index unique {bookingId, productId} du journal. Un rendez-vous repassé à « terminé » ne consomme pas deux fois.
//  - La quantité d'un produit est la somme des lignes de recette des prestations du rendez-vous (une prestation réservée deux fois compte deux fois).
//  - Jamais de stock négatif : la sortie est plafonnée au solde, le manquant est enregistré sur le mouvement (visible dans l'historique).
//  - Un produit non activé dans ce centre n'est pas suivi là : rien n'est enregistré (créer un journal sans niveau empêcherait ensuite le stock
//    initial de l'activation).
//  - Pas de restitution si le rendez-vous quitte l'état « terminé » (règle D9 du schéma).
//
// Appelé par le serveur APRÈS le changement de statut, avec l'identifiant du rendez-vous : aucune saisie du client n'est lue ici. L'appelant
// doit capturer l'échec : la clôture d'un rendez-vous ne doit jamais être bloquée par le stock.

export type ConsumptionSummary = { consumed: number; shortfalls: number; skipped: number };

export async function consumeStockForBooking(bookingId: string, userId?: string): Promise<ConsumptionSummary> {
  const summary: ConsumptionSummary = { consumed: 0, shortfalls: 0, skipped: 0 };
  await connectDB();
  const booking = await Booking.findById(bookingId).select("organizationId centerId items status").lean();
  if (!booking || booking.status !== "COMPLETED") return summary;

  const organizationId = String(booking.organizationId);
  const centerId = String(booking.centerId);
  const serviceIds = [...new Set(booking.items.map((i) => String(i.serviceId)))];
  if (serviceIds.length === 0) return summary;

  // Recette PROPRE au centre du rendez-vous : celle d'un autre centre n'est jamais appliquée.
  const recipes = await ServiceRecipe.find({ organizationId, centerId, serviceId: { $in: serviceIds } }).lean();
  if (recipes.length === 0) return summary;

  // Quantité totale par produit sur tout le rendez-vous.
  const timesBooked = new Map<string, number>();
  for (const item of booking.items) timesBooked.set(String(item.serviceId), (timesBooked.get(String(item.serviceId)) ?? 0) + 1);
  const requested = new Map<string, number>();
  for (const line of recipes) {
    const quantity = line.quantityPerService * (timesBooked.get(String(line.serviceId)) ?? 0);
    requested.set(String(line.productId), (requested.get(String(line.productId)) ?? 0) + quantity);
  }

  const tracked = new Set((await StockLevel.find({ organizationId, centerId, productId: { $in: [...requested.keys()] } }).select("productId").lean()).map((l) => String(l.productId)));

  for (const [productId, quantity] of requested) {
    if (!tracked.has(productId) || quantity <= 0) {
      summary.skipped++;
      continue;
    }
    const result = await commitConsumption({ organizationId, centerId, productId, bookingId, requested: quantity, createdBy: userId });
    if (!result.created) continue;
    summary.consumed++;
    if (result.shortfall > 0) summary.shortfalls++;
    // Étape 4 de D6 : si la projection échoue, le journal fait foi et la page de stock réaligne le niveau.
    await projectLevel({ organizationId, centerId, productId, seq: result.movement.seq, balanceAfter: result.movement.balanceAfter }).catch((error) => {
      console.error("Projection de consommation en échec (réalignée à la prochaine lecture) :", error);
    });
  }
  return summary;
}
