// Module 5 — Recettes de consommation par service : droits (propriétaire seulement), isolation entre organisations, validation,
// produit archivé, absence d'effet sur les mouvements historiques. Base MongoDB éphémère en mémoire. Aucune action serveur appelée,
// aucune consommation : les recettes sont de la configuration. Lancer : npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createService, startTestDb, type TestDb } from "@/lib/booking/test-support";
import { Service } from "@/lib/models/catalog";
import { ServiceRecipe, StockMovement } from "@/lib/models/stock";
import { MSG_RECIPE_DUPLICATE, MSG_RECIPE_LINE_NOT_FOUND, MSG_SERVICE_NOT_FOUND, addRecipeLine, countRecipeLinesByService, listServiceRecipe, removeRecipeLine, updateRecipeLine } from "./recipes";
import { MSG_STOCK_CENTER_NOT_FOUND, MSG_STOCK_FORBIDDEN } from "./scope";
import { MSG_PRODUCT_ARCHIVED, MSG_PRODUCT_NOT_FOUND, activateProductInCenter, archiveProduct, createProduct, recordStockMovement } from "./service";
import { expectFail, expectOk, forbiddenActors, id, makeWorld, newId, type World } from "./test-fixtures";

let db: TestDb;
let w: World;
before(async () => {
  db = await startTestDb();
});
after(async () => {
  await db?.stop();
});

let coloring: string, haircut: string, shampoo: string, dye: string, foreignService: string, foreignProduct: string;
beforeEach(async () => {
  w = await makeWorld(db);
  coloring = id(await createService(w.orgA._id, 90, 80, "Coloration"));
  haircut = id(await createService(w.orgA._id, 30, 25, "Coupe"));
  foreignService = id(await createService(w.orgB._id, 30, 25, "Service B"));
  shampoo = expectOk(await createProduct(w.ownerA(), { name: "Shampoing", unit: "ML" })).product.id;
  dye = expectOk(await createProduct(w.ownerA(), { name: "Colorant", unit: "G" })).product.id;
  foreignProduct = expectOk(await createProduct(w.ownerB(), { name: "Produit B", unit: "ML" })).product.id;
});

const line = (extra: Record<string, unknown> = {}) => ({ centerId: id(w.a1), serviceId: coloring, productId: dye, quantityPerService: 40, ...extra });
const lines = async (serviceId = coloring) => (await ServiceRecipe.find({ serviceId, centerId: w.a1._id }).sort({ productId: 1 }).lean()).map((r) => [String(r.productId), r.quantityPerService]);

describe("une recette est propre à chaque centre", () => {
  it("la même prestation a des quantités différentes dans deux centres du même propriétaire, sans se mélanger", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line({ centerId: id(w.a1), quantityPerService: 40 })));
    expectOk(await addRecipeLine(w.ownerA(), line({ centerId: id(w.a2), quantityPerService: 25 }))); // même service, même produit : pas un doublon
    expectOk(await addRecipeLine(w.ownerA(), line({ centerId: id(w.a2), productId: shampoo, quantityPerService: 10 })));
    const read = async (center: string) => expectOk(await listServiceRecipe(w.ownerA(), { centerId: center, serviceId: coloring })).lines.map((l) => [l.productName, l.quantityPerService, l.centerId]);
    assert.deepEqual(await read(id(w.a1)), [["Colorant", 40, id(w.a1)]]);
    assert.deepEqual(await read(id(w.a2)), [["Colorant", 25, id(w.a2)], ["Shampoing", 10, id(w.a2)]]);
    assert.deepEqual(await read(id(w.a3)), []); // un centre sans recette n'hérite de rien

    expectOk(await updateRecipeLine(w.ownerA(), line({ centerId: id(w.a2), quantityPerService: 99 })));
    assert.equal((await read(id(w.a1)))[0][1], 40); // la modification d'un centre ne touche pas l'autre
    expectFail(await updateRecipeLine(w.ownerA(), line({ centerId: id(w.a3) })), MSG_RECIPE_LINE_NOT_FOUND);

    expectOk(await removeRecipeLine(w.ownerA(), { centerId: id(w.a2), serviceId: coloring, productId: dye }));
    expectFail(await removeRecipeLine(w.ownerA(), { centerId: id(w.a3), serviceId: coloring, productId: dye }), MSG_RECIPE_LINE_NOT_FOUND);
    assert.deepEqual(await read(id(w.a1)), [["Colorant", 40, id(w.a1)]]); // la suppression d'un centre ne touche pas l'autre
  });

  it("un centre d'une autre organisation ou inconnu est refusé (« Centre introuvable. »), sans écriture", async () => {
    for (const centerId of [id(w.b1), newId()]) {
      expectFail(await addRecipeLine(w.ownerA(), line({ centerId })), MSG_STOCK_CENTER_NOT_FOUND);
      expectFail(await updateRecipeLine(w.ownerA(), line({ centerId })), MSG_STOCK_CENTER_NOT_FOUND);
      expectFail(await removeRecipeLine(w.ownerA(), { centerId, serviceId: coloring, productId: dye }), MSG_STOCK_CENTER_NOT_FOUND);
      expectFail(await listServiceRecipe(w.ownerA(), { centerId, serviceId: coloring }), MSG_STOCK_CENTER_NOT_FOUND);
    }
    assert.equal(await ServiceRecipe.countDocuments(), 0);
  });
});

