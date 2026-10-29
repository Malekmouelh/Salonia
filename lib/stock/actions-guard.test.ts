// Module 5 (étape 4) — Garde-fous sur les Server Actions du stock. Test STRUCTUREL : il lit le code source de
// app/actions/stock.ts (les actions ne peuvent pas être appelées hors d'une requête Next.js : cookies, session).
// Il prouve la PRÉSENCE et l'ORDRE des gardes, de l'audit et de la gestion d'erreur ; il ne prouve PAS à lui seul
// l'isolation des données : celle-ci est démontrée par lib/stock/service.test.ts et lib/stock/ledger.test.ts (base en mémoire).
// Lancer : npm test
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AUTH_EVENT_TYPES } from "@/lib/enums";

const root = process.cwd();
const source = readFileSync(join(root, "app/actions/stock.ts"), "utf8");
const securityLog = readFileSync(join(root, "components/dashboard/security-log.tsx"), "utf8");

function functionBodies() {
  const bodies = new Map<string, string>();
  const starts = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{/g)].map((m) => ({ name: m[1], at: m.index! }));
  starts.forEach((s, i) => bodies.set(s.name, source.slice(s.at, starts[i + 1]?.at ?? source.length)));
  return bodies;
}
const bodies = functionBodies();

// Action → [rôles exigés, service appelé, événement d'audit (null = lecture ou réparation)]
const ACTIONS: Record<string, [string, string, string | null]> = {
  createStockProductAction: ['requireRole("OWNER")', "createProduct(", "STOCK_PRODUCT_CREATED"],
  updateStockProductAction: ['requireRole("OWNER")', "updateProduct(", "STOCK_PRODUCT_UPDATED"],
  archiveStockProductAction: ['requireRole("OWNER")', "archiveProduct(", "STOCK_PRODUCT_ARCHIVED"],
  listStockProductsAction: ['requireRole("OWNER", "MANAGER")', "listProducts(", null],
  activateStockProductAction: ['requireRole("OWNER", "MANAGER")', "activateProductInCenter(", "STOCK_LEVEL_UPDATED"],
  updateStockThresholdAction: ['requireRole("OWNER", "MANAGER")', "updateAlertThreshold(", "STOCK_LEVEL_UPDATED"],
  recordStockMovementAction: ['requireRole("OWNER", "MANAGER")', "recordStockMovement(", "STOCK_MOVEMENT_RECORDED"],
  listStockLevelsAction: ['requireRole("OWNER", "MANAGER")', "listStockLevels(", null],
  repairStockLevelsAction: ['requireRole("OWNER", "MANAGER")', "repairStockLevels(", null],
  receiveStockPurchaseOrderAction: ['requireRole("OWNER", "MANAGER")', "receivePurchaseOrder(", "STOCK_ORDER_RECEIVED"],
  createEquipmentAction: ['requireRole("OWNER", "MANAGER")', "createEquipment(", "EQUIPMENT_CREATED"],
  updateEquipmentAction: ['requireRole("OWNER", "MANAGER")', "updateEquipment(", "EQUIPMENT_UPDATED"],
  archiveEquipmentAction: ['requireRole("OWNER", "MANAGER")', "archiveEquipment(", "EQUIPMENT_ARCHIVED"],
  scheduleMaintenanceAction: ['requireRole("OWNER", "MANAGER")', "updateEquipment(", "MAINTENANCE_SCHEDULED"],
  recordMaintenanceAction: ['requireRole("OWNER", "MANAGER")', "recordMaintenance(", "MAINTENANCE_RECORDED"],
  listEquipmentAction: ['requireRole("OWNER", "MANAGER")', "listEquipment(", null],
  listMaintenanceScheduleAction: ['requireRole("OWNER", "MANAGER")', "listMaintenanceSchedule(", null],
  listMaintenanceHistoryAction: ['requireRole("OWNER", "MANAGER")', "listMaintenanceHistory(", null],
  createSupplierAction: ['requireRole("OWNER")', "createSupplier(", "SUPPLIER_CREATED"],
  updateSupplierAction: ['requireRole("OWNER")', "updateSupplier(", "SUPPLIER_UPDATED"],
  archiveSupplierAction: ['requireRole("OWNER")', "archiveSupplier(", "SUPPLIER_ARCHIVED"],
  listSuppliersAction: ['requireRole("OWNER", "MANAGER")', "listSuppliers(", null],
  createPurchaseOrderAction: ['requireRole("OWNER", "MANAGER")', "createPurchaseOrder(", "PURCHASE_ORDER_CREATED"],
  updateDraftPurchaseOrderAction: ['requireRole("OWNER", "MANAGER")', "updateDraftPurchaseOrder(", "PURCHASE_ORDER_UPDATED"],
  placePurchaseOrderAction: ['requireRole("OWNER", "MANAGER")', "placePurchaseOrder(", "PURCHASE_ORDER_PLACED"],
  cancelPurchaseOrderAction: ['requireRole("OWNER", "MANAGER")', "cancelPurchaseOrder(", "PURCHASE_ORDER_CANCELLED"],
  getPurchaseOrderAction: ['requireRole("OWNER", "MANAGER")', "getPurchaseOrder(", null],
  listPurchaseOrdersAction: ['requireRole("OWNER", "MANAGER")', "listPurchaseOrders(", null],
  addRecipeLineAction: ['requireRole("OWNER")', "addRecipeLine(", "STOCK_RECIPE_ADDED"],
  updateRecipeLineAction: ['requireRole("OWNER")', "updateRecipeLine(", "STOCK_RECIPE_UPDATED"],
  removeRecipeLineAction: ['requireRole("OWNER")', "removeRecipeLine(", "STOCK_RECIPE_REMOVED"],
  listServiceRecipeAction: ['requireRole("OWNER")', "listServiceRecipe(", null],
  listStockMovementsAction: ['requireRole("OWNER", "MANAGER")', "listStockMovements(", null],
  transferStockProductAction: ['requireRole("OWNER", "MANAGER")', "transferProduct(", "STOCK_TRANSFERRED"],
  transferEquipmentAction: ['requireRole("OWNER", "MANAGER")', "transferEquipment(", "EQUIPMENT_TRANSFERRED"],
  resumeStockTransferAction: ['requireRole("OWNER", "MANAGER")', "resumeTransfer(", "STOCK_TRANSFERRED"],
  listStockTransfersAction: ['requireRole("OWNER", "MANAGER")', "listTransfers(", null],
};

