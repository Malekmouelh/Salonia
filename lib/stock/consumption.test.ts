// Module 5 (F5.3) — Consommation automatique au rendez-vous terminé : quantités, centre, idempotence, stock insuffisant, produits non suivis.
// Base MongoDB éphémère en mémoire. Lancer : npm test
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { createCustomer, createService, createUser, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Booking } from "@/lib/models/booking";
import { ServiceRecipe, StockLevel, StockMovement } from "@/lib/models/stock";
import { consumeStockForBooking } from "./consumption";
import { verifyLedger } from "./ledger";
import { addRecipeLine } from "./recipes";
import { activateProductInCenter, createProduct, recordStockMovement } from "./service";
import { expectOk, id, makeWorld, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});
beforeEach(async () => {
  w = await makeWorld(db);
});

const product = async (name: string, unit: "ML" | "G" | "PIECE" = "ML") => expectOk(await createProduct(w.ownerA(), { name, unit })).product.id;
const stock = async (productId: string, center = w.a1, quantity = 1000) => expectOk(await activateProductInCenter(w.ownerA(), { productId, centerId: id(center), initialQuantity: quantity }));
const level = async (productId: string, center = w.a1) => (await StockLevel.findOne({ productId, centerId: center._id }).lean())!;
const recipe = (serviceId: string, productId: string, quantityPerService: number, center = w.a1) => ServiceRecipe.create({ organizationId: w.orgA._id, centerId: center._id, serviceId, productId, quantityPerService });

async function booking(serviceIds: string[], status: "COMPLETED" | "CONFIRMED" | "NO_SHOW" = "COMPLETED", center = w.a1) {
  const staff = await createUser(w.orgA._id, [center._id], "Amira");
  const customer = await createCustomer(w.orgA._id);
  const start = new Date("2030-01-07T09:00:00Z");
  return Booking.create({
    organizationId: w.orgA._id,
    centerId: center._id,
    customerId: customer._id,
    staffId: staff._id,
    items: serviceIds.map((serviceId) => ({ serviceId, name: "Prestation", durationMinutes: 60, priceTnd: 50 })),
    totalTnd: 50,
    start,
    end: new Date(start.getTime() + 3_600_000),
    status,
    source: "STAFF",
  });
}