describe("nombre de produits par service dans un centre", () => {
  it("compte seulement les lignes du centre demandé ; un service sans recette est absent ; centre étranger et STAFF refusés", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectOk(await addRecipeLine(w.ownerA(), line({ productId: shampoo })));
    expectOk(await addRecipeLine(w.ownerA(), line({ centerId: id(w.a2), serviceId: haircut, productId: shampoo })));
    assert.deepEqual(expectOk(await countRecipeLinesByService(w.ownerA(), { centerId: id(w.a1) })).counts, { [coloring]: 2 });
    assert.deepEqual(expectOk(await countRecipeLinesByService(w.ownerA(), { centerId: id(w.a2) })).counts, { [haircut]: 1 });
    assert.deepEqual(expectOk(await countRecipeLinesByService(w.ownerA(), { centerId: id(w.a3) })).counts, {});
    expectFail(await countRecipeLinesByService(w.ownerA(), { centerId: id(w.b1) }), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await countRecipeLinesByService(w.actor("STAFF", w.orgA, [w.a1]), { centerId: id(w.a1) }), MSG_STOCK_FORBIDDEN);
    assert.deepEqual(expectOk(await countRecipeLinesByService(w.managerA(w.a1), { centerId: id(w.a1) })).counts, { [coloring]: 2 });
  });
});

describe("droits : propriétaire (tous les centres) et gérant (ses centres) ; les autres rôles sont refusés", () => {
  it("STAFF, CLIENT, SUPER_ADMIN et un acteur sans organisation sont refusés partout, sans écriture", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    const before = JSON.stringify(await ServiceRecipe.find().sort({ _id: 1 }).lean());
    const refused: [string, ReturnType<World["actor"]>][] = [...forbiddenActors(w)];
    for (const [label, who] of refused) {
      for (const [name, result] of [
        ["addRecipeLine", await addRecipeLine(who, line({ productId: shampoo }))],
        ["updateRecipeLine", await updateRecipeLine(who, line({ quantityPerService: 99 }))],
        ["removeRecipeLine", await removeRecipeLine(who, { centerId: id(w.a1), serviceId: coloring, productId: dye })],
        ["listServiceRecipe", await listServiceRecipe(who, { centerId: id(w.a1), serviceId: coloring })],
      ] as const) assert.equal(expectFail(result, MSG_STOCK_FORBIDDEN).message, MSG_STOCK_FORBIDDEN, `${label} : ${name}`);
    }
    assert.equal(JSON.stringify(await ServiceRecipe.find().sort({ _id: 1 }).lean()), before);
  });
});

describe("le gérant ne gère que les recettes de SES centres", () => {
  it("ajoute, modifie, lit et supprime dans son centre ; refusé (« Centre introuvable. ») dans un centre qui n'est pas le sien, sans écriture", async () => {
    const manager = w.managerA(w.a1); // gérant du seul centre 1
    expectOk(await addRecipeLine(manager, line({ quantityPerService: 40 })));
    expectOk(await updateRecipeLine(manager, line({ quantityPerService: 55 })));
    assert.equal(expectOk(await listServiceRecipe(manager, { centerId: id(w.a1), serviceId: coloring })).lines[0].quantityPerService, 55);
    expectFail(await addRecipeLine(manager, line({ centerId: id(w.a2) })), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await updateRecipeLine(manager, line({ centerId: id(w.a2) })), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await listServiceRecipe(manager, { centerId: id(w.a2), serviceId: coloring }), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await countRecipeLinesByService(manager, { centerId: id(w.a3) }), MSG_STOCK_CENTER_NOT_FOUND);
    // la recette d'un autre centre existe : le gérant ne peut ni la lire ni la supprimer
    expectOk(await addRecipeLine(w.ownerA(), line({ centerId: id(w.a2), quantityPerService: 25 })));
    expectFail(await removeRecipeLine(manager, { centerId: id(w.a2), serviceId: coloring, productId: dye }), MSG_STOCK_CENTER_NOT_FOUND);
    assert.equal(await ServiceRecipe.countDocuments({ centerId: w.a2._id }), 1);
    expectOk(await removeRecipeLine(manager, { centerId: id(w.a1), serviceId: coloring, productId: dye }));
  });
});