// Chemins à invalider PAR ACTION D'ÉCRITURE, pour les pages du Module 5 (certaines n'existent pas encore). Appliqués aux actions
// quand la page correspondante est créée : jusque-là, le test interdit d'invalider un chemin sans page. Le stock n'étant pas affiché
// sur la vitrine publique, aucun updateTag. Si un badge d'alertes est ajouté à l'accueil, "/dashboard" s'ajoutera aux actions qui
// changent un niveau ou un seuil.
const STOCK = "/dashboard/stock";
const RECIPES = "/dashboard/stock/recettes";
const ORDERS = "/dashboard/stock/commandes";
const EQUIPMENT = "/dashboard/stock/materiel";
const SUPPLIERS = "/dashboard/stock/fournisseurs";
const REVALIDATION: Record<string, string[]> = {
  createStockProductAction: [STOCK, RECIPES, ORDERS],
  updateStockProductAction: [STOCK, RECIPES, ORDERS],
  archiveStockProductAction: [STOCK, RECIPES, ORDERS],
  activateStockProductAction: [STOCK],
  updateStockThresholdAction: [STOCK],
  recordStockMovementAction: [STOCK],
  repairStockLevelsAction: [STOCK],
  receiveStockPurchaseOrderAction: [STOCK, ORDERS],
  createEquipmentAction: [EQUIPMENT],
  updateEquipmentAction: [EQUIPMENT],
  archiveEquipmentAction: [EQUIPMENT],
  scheduleMaintenanceAction: [EQUIPMENT],
  recordMaintenanceAction: [EQUIPMENT],
  createSupplierAction: [SUPPLIERS, ORDERS],
  updateSupplierAction: [SUPPLIERS, ORDERS],
  archiveSupplierAction: [SUPPLIERS, ORDERS],
  createPurchaseOrderAction: [ORDERS],
  updateDraftPurchaseOrderAction: [ORDERS],
  placePurchaseOrderAction: [ORDERS],
  cancelPurchaseOrderAction: [ORDERS],
  addRecipeLineAction: [RECIPES],
  updateRecipeLineAction: [RECIPES],
  removeRecipeLineAction: [RECIPES],
  // F5.6 : un transfert change les niveaux (vue d'ensemble), les produits proposables par centre (commandes) et le matériel par centre.
  transferStockProductAction: [STOCK, ORDERS, EQUIPMENT],
  transferEquipmentAction: [STOCK, ORDERS, EQUIPMENT],
  resumeStockTransferAction: [STOCK, ORDERS, EQUIPMENT],
};