describe("consommation d'un rendez-vous terminé", () => {
  it("sort chaque produit de la recette du stock du centre du rendez-vous, et d'aucun autre centre", async () => {
    const keratin = await product("Kératine");
    const gloves = await product("Gants", "PIECE");
    await stock(keratin, w.a1, 1000);
    await stock(keratin, w.a2, 1000);
    await stock(gloves, w.a1, 50);
    const service = await createService(w.orgA._id, 60, 50, "Balayage");
    await recipe(id(service), keratin, 40);
    await recipe(id(service), gloves, 2);

    const b = await booking([id(service)]);
    assert.deepEqual(await consumeStockForBooking(id(b)), { consumed: 2, shortfalls: 0, skipped: 0 });
    assert.equal((await level(keratin)).quantity, 960);
    assert.equal((await level(gloves)).quantity, 48);
    assert.equal((await level(keratin, w.a2)).quantity, 1000); // l'autre centre n'est pas touché
    const m = (await StockMovement.findOne({ productId: keratin, centerId: w.a1._id, kind: "CONSUMPTION" }).lean())!;
    assert.deepEqual([m.delta, m.requested, m.shortfall, String(m.bookingId)], [-40, 40, 0, id(b)]);
    assert.deepEqual((await verifyLedger({ organizationId: id(w.orgA), productId: keratin, centerId: id(w.a1) })).issues, []);
  });

  it("additionne les prestations du rendez-vous (une prestation réservée deux fois compte deux fois, un produit partagé est agrégé)", async () => {
    const shampoo = await product("Shampoing");
    await stock(shampoo, w.a1, 1000);
    const cut = await createService(w.orgA._id, 60, 50, "Coupe");
    const brush = await createService(w.orgA._id, 30, 30, "Brushing");
    await recipe(id(cut), shampoo, 15);
    await recipe(id(brush), shampoo, 30);

    const b = await booking([id(cut), id(brush), id(cut)]);
    await consumeStockForBooking(id(b));
    assert.equal((await level(shampoo)).quantity, 1000 - (15 + 30 + 15));
    assert.equal(await StockMovement.countDocuments({ productId: shampoo, kind: "CONSUMPTION" }), 1); // un seul mouvement agrégé
  });

  it("est idempotent : rappels, appels simultanés et second chemin de clôture ne sortent rien de plus", async () => {
    const dye = await product("Teinture", "G");
    await stock(dye, w.a1, 500);
    const service = await createService(w.orgA._id);
    await recipe(id(service), dye, 40);
    const b = await booking([id(service)]);

    await Promise.all(Array.from({ length: 8 }, () => consumeStockForBooking(id(b))));
    await consumeStockForBooking(id(b));
    assert.equal(await StockMovement.countDocuments({ productId: dye, kind: "CONSUMPTION" }), 1);
    assert.equal((await level(dye)).quantity, 460);
    assert.deepEqual((await verifyLedger({ organizationId: id(w.orgA), productId: dye, centerId: id(w.a1) })).issues, []);
  });

  it("plafonne au stock disponible : jamais négatif, le manquant est enregistré ; un stock à zéro crée un mouvement nul", async () => {
    const mask = await product("Masque", "G");
    await stock(mask, w.a1, 30);
    const service = await createService(w.orgA._id);
    await recipe(id(service), mask, 50);

    const first = await booking([id(service)]);
    assert.deepEqual(await consumeStockForBooking(id(first)), { consumed: 1, shortfalls: 1, skipped: 0 });
    const m1 = (await StockMovement.findOne({ productId: mask, bookingId: first._id }).lean())!;
    assert.deepEqual([m1.delta, m1.requested, m1.shortfall, m1.balanceAfter], [-30, 50, 20, 0]);
    assert.equal((await level(mask)).quantity, 0);

    const second = await booking([id(service)]);
    await consumeStockForBooking(id(second));
    const m2 = (await StockMovement.findOne({ productId: mask, bookingId: second._id }).lean())!;
    assert.deepEqual([m2.delta, m2.requested, m2.shortfall], [0, 50, 50]);
    assert.equal((await level(mask)).quantity, 0);
    assert.deepEqual((await verifyLedger({ organizationId: id(w.orgA), productId: mask, centerId: id(w.a1) })).issues, []);
  });

  it("ne touche pas un produit non activé dans le centre (et n'empêche pas son activation avec stock initial ensuite)", async () => {
    const oil = await product("Huile");
    await stock(oil, w.a2, 100); // suivi à Sousse seulement
    const service = await createService(w.orgA._id);
    await recipe(id(service), oil, 10);

    const b = await booking([id(service)], "COMPLETED", w.a1);
    assert.deepEqual(await consumeStockForBooking(id(b)), { consumed: 0, shortfalls: 0, skipped: 1 });
    assert.equal(await StockMovement.countDocuments({ productId: oil, centerId: w.a1._id }), 0);
    const activated = await stock(oil, w.a1, 200);
    assert.equal(activated.initialStock, "RECORDED");
  });

  it("recette PROPRE à chaque centre : la même prestation consomme 40 ml à Tunis et 25 ml à Sousse ; sans recette dans le centre, rien ne sort", async () => {
    const shampoo = await product("Shampoing");
    await stock(shampoo, w.a1, 1000);
    await stock(shampoo, w.a2, 1000);
    await stock(shampoo, w.a3, 1000);
    const cut = await createService(w.orgA._id, 45, 35, "Coupe");
    await recipe(id(cut), shampoo, 40, w.a1);
    await recipe(id(cut), shampoo, 25, w.a2);

    await consumeStockForBooking(id(await booking([id(cut)], "COMPLETED", w.a1)));
    await consumeStockForBooking(id(await booking([id(cut)], "COMPLETED", w.a2)));
    assert.deepEqual(await consumeStockForBooking(id(await booking([id(cut)], "COMPLETED", w.a3))), { consumed: 0, shortfalls: 0, skipped: 0 }); // pas de recette à Djerba
    assert.equal((await level(shampoo, w.a1)).quantity, 960);
    assert.equal((await level(shampoo, w.a2)).quantity, 975);
    assert.equal((await level(shampoo, w.a3)).quantity, 1000);
  });

  it("ne consomme que les rendez-vous terminés, et seulement les produits des recettes", async () => {
    const gel = await product("Gel");
    const other = await product("Autre produit");
    await stock(gel, w.a1, 100);
    await stock(other, w.a1, 100);
    const service = await createService(w.orgA._id);
    await recipe(id(service), gel, 5);

    for (const status of ["CONFIRMED", "NO_SHOW"] as const) {
      const b = await booking([id(service)], status);
      assert.deepEqual(await consumeStockForBooking(id(b)), { consumed: 0, shortfalls: 0, skipped: 0 });
    }
    assert.deepEqual(await consumeStockForBooking(String(new Types.ObjectId())), { consumed: 0, shortfalls: 0, skipped: 0 }); // rendez-vous inconnu
    assert.equal((await level(gel)).quantity, 100);

    await consumeStockForBooking(id(await booking([id(service)])));
    assert.equal((await level(gel)).quantity, 95);
    assert.equal((await level(other)).quantity, 100); // hors recette : intact
  });

  it("une prestation sans recette ne fait rien ; les recettes d'une autre organisation ne s'appliquent jamais", async () => {
    const stuff = await product("Produit");
    await stock(stuff, w.a1, 100);
    const plain = await createService(w.orgA._id, 30, 20, "Sans recette");
    assert.deepEqual(await consumeStockForBooking(id(await booking([id(plain)]))), { consumed: 0, shortfalls: 0, skipped: 0 });

    const foreign = await createService(w.orgB._id);
    await ServiceRecipe.create({ organizationId: w.orgB._id, centerId: w.b1._id, serviceId: foreign._id, productId: stuff, quantityPerService: 10 });
    const b = await booking([id(foreign)]); // rendez-vous de A qui référencerait un service de B : la recette de B est ignorée
    assert.deepEqual(await consumeStockForBooking(id(b)), { consumed: 0, shortfalls: 0, skipped: 0 });
    assert.equal((await level(stuff)).quantity, 100);
  });

  it("le stock saisi à la main reste cohérent avec les consommations (journal contigu)", async () => {
    const wax = await product("Cire", "G");
    await stock(wax, w.a1, 100);
    const service = await createService(w.orgA._id);
    await recipe(id(service), wax, 10);
    await consumeStockForBooking(id(await booking([id(service)])));
    expectOk(await recordStockMovement(w.ownerA(), { productId: wax, centerId: id(w.a1), kind: "IN", quantity: 50 }));
    await consumeStockForBooking(id(await booking([id(service)])));
    assert.equal((await level(wax)).quantity, 100 - 10 + 50 - 10);
    assert.deepEqual((await verifyLedger({ organizationId: id(w.orgA), productId: wax, centerId: id(w.a1) })).issues, []);
  });
});