describe("création d'une ligne", () => {
  it("ajoute un produit à la recette d'un service ; l'unité vient du produit, l'organisation de l'acteur", async () => {
    const r = expectOk(await addRecipeLine(w.ownerA(), line({ organizationId: id(w.orgB), unit: "ML", productName: "Pirate", active: false })));
    assert.deepEqual(r.line, { centerId: id(w.a1), serviceId: coloring, productId: dye, productName: "Colorant", unit: "G", productActive: true, quantityPerService: 40 });
    const stored = (await ServiceRecipe.findOne({ serviceId: coloring }).lean())!;
    assert.equal(String(stored.organizationId), id(w.orgA));
    assert.ok(!("unit" in stored) && !("productName" in stored));
  });

  it("plusieurs produits par service, un même produit dans plusieurs services", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectOk(await addRecipeLine(w.ownerA(), line({ productId: shampoo, quantityPerService: 15 })));
    expectOk(await addRecipeLine(w.ownerA(), line({ serviceId: haircut, productId: shampoo, quantityPerService: 5 })));
    assert.equal((await lines(coloring)).length, 2);
    assert.equal((await lines(haircut)).length, 1);
  });

  it("refuse un doublon (service, produit) y compris sous concurrence : une seule ligne", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectFail(await addRecipeLine(w.ownerA(), line({ quantityPerService: 99 })), MSG_RECIPE_DUPLICATE);
    const results = await Promise.all(Array.from({ length: 5 }, () => addRecipeLine(w.ownerA(), line({ productId: shampoo }))));
    assert.equal(results.filter((r) => r.ok).length, 1);
    for (const r of results.filter((r) => !r.ok)) assert.equal((r as { message?: string }).message, MSG_RECIPE_DUPLICATE);
    assert.deepEqual((await lines()).map(([p, q]) => [p, q]).sort(), [[dye, 40], [shampoo, 40]].sort());
  });

  it("refuse quantités invalides et identifiants mal formés, sans rien créer", async () => {
    const bad: Record<string, unknown>[] = [
      { quantityPerService: 0 },
      { quantityPerService: -5 },
      { quantityPerService: 2.5 },
      { quantityPerService: "10" },
      { quantityPerService: null },
      { quantityPerService: 2_000_000_000 },
      { quantityPerService: undefined },
      { serviceId: "pas-un-id" },
      { serviceId: { $ne: "" } },
      { serviceId: undefined },
      { centerId: undefined },
      { centerId: "x" },
      { centerId: { $ne: "" } },
      { productId: "x" },
      { productId: ["a"] },
      { productId: undefined },
    ];
    for (const extra of bad) expectFail(await addRecipeLine(w.ownerA(), line(extra)));
    expectFail(await addRecipeLine(w.ownerA(), null));
    expectFail(await addRecipeLine(w.ownerA(), "texte"));
    assert.equal(await ServiceRecipe.countDocuments(), 0);
  });

  it("10. service inexistant ou d'une autre organisation : « Service introuvable. » ; produit étranger ou inexistant : « Produit introuvable. »", async () => {
    for (const serviceId of [foreignService, newId()]) expectFail(await addRecipeLine(w.ownerA(), line({ serviceId })), MSG_SERVICE_NOT_FOUND);
    for (const productId of [foreignProduct, newId()]) expectFail(await addRecipeLine(w.ownerA(), line({ productId })), MSG_PRODUCT_NOT_FOUND);
    expectFail(await addRecipeLine(w.ownerB(), line()), MSG_STOCK_CENTER_NOT_FOUND); // le propriétaire B ne voit ni le centre ni le service de A
    expectFail(await addRecipeLine(w.ownerB(), line({ centerId: id(w.b1) })), MSG_SERVICE_NOT_FOUND);
    assert.equal(await ServiceRecipe.countDocuments(), 0);
  });

  it("refuse un produit archivé dans une nouvelle recette", async () => {
    expectOk(await archiveProduct(w.ownerA(), { productId: dye }));
    expectFail(await addRecipeLine(w.ownerA(), line()), MSG_PRODUCT_ARCHIVED);
    assert.equal(await ServiceRecipe.countDocuments(), 0);
  });
});