// Écarts entre la table REVALIDATION et le code des actions, selon l'existence des pages.
function invalidationProblems(pageExists: (path: string) => boolean, actionBodies: Map<string, string>) {
  const problems: string[] = [];
  for (const [name, paths] of Object.entries(REVALIDATION)) {
    for (const path of paths) {
      const calls = actionBodies.get(name)!.includes(`revalidatePath("${path}")`);
      if (pageExists(path) && !calls) problems.push(`${name} : invalidation de ${path} manquante (la page existe)`);
      if (!pageExists(path) && calls) problems.push(`${name} : ${path} n'a pas de page, chemin fictif`);
    }
  }
  return problems;
}

describe("actions de stock : structure du code", () => {
  it("le fichier est une unité « use server » et n'exporte que les trente-sept actions prévues", () => {
    assert.ok(source.trimStart().startsWith('"use server";'));
    assert.deepEqual([...bodies.keys()].sort(), Object.keys(ACTIONS).sort());
    assert.deepEqual([...source.matchAll(/^export (?!async function|type )(\w+)/gm)].map((m) => m[1]), []); // pas d'export synchrone (interdit dans un fichier « use server »)
  });

  it("chaque action authentifie avec requireRole avant tout appel au service, avec les rôles prévus", () => {
    for (const [name, [role, service]] of Object.entries(ACTIONS)) {
      const body = bodies.get(name)!;
      const guard = body.indexOf(role);
      assert.ok(guard >= 0, `${name} : ${role} manquant`);
      assert.ok(body.indexOf("requireRole(") === guard, `${name} : un autre requireRole précède`);
      const call = body.indexOf(service);
      assert.ok(call > guard, `${name} : le service est appelé avant l'authentification`);
    }
  });

  it("les définitions de produits sont réservées au propriétaire dès l'action ; le gérant n'y accède pas", () => {
    for (const name of ["createStockProductAction", "updateStockProductAction", "archiveStockProductAction", "createSupplierAction", "updateSupplierAction", "archiveSupplierAction", "addRecipeLineAction", "updateRecipeLineAction", "removeRecipeLineAction", "listServiceRecipeAction"]) {
      assert.doesNotMatch(bodies.get(name)!, /"MANAGER"/, name);
    }
  });

  it("l'organisation absente est refusée avant le service, avec le message convenu", () => {
    for (const [name, body] of bodies) {
      const missing = body.indexOf("if (!user.organization) return { ok: false, message: MSG_NO_ORGANIZATION }");
      assert.ok(missing >= 0, `${name} : contrôle d'organisation manquant`);
      assert.ok(missing < body.search(/\b(createProduct|updateProduct|archiveProduct|listProducts|activateProductInCenter|updateAlertThreshold|recordStockMovement|listStockLevels|repairStockLevels|receivePurchaseOrder|createEquipment|updateEquipment|archiveEquipment|recordMaintenance|listEquipment|listMaintenanceSchedule|listMaintenanceHistory|createSupplier|updateSupplier|archiveSupplier|listSuppliers|createPurchaseOrder|updateDraftPurchaseOrder|placePurchaseOrder|cancelPurchaseOrder|getPurchaseOrder|listPurchaseOrders|addRecipeLine|updateRecipeLine|removeRecipeLine|listServiceRecipe|listStockMovements|transferProduct|transferEquipment|resumeTransfer|listTransfers)\(/), name);
    }
    assert.match(source, /const MSG_NO_ORGANIZATION = "Organisation introuvable\.";/);
  });

  it("les actions ne lisent jamais l'organisation, le rôle ou l'auteur dans le formulaire : elles passent l'utilisateur de la session au service", () => {
    for (const [name, body] of bodies) {
      assert.match(body, /\(user(,|\))/, `${name} : le service doit recevoir l'utilisateur de la session`);
      assert.doesNotMatch(body, /organizationId:\s*(raw|input|items|centerId)/, name);
      assert.doesNotMatch(body, /\braw\.(organizationId|role|createdBy)/, name);
    }
    assert.doesNotMatch(source, /@\/lib\/models\//); // aucun accès direct aux collections depuis une action
  });

  it("l'audit utilise l'événement prévu, uniquement après un succès du service, avec un détail construit sans saisie libre", () => {
    for (const [name, [, , event]] of Object.entries(ACTIONS)) {
      const body = bodies.get(name)!;
      if (!event) {
        assert.doesNotMatch(body, /logEvent|updateTag/, `${name} : une lecture ou une réparation n'écrit pas dans l'audit`);
        if (!(name in REVALIDATION)) assert.doesNotMatch(body, /revalidatePath/, `${name} : une lecture n'invalide rien`);
        continue;
      }
      assert.ok(body.includes(`logEvent("${event}"`), `${name} : événement ${event} manquant`);
      assert.ok(body.indexOf("if (!result.ok) return result;") < body.indexOf("logEvent("), `${name} : audit avant le contrôle du résultat`);
    }
    for (const call of source.matchAll(/logEvent\([\s\S]*?\}\);/g)) {
      // détail construit par un générateur de lib/stock/audit.ts (appel direct, ou variable issue de receiptAuditDetail)
      assert.match(call[0], /detail(: (productAuditDetail|levelAuditDetail|movementAuditDetail|equipmentAuditDetail|scheduleAuditDetail|maintenanceAuditDetail|supplierAuditDetail|orderAuditDetail|orderStatusAuditDetail|recipeAuditDetail|transferAuditDetail)\(|\s*\})/, call[0]);
      assert.doesNotMatch(call[0], /note|raw|input/, call[0]); // jamais la note de mouvement ni la saisie brute
    }
  });

  it("réception : l'audit vient de receiptAuditDetail ; une commande déjà reçue renvoie un succès AVANT logEvent ; aucune invalidation de page inventée", () => {
    const body = bodies.get("receiveStockPurchaseOrderAction")!;
    const detail = body.indexOf("const detail = receiptAuditDetail(result);");
    const early = body.indexOf("if (detail === null) return");
    assert.ok(detail >= 0 && early > detail && early < body.indexOf("logEvent("));
    assert.ok(body.indexOf("if (!result.ok) return result;") < detail);
    assert.match(body, /logEvent\("STOCK_ORDER_RECEIVED", \{ userId: user\.id, organizationId: user\.organization\.id, detail \}\)/);
    // L'invalidation (stock et commandes) n'a lieu qu'après l'audit, donc jamais pour une commande déjà reçue.
    assert.ok(body.indexOf("logEvent(") < body.indexOf('revalidatePath("/dashboard/stock")'));
    assert.ok(early > 0 && early < body.indexOf("revalidatePath("));
    assert.match(body, /revalidatePath\("\/dashboard\/stock\/commandes"\)/);
    assert.doesNotMatch(body, /updateTag/);
  });

  it("matériel : sans changement réel (modification, programmation, archivage rejoué), l'action répond avant logEvent", () => {
    for (const name of ["updateEquipmentAction", "scheduleMaintenanceAction", "archiveEquipmentAction", "updateSupplierAction", "archiveSupplierAction", "updateDraftPurchaseOrderAction", "updateRecipeLineAction"]) {
      const body = bodies.get(name)!;
      const early = body.indexOf("if (!result.changed) return");
      assert.ok(early >= 0, `${name} : retour anticipé manquant`);
      assert.ok(body.indexOf("if (!result.ok) return result;") < early && early < body.indexOf("logEvent("), name);
    }
  });

  it("fournisseurs et commandes : l'audit ne contient ni nom, ni coordonnées, ni nom de produit, ni saisie brute ; les lectures n'écrivent rien", () => {
    const names = ["createSupplierAction", "updateSupplierAction", "archiveSupplierAction", "createPurchaseOrderAction", "updateDraftPurchaseOrderAction", "placePurchaseOrderAction", "cancelPurchaseOrderAction"];
    for (const name of names) {
      const calls = [...bodies.get(name)!.matchAll(/logEvent\([\s\S]*?\}\);/g)];
      assert.equal(calls.length, 1, name);
      assert.doesNotMatch(calls[0][0], /name|phone|email|raw|productName|supplierName/i, name);
    }
    for (const name of ["listSuppliersAction", "getPurchaseOrderAction", "listPurchaseOrdersAction"]) assert.doesNotMatch(bodies.get(name)!, /logEvent|revalidatePath|updateTag/, name);
  });

  it("recettes : l'audit ne contient que des identifiants et des quantités, la lecture n'écrit rien, aucun mouvement ni rendez-vous n'est touché", () => {
    for (const name of ["addRecipeLineAction", "updateRecipeLineAction", "removeRecipeLineAction"]) {
      const calls = [...bodies.get(name)!.matchAll(/logEvent\([\s\S]*?\}\);/g)];
      assert.equal(calls.length, 1, name);
      assert.doesNotMatch(calls[0][0], /name|raw|unit/i, name);
    }
    assert.doesNotMatch(bodies.get("listServiceRecipeAction")!, /logEvent|revalidatePath|updateTag/);
    for (const name of ["addRecipeLineAction", "updateRecipeLineAction", "removeRecipeLineAction", "listServiceRecipeAction"]) {
      assert.doesNotMatch(bodies.get(name)!, /commitMovement|recordStockMovement|CONSUMPTION|Booking/, name);
    }
  });

  it("la réception n'a qu'un point d'entrée serveur : receiveStockPurchaseOrderAction ; aucune autre action ni service ne pose RECEIVED", () => {
    assert.equal([...source.matchAll(/receivePurchaseOrder\(/g)].length, 1);
    assert.ok(bodies.get("receiveStockPurchaseOrderAction")!.includes("receivePurchaseOrder("));
    assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ""), /"RECEIVED"/);
    const dir = join(root, "lib/stock");
    const writers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) => /status:\s*"RECEIVED"/.test(readFileSync(join(dir, f), "utf8").replace(/^\s*\/\/.*$/gm, "")));
    assert.deepEqual(writers, ["receipts.ts"]);
  });

  it("programmation de maintenance : seuls l'identifiant et la date sont transmis au service, jamais la saisie brute", () => {
    const body = bodies.get("scheduleMaintenanceAction")!;
    assert.match(body, /updateEquipment\(user, \{ equipmentId: rawField\(raw, "equipmentId"\), nextMaintenanceAt: rawField\(raw, "nextMaintenanceAt"\) \}\)/);
    assert.doesNotMatch(body, /updateEquipment\(user, raw\)/);
  });

  it("maintenance : l'audit n'utilise ni la note d'intervention ni le nom de l'équipement ; les lectures n'écrivent rien", () => {
    for (const name of ["recordMaintenanceAction", "createEquipmentAction", "updateEquipmentAction"]) {
      const calls = [...bodies.get(name)!.matchAll(/logEvent\([\s\S]*?\}\);/g)];
      assert.equal(calls.length, 1, name);
      assert.doesNotMatch(calls[0][0], /note|name|category|raw/i, name);
    }
    for (const name of ["listEquipmentAction", "listMaintenanceScheduleAction", "listMaintenanceHistoryAction"]) assert.doesNotMatch(bodies.get(name)!, /logEvent|revalidatePath|updateTag/, name);
  });

  it("une activation rejouée sans effet ne produit ni événement d'audit : le retour précède logEvent", () => {
    const body = bodies.get("activateStockProductAction")!;
    const early = body.indexOf("if (!result.levelCreated && result.initialStock !== \"RECORDED\")");
    assert.ok(early >= 0 && early < body.indexOf("logEvent("));
  });

  it("seuls les refus attendus sortent : toute autre erreur est journalisée côté serveur et remplacée par un message générique", () => {
    assert.match(source, /async function run<T>[\s\S]*?try \{[\s\S]*?\} catch \(error\) \{[\s\S]*?console\.error\([\s\S]*?return \{ ok: false, message: MSG_UNEXPECTED \};/);
    assert.match(source, /const MSG_UNEXPECTED = "Une erreur est survenue\. Réessayez\.";/);
    assert.doesNotMatch(source, /error\.message|String\(error\)|error\.stack|\.stack\b/);
    for (const [name, [, service]] of Object.entries(ACTIONS)) assert.match(bodies.get(name)!, new RegExp(`run\\(\\(\\) => ${service.replace("(", "\\(")}`), `${name} : l'appel au service doit passer par run()`);
  });

  it("requireRole est HORS du try/catch : un refus (redirection) n'est pas avalé", () => {
    const wrapper = source.slice(source.indexOf("async function run<T>"), source.indexOf("type WithMessage"));
    assert.doesNotMatch(wrapper, /requireRole/);
  });

  it("invalidation : chaque action d'écriture a ses chemins explicites (table REVALIDATION) ; un chemin est invalidé si et seulement si sa page existe", () => {
    const code = source.replace(/^\s*\/\/.*$/gm, ""); // sans les commentaires

    // 1. La table couvre exactement les actions qui écrivent (audit ou réparation) ; les lectures n'invalident rien.
    const writers = Object.entries(ACTIONS).filter(([, [, , event]]) => event !== null).map(([name]) => name);
    assert.deepEqual(Object.keys(REVALIDATION).sort(), [...writers, "repairStockLevelsAction"].sort());
    for (const [name, [, , event]] of Object.entries(ACTIONS)) {
      if (event === null && name !== "repairStockLevelsAction") assert.doesNotMatch(bodies.get(name)!, /revalidatePath|updateTag/, `${name} : une lecture n'invalide rien`);
    }

    // 2. Tout chemin invalidé dans le fichier appartient à la table (aucun chemin inventé), et aucun updateTag (le stock n'est pas public).
    const known = new Set(Object.values(REVALIDATION).flat());
    for (const m of code.matchAll(/revalidatePath\("([^"]+)"/g)) assert.ok(known.has(m[1]), `chemin hors table : ${m[1]}`);
    assert.doesNotMatch(code, /updateTag\(/);

    // 3. Page absente : l'action n'invalide pas son chemin. Page présente : elle doit l'invalider.
    assert.deepEqual(invalidationProblems((path) => existsSync(join(root, "app", path, "page.tsx")), bodies), []);
  });

  it("la règle d'invalidation est exercée avec de fausses pages : chemin exigé si la page existe, interdit sinon", () => {
    const total = Object.values(REVALIDATION).flat().length;
    // Toutes les pages existent : le code actuel est conforme.
    assert.deepEqual(invalidationProblems(() => true, bodies), []);
    // Aucune page n'existe : chaque couple (action, chemin) invalidé est un chemin fictif.
    assert.equal(invalidationProblems(() => false, bodies).length, total);
    // Une action qui oublie d'invalider un chemin dont la page existe est signalée, et elle seule.
    const patched = new Map(bodies);
    patched.set("recordStockMovementAction", bodies.get("recordStockMovementAction")!.replace('revalidatePath("/dashboard/stock");', ""));
    assert.deepEqual(invalidationProblems(() => true, patched), ["recordStockMovementAction : invalidation de /dashboard/stock manquante (la page existe)"]);
    // La même action sans page pour ce chemin n'est pas un problème.
    assert.deepEqual(invalidationProblems((path) => path !== STOCK, patched).filter((p) => p.startsWith("recordStockMovementAction")), []);
  });
});

describe("audit : types d'événements du Module 5", () => {
  it("chaque événement utilisé existe dans AUTH_EVENT_TYPES et dans le journal de sécurité", () => {
    const used = new Set([...source.matchAll(/logEvent\("(\w+)"/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), ["EQUIPMENT_ARCHIVED", "EQUIPMENT_CREATED", "EQUIPMENT_TRANSFERRED", "EQUIPMENT_UPDATED", "MAINTENANCE_RECORDED", "MAINTENANCE_SCHEDULED", "PURCHASE_ORDER_CANCELLED", "PURCHASE_ORDER_CREATED", "PURCHASE_ORDER_PLACED", "PURCHASE_ORDER_UPDATED", "STOCK_LEVEL_UPDATED", "STOCK_MOVEMENT_RECORDED", "STOCK_ORDER_RECEIVED", "STOCK_PRODUCT_ARCHIVED", "STOCK_PRODUCT_CREATED", "STOCK_PRODUCT_UPDATED", "STOCK_RECIPE_ADDED", "STOCK_RECIPE_REMOVED", "STOCK_RECIPE_UPDATED", "STOCK_TRANSFERRED", "SUPPLIER_ARCHIVED", "SUPPLIER_CREATED", "SUPPLIER_UPDATED"]);
    for (const event of used) {
      assert.ok((AUTH_EVENT_TYPES as readonly string[]).includes(event), `${event} absent de lib/enums.ts`);
      assert.match(securityLog, new RegExp(`${event}: \\{ label: "`), `${event} absent de security-log.tsx`);
    }
  });
});

describe("transferts entre centres (F5.6) : structure des actions", () => {
  const NAMES = ["transferStockProductAction", "transferEquipmentAction", "resumeStockTransferAction", "listStockTransfersAction"];
  const SERVICE_CALL = /\b(transferProduct|transferEquipment|resumeTransfer|listTransfers)\(/;

  it("les quatre actions authentifient avec requireRole(\"OWNER\", \"MANAGER\") AVANT tout appel : aucune n'est ouverte à un autre rôle", () => {
    for (const name of NAMES) {
      const body = bodies.get(name)!;
      assert.ok(body.indexOf('requireRole("OWNER", "MANAGER")') >= 0, name);
      assert.ok(body.indexOf("requireRole(") < body.search(SERVICE_CALL), name);
      assert.doesNotMatch(body, /requireRole\(\)/, name);
    }
  });

  it("les centres source et destination ne sont jamais lus par l'action : seul le service les valide (droits dans lib/stock/scope.ts)", () => {
    for (const name of NAMES) {
      const body = bodies.get(name)!;
      assert.doesNotMatch(body, /raw\.(fromCenterId|toCenterId|centerId)|rawField\(/, name);
      assert.match(body, /\(user, raw\)/, name);
    }
  });

  it("sans avancée réelle (transfert déjà terminé), l'action répond AVANT logEvent et n'invalide rien ; l'audit ne contient que des identifiants et la quantité", () => {
    for (const name of ["transferStockProductAction", "transferEquipmentAction", "resumeStockTransferAction"]) {
      const body = bodies.get(name)!;
      const early = body.indexOf("if (!result.advanced) return");
      assert.ok(early >= 0, name);
      assert.ok(body.indexOf("if (!result.ok) return result;") < early && early < body.indexOf("logEvent("), name);
      assert.ok(early < body.indexOf("revalidatePath("), name);
      assert.doesNotMatch(body, /productName|equipmentName|\.note|name:/, name);
    }
    assert.doesNotMatch(bodies.get("listStockTransfersAction")!, /logEvent|revalidatePath|updateTag/);
  });

  it("le service de transfert n'écrit jamais StockLevel.quantity directement : seuls le journal et projectLevel le font", () => {
    const code = readFileSync(join(root, "lib/stock/transfers.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /StockLevel\.(updateOne|findOneAndUpdate|updateMany|bulkWrite)/);
    assert.doesNotMatch(code, /\$inc|\$dec/);
    assert.match(code, /commitTransferOut\(/);
    assert.match(code, /commitTransferIn\(/);
    // Mise à jour conditionnelle du matériel sur le centre source attendu (protège de la course).
    assert.match(code, /Equipment\.updateOne\(\{ _id: equipmentId, organizationId: ref\.organizationId, centerId: ref\.fromCenterId, active: true \}/);
  });
});