describe("scénario complet : produit consommable → recette → rendez-vous terminé", () => {
  it("shampoing 30 ml, recette « Coupe femme » à 40 ml : la recette est acceptée, le 1er rendez-vous vide le stock et note 10 ml manquants, le 2e note 40 ml manquants", async () => {
    const shampoo = await product("Shampoing", "ML");
    await stock(shampoo, w.a1, 30); // le salon n'a ajouté que 30 ml
    const cut = await createService(w.orgA._id, 45, 35, "Coupe femme");
    // L'alerte est dans l'interface : le service accepte la recette (elle peut précéder une livraison).
    expectOk(await addRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: id(cut), productId: shampoo, quantityPerService: 40 }));

    const first = await booking([id(cut)]);
    assert.deepEqual(await consumeStockForBooking(id(first), w.ownerA().id), { consumed: 1, shortfalls: 1, skipped: 0 });
    assert.equal((await level(shampoo)).quantity, 0);
    const m1 = (await StockMovement.findOne({ productId: shampoo, bookingId: first._id }).lean())!;
    assert.deepEqual([m1.delta, m1.requested, m1.shortfall], [-30, 40, 10]);

    // Après un réapprovisionnement de 100 ml, le rendez-vous suivant consomme normalement.
    expectOk(await recordStockMovement(w.ownerA(), { productId: shampoo, centerId: id(w.a1), kind: "IN", quantity: 100 }));
    await consumeStockForBooking(id(await booking([id(cut)])));
    assert.equal((await level(shampoo)).quantity, 60);

    // Rappeler la consommation du premier rendez-vous ne change rien (idempotence).
    await consumeStockForBooking(id(first));
    assert.equal((await level(shampoo)).quantity, 60);
    assert.deepEqual((await verifyLedger({ organizationId: id(w.orgA), productId: shampoo, centerId: id(w.a1) })).issues, []);
  });
});