describe("modification d'une ligne", () => {
  it("change la quantité ; `changed` est faux (et rien n'est écrit) quand elle est déjà celle demandée", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    const stamp = async () => (await ServiceRecipe.findOne({ serviceId: coloring }).lean())!.updatedAt?.getTime();
    const before = await stamp();
    const same = expectOk(await updateRecipeLine(w.ownerA(), line({ quantityPerService: 40 })));
    assert.deepEqual([same.changed, same.previousQuantity], [false, 40]);
    assert.equal(await stamp(), before);
    const changed = expectOk(await updateRecipeLine(w.ownerA(), line({ quantityPerService: 55 })));
    assert.deepEqual([changed.changed, changed.previousQuantity, changed.line.quantityPerService, changed.line.unit], [true, 40, 55, "G"]);
    assert.deepEqual(await lines(), [[dye, 55]]);
  });

  it("refuse une ligne inexistante, d'un autre service ou d'une autre organisation, et les quantités invalides", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectFail(await updateRecipeLine(w.ownerA(), line({ productId: shampoo })), MSG_RECIPE_LINE_NOT_FOUND);
    expectFail(await updateRecipeLine(w.ownerA(), line({ serviceId: haircut })), MSG_RECIPE_LINE_NOT_FOUND);
    expectFail(await updateRecipeLine(w.ownerA(), line({ serviceId: newId() })), MSG_RECIPE_LINE_NOT_FOUND);
    expectFail(await updateRecipeLine(w.ownerB(), line()), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await updateRecipeLine(w.ownerB(), line({ centerId: id(w.b1) })), MSG_RECIPE_LINE_NOT_FOUND);
    for (const quantityPerService of [0, -1, 1.5, "5"]) expectFail(await updateRecipeLine(w.ownerA(), line({ quantityPerService })));
    assert.deepEqual(await lines(), [[dye, 40]]);
  });

  it("une ligne dont le produit a été archivé reste modifiable (seul l'ajout est interdit)", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectOk(await archiveProduct(w.ownerA(), { productId: dye }));
    const r = expectOk(await updateRecipeLine(w.ownerA(), line({ quantityPerService: 10 })));
    assert.deepEqual([r.changed, r.line.productActive], [true, false]);
  });
});

describe("suppression d'une ligne", () => {
  it("supprime la ligne demandée seulement ; une ligne inexistante est refusée sans effet", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectOk(await addRecipeLine(w.ownerA(), line({ productId: shampoo, quantityPerService: 15 })));
    expectOk(await addRecipeLine(w.ownerA(), line({ serviceId: haircut })));
    const removed = expectOk(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: dye }));
    assert.deepEqual([removed.serviceId, removed.productId, removed.removedQuantity], [coloring, dye, 40]);
    expectFail(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: dye }), MSG_RECIPE_LINE_NOT_FOUND);
    assert.deepEqual(await lines(coloring), [[shampoo, 15]]);
    assert.deepEqual(await lines(haircut), [[dye, 40]]);
  });

  it("10. une ligne d'une autre organisation ne peut pas être supprimée ; identifiants mal formés refusés", async () => {
    await ServiceRecipe.create({ organizationId: w.orgB._id, centerId: w.b1._id, serviceId: foreignService, productId: foreignProduct, quantityPerService: 7 });
    expectFail(await removeRecipeLine(w.ownerA(), { centerId: id(w.b1), serviceId: foreignService, productId: foreignProduct }), MSG_STOCK_CENTER_NOT_FOUND);
    expectFail(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: foreignService, productId: foreignProduct }), MSG_RECIPE_LINE_NOT_FOUND);
    expectFail(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: "x", productId: dye }));
    expectFail(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: { $ne: "" } }));
    expectFail(await removeRecipeLine(w.ownerA(), null));
    assert.equal(await ServiceRecipe.countDocuments({ organizationId: w.orgB._id }), 1);
  });

  it("une ligne dont le produit est archivé, ou orpheline d'un service supprimé du catalogue, reste supprimable", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectOk(await archiveProduct(w.ownerA(), { productId: dye }));
    expectOk(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: dye }));
    expectOk(await addRecipeLine(w.ownerA(), line({ serviceId: haircut, productId: shampoo })));
    await Service.deleteOne({ _id: haircut }); // le catalogue (Module 2) supprime le service : la recette devient orpheline
    expectOk(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: haircut, productId: shampoo }));
    assert.equal(await ServiceRecipe.countDocuments(), 0);
  });
});

describe("lecture", () => {
  it("renvoie les lignes avec nom et unité du produit, triées par nom, produits archivés signalés", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    expectOk(await addRecipeLine(w.ownerA(), line({ productId: shampoo, quantityPerService: 15 })));
    expectOk(await archiveProduct(w.ownerA(), { productId: dye }));
    const r = expectOk(await listServiceRecipe(w.ownerA(), { centerId: id(w.a1), serviceId: coloring }));
    assert.equal(r.serviceName, "Coloration");
    assert.deepEqual(r.lines.map((l) => [l.productName, l.unit, l.quantityPerService, l.productActive]), [["Colorant", "G", 40, false], ["Shampoing", "ML", 15, true]]);
  });

  it("une recette vide est un succès vide ; service inexistant, étranger ou mal formé : refusé", async () => {
    assert.deepEqual(expectOk(await listServiceRecipe(w.ownerA(), { centerId: id(w.a1), serviceId: haircut })).lines, []);
    expectFail(await listServiceRecipe(w.ownerA(), { centerId: id(w.a1), serviceId: foreignService }), MSG_SERVICE_NOT_FOUND);
    expectFail(await listServiceRecipe(w.ownerA(), { centerId: id(w.a1), serviceId: newId() }), MSG_SERVICE_NOT_FOUND);
    expectFail(await listServiceRecipe(w.ownerA(), { centerId: id(w.a1), serviceId: "x" }));
    expectFail(await listServiceRecipe(w.ownerB(), { centerId: id(w.b1), serviceId: coloring }), MSG_SERVICE_NOT_FOUND);
  });

  it("n'affiche jamais les recettes d'une autre organisation ni d'identifiant d'organisation", async () => {
    expectOk(await addRecipeLine(w.ownerA(), line()));
    await ServiceRecipe.create({ organizationId: w.orgB._id, centerId: w.b1._id, serviceId: foreignService, productId: foreignProduct, quantityPerService: 7 });
    const mine = expectOk(await listServiceRecipe(w.ownerA(), { centerId: id(w.a1), serviceId: coloring }));
    assert.equal(mine.lines.length, 1);
    assert.ok(!JSON.stringify(mine).includes(id(w.orgA)));
    assert.equal(expectOk(await listServiceRecipe(w.ownerB(), { centerId: id(w.b1), serviceId: foreignService })).lines.length, 1);
  });
});

describe("les recettes ne touchent ni l'historique ni les rendez-vous", () => {
  it("ajout, modification et suppression ne créent, ne modifient ni ne suppriment aucun mouvement ; aucune consommation", async () => {
    expectOk(await activateProductInCenter(w.ownerA(), { productId: shampoo, centerId: id(w.a1), initialQuantity: 100 }));
    expectOk(await recordStockMovement(w.ownerA(), { productId: shampoo, centerId: id(w.a1), kind: "OUT", quantity: 10 }));
    const snapshot = async () => JSON.stringify(await StockMovement.find().sort({ seq: 1 }).lean());
    const before = await snapshot();
    expectOk(await addRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: shampoo, quantityPerService: 20 }));
    expectOk(await updateRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: shampoo, quantityPerService: 30 }));
    expectOk(await removeRecipeLine(w.ownerA(), { centerId: id(w.a1), serviceId: coloring, productId: shampoo }));
    assert.equal(await snapshot(), before);
    assert.equal(await StockMovement.countDocuments({ kind: "CONSUMPTION" }), 0);
  });

  it("le code des recettes ne lit aucun rendez-vous et ne crée aucun mouvement (contrôle du code source)", () => {
    const source = readFileSync(join(process.cwd(), "lib/stock/recipes.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /models\/booking|models\/finance|StockMovement|StockLevel|commitMovement|commitReceipt|openLevel|"CONSUMPTION"/);
    assert.doesNotMatch(source, /Service\.(updateOne|updateMany|findOneAndUpdate|create|insertMany|deleteOne|deleteMany|findOneAndDelete|replaceOne|bulkWrite|save)/);
  });
});
