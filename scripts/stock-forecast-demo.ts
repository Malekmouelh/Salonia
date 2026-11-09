// Démonstration de l'IA du Module 5 : une copie jetable de l'application, une base MongoDB EN MÉMOIRE, des données fictives, 8 semaines de
// consommation inventée pour que la prévision, les dates de rupture et les commandes suggérées soient visibles, et 12 semaines de rendez-vous
// fictifs sur trois centres au comportement différent pour l'onglet « Analyses IA » (comparaison entre centres, anomalies, transferts).
// Les dates sont calculées à partir du lancement : la démonstration est complète le jour où on la lance.
//
// Lancer (depuis la racine du projet, sous Windows) :   npx tsx scripts/stock-forecast-demo.ts [--port 3100]
// Arrêter : Ctrl+C dans ce terminal (arrête le serveur de la copie, la base en mémoire et supprime la copie).
//
// Pour voir l'explication par Gemini, fournir la clé AU LANCEMENT (elle n'est écrite nulle part) :
//   $env:GEMINI_API_KEY = "…" ; npx tsx scripts/stock-forecast-demo.ts
// Sans clé, l'explication est une phrase de secours calculée sans IA.
//
// Garanties : base MongoDB en mémoire sur 127.0.0.1 (aucune connexion à une base réelle, contrôlée avant toute écriture) ; fichiers .env* ni lus ni
// copiés ; le serveur du port 3000 et le dossier .next du projet ne sont jamais utilisés ; comptes fictifs (mot de passe Demo1234) valables uniquement ici.
// Les consommations de la démo sont écrites directement dans le journal avec des rendez-vous fictifs (aucun rendez-vous réel n'existe dans cette base).
//
// Comptes : OWNER owner@salonia.tn (tous les centres) · MANAGER manager@salonia.tn (Sousse seulement) · STAFF, CLIENT, SUPER_ADMIN sans droit sur le stock.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import bcrypt from "bcryptjs";
import { MongoMemoryServer } from "mongodb-memory-server";

const DEMO_PASSWORD = "Demo1234";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const log = (message: string) => console.log(`[bac à sable] ${message}`);

const argPort = process.argv.indexOf("--port");
const PORT = argPort >= 0 ? Number(process.argv[argPort + 1]) : 3100;
if (!Number.isInteger(PORT) || PORT < 1024 || PORT === 3000) {
  console.error("Port invalide : choisissez un port libre différent de 3000 (par défaut 3100).");
  process.exit(1);
}

let mongo: MongoMemoryServer | null = null;
let child: ChildProcess | null = null;
let copyDir: string | null = null;
let closing = false;

// Arrêt propre : uniquement NOTRE processus enfant (son propre groupe), NOTRE base en mémoire et NOTRE dossier temporaire.
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  log("arrêt…");
  if (child?.pid && child.exitCode === null) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); // uniquement notre enfant et ses descendants
  }
  try {
    await mongo?.stop();
  } catch {
    /* ignoré */
  }
  // Suppression de la copie : seulement un dossier créé par ce script dans le dossier temporaire du système.
  if (copyDir && resolve(copyDir).startsWith(resolve(tmpdir()) + sep) && copyDir.includes("salonia-stock-sandbox-")) {
    rmSync(copyDir, { recursive: true, force: true });
  }
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

function isPortFree(port: number) {
  return new Promise<boolean>((resolvePort) => {
    const probe = createServer().once("error", () => resolvePort(false)).once("listening", () => probe.close(() => resolvePort(true)));
    probe.listen(port, "127.0.0.1");
  });
}

// ── 1. Copie jetable du projet (sans .env*, .git, .next, node_modules) puis clone de node_modules (copie à l'écriture sur APFS) ──
function makeCopy(): string {
  const source = process.cwd();
  const target = mkdtempSync(join(tmpdir(), "salonia-stock-sandbox-"));
  copyDir = target;
  const quiet = ["/NFL", "/NDL", "/NJH", "/NJS", "/NP"];
  const copy = spawnSync("robocopy", [source, target, "/E", "/XD", ".git", "node_modules", ".next", ".claude", ".vercel", "/XF", ".env*", "*.log", "*.pem", "*.tsbuildinfo", ...quiet], { stdio: "inherit" });
  if (copy.status === null || copy.status >= 8) throw new Error("Copie du projet impossible (robocopy).");
  const modules = spawnSync("robocopy", [join(source, "node_modules"), join(target, "node_modules"), "/E", "/MT:16", ...quiet], { stdio: "inherit" });
  if (modules.status === null || modules.status >= 8) throw new Error("Copie de node_modules impossible.");
  const secrets = readdirSync(target).filter((f) => f.startsWith(".env"));
  if (secrets.length > 0) throw new Error(`Fichier d'environnement présent dans la copie (${secrets.join(", ")}) : arrêt.`);
  return target;
}

// ── 2. Données fictives : uniquement dans la base en mémoire, via les vrais services du Module 5 ──
async function seed(uri: string, dbName: string) {
  // L'environnement est imposé AVANT le premier import de l'application (lib/db.ts lit process.env à la première connexion).
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;
  const { default: mongoose } = await import("mongoose");
  const { connectDB } = await import("@/lib/db");
  await connectDB();
  const port = new URL(uri).port;
  const conn = mongoose.connection;
  if (!LOCAL_HOSTS.has(conn.host) || String(conn.port) !== port || conn.name !== dbName) {
    throw new Error(`Connexion inattendue (${conn.host}:${conn.port}/${conn.name}) : arrêt avant toute écriture.`);
  }
  log(`base en mémoire vérifiée : ${conn.host}:${conn.port}/${conn.name}`);

  const { Center, Organization, User } = await import("@/lib/models/core");
  const { Service } = await import("@/lib/models/catalog");
  const stockModels = await import("@/lib/models/stock");
  await Promise.all([Organization, Center, User, Service, ...Object.values(stockModels)].map((m) => (m as { syncIndexes(): Promise<unknown> }).syncIndexes()));

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const HOURS = { lundi: "09:00-19:00", mardi: "09:00-19:00", mercredi: "09:00-19:00", jeudi: "09:00-19:00", vendredi: "09:00-19:00", samedi: "09:00-19:00", dimanche: null };
  const org = await Organization.create({ name: "Salon Yasmine (bac à sable)", slug: "salon-yasmine" });
  const [tunis, sousse, djerba] = await Center.create([
    { organizationId: org._id, name: "Yasmine Tunis — Lac 2", governorate: "TUNIS", openingHours: HOURS, phone: "71 123 456" },
    { organizationId: org._id, name: "Yasmine Sousse — Corniche", governorate: "SOUSSE", openingHours: HOURS, phone: "73 123 456" },
    { organizationId: org._id, name: "Yasmine Djerba — Houmt Souk", governorate: "MEDENINE", openingHours: HOURS, phone: "75 123 456" },
  ]);
  const centers = [tunis, sousse, djerba];
  const base = { organizationId: org._id, passwordHash: hash };
  const [ownerDoc, managerDoc] = await User.create([
    { ...base, firstName: "Yasmine", lastName: "Ben Ali", email: "owner@salonia.tn", phone: "98123456", role: "OWNER" as const, centerIds: centers.map((c) => c._id) },
    { ...base, firstName: "Karim", lastName: "Trabelsi", email: "manager@salonia.tn", role: "MANAGER" as const, centerIds: [sousse._id] },
    { ...base, firstName: "Amira", lastName: "Gharbi", email: "staff@salonia.tn", phone: "22345678", role: "STAFF" as const, centerIds: [tunis._id] },
    { organizationId: null, passwordHash: hash, firstName: "Sarra", lastName: "Mansouri", email: "client@salonia.tn", phone: "55123456", role: "CLIENT" as const },
    { organizationId: null, passwordHash: hash, firstName: "Admin", lastName: "Plateforme", email: "admin@salonia.tn", role: "SUPER_ADMIN" as const },
  ]);
  const orgView = { id: String(org._id), name: org.name, slug: org.slug, centers: centers.map((c) => ({ id: String(c._id), name: c.name, governorate: c.governorate })) };
  const actor = (doc: typeof ownerDoc, role: "OWNER" | "MANAGER") => ({ id: String(doc._id), role, centerIds: (doc.centerIds ?? []).map(String), organization: orgView });
  const owner = actor(ownerDoc, "OWNER");
  const manager = actor(managerDoc, "MANAGER");
  const id = (doc: { _id: unknown }) => String(doc._id);

  const catalog = await Service.create(
    [
      { name: "Coupe femme", category: "Coiffure", durationMinutes: 45, priceTnd: 35 },
      { name: "Coloration complète", category: "Coloration", durationMinutes: 120, priceTnd: 90 },
      { name: "Soin kératine", category: "Soins", durationMinutes: 90, priceTnd: 120 },
      { name: "Brushing", category: "Coiffure", durationMinutes: 30, priceTnd: 25 },
      { name: "Manucure", category: "Ongles", durationMinutes: 40, priceTnd: 30 },
    ].map((s) => ({ ...s, organizationId: org._id })),
  );
  const [cut, color, keratin] = catalog;

  const must = <T extends { ok: boolean; message?: string }>(label: string, result: T): Extract<T, { ok: true }> => {
    if (!result.ok) throw new Error(`Données de démonstration : ${label} a échoué (${result.message ?? "erreur"}).`);
    return result as Extract<T, { ok: true }>;
  };

  const { createProduct, archiveProduct, activateProductInCenter, recordStockMovement } = await import("@/lib/stock/service");
  const { commitMovement } = await import("@/lib/stock/ledger");
  const { createEquipment, recordMaintenance, archiveEquipment } = await import("@/lib/stock/equipment");
  const { createSupplier, archiveSupplier } = await import("@/lib/stock/suppliers");
  const { createPurchaseOrder, placePurchaseOrder, cancelPurchaseOrder } = await import("@/lib/stock/purchase-orders");
  const { receivePurchaseOrder } = await import("@/lib/stock/receipts");
  const { addRecipeLine } = await import("@/lib/stock/recipes");
  const { addDays, dayKey } = await import("@/lib/booking/time");

  // Produits (définitions partagées, propriétaire)
  const product = async (name: string, unit: "PIECE" | "ML" | "G") => must(`produit ${name}`, await createProduct(owner, { name, unit })).product.id;
  const shampoo = await product("Shampoing professionnel", "ML");
  const mask = await product("Masque kératine", "G");
  const dye = await product("Coloration 6.0", "G");
  const developer = await product("Oxydant 20 vol", "ML");
  const gloves = await product("Gants jetables", "PIECE");
  const towels = await product("Serviettes jetables", "PIECE");
  const old = await product("Ancien shampoing", "ML");

  // Niveaux : au-dessus, AU et sous le seuil (alerte = quantité ≤ seuil)
  const level = async (who: typeof owner, productId: string, center: { _id: unknown }, alertThreshold: number, initialQuantity: number) =>
    must("activation", await activateProductInCenter(who, { productId, centerId: id(center), alertThreshold, initialQuantity }));
  await level(owner, shampoo, tunis, 1000, 5000);
  await level(owner, mask, tunis, 300, 800);
  await level(owner, dye, tunis, 600, 600); // exactement au seuil
  await level(owner, developer, tunis, 1500, 900); // sous le seuil
  await level(owner, gloves, tunis, 50, 200);
  await level(owner, towels, tunis, 100, 400);
  await level(owner, old, tunis, 0, 100);
  await level(manager, shampoo, sousse, 800, 3000); // activé par le gérant dans son centre
  await level(manager, mask, sousse, 200, 150); // sous le seuil
  await level(manager, gloves, sousse, 50, 40); // sous le seuil
  await level(manager, dye, sousse, 400, 1200);
  await level(owner, shampoo, djerba, 500, 2500);
  await level(owner, gloves, djerba, 50, 120);

  // Historique de mouvements
  const move = async (who: typeof owner, productId: string, center: { _id: unknown }, kind: "IN" | "OUT" | "ADJUSTMENT", quantity: number, note?: string) =>
    must("mouvement", await recordStockMovement(who, { productId, centerId: id(center), kind, quantity, note }));
  await move(owner, shampoo, tunis, "OUT", 450, "Atelier du samedi");
  await move(owner, shampoo, tunis, "IN", 1000, "Livraison dépôt");
  await move(owner, shampoo, tunis, "OUT", 300);
  await move(owner, mask, tunis, "OUT", 120);
  await move(owner, mask, tunis, "ADJUSTMENT", -30, "Casse d'un pot");
  await move(owner, gloves, tunis, "OUT", 35);
  await move(manager, shampoo, sousse, "OUT", 200);
  await move(manager, mask, sousse, "OUT", 20);
  await move(owner, gloves, djerba, "OUT", 10);
  await move(owner, old, tunis, "OUT", 100, "Fin de série");
  must("archivage produit", await archiveProduct(owner, { productId: old })); // produit archivé : historique conservé
  // Projection volontairement en retard (mouvement validé, niveau non projeté) : la page l'affiche d'après le journal et le réaligne après la réponse.
  await commitMovement({ organizationId: id(org), productId: gloves, centerId: id(tunis), kind: "OUT", delta: -5, note: "Projection en retard (démonstration)" });

  // Matériel et maintenance
  const equipment = async (center: { _id: unknown }, name: string, category: string, status: "IN_SERVICE" | "IN_MAINTENANCE" | "OUT_OF_SERVICE", acquiredAt?: string) =>
    must("équipement", await createEquipment(owner, { centerId: id(center), name, category, status, acquiredAt })).equipment.id;
  const days = (n: number) => dayKey(addDays(new Date(), n));
  const casque = await equipment(tunis, "Casque chauffant n°1", "Casque", "IN_SERVICE", days(-700));
  const dryer = await equipment(tunis, "Sèche-cheveux professionnel", "Séchoir", "IN_SERVICE", days(-300));
  const chair = await equipment(tunis, "Fauteuil de coiffure", "Fauteuil", "IN_SERVICE", days(-900));
  const basin = await equipment(tunis, "Bac à shampoing", "Bac", "IN_MAINTENANCE", days(-500));
  const straightener = await equipment(tunis, "Lisseur vapeur", "Appareil", "OUT_OF_SERVICE", days(-1200));
  const dryerSousse = await equipment(sousse, "Sèche-cheveux", "Séchoir", "IN_SERVICE", days(-200));
  await equipment(sousse, "Table de manucure", "Mobilier", "IN_SERVICE", days(-400));
  const casqueDjerba = await equipment(djerba, "Casque chauffant", "Casque", "IN_SERVICE", days(-800));
  const former = await equipment(djerba, "Ancien séchoir", "Séchoir", "OUT_OF_SERVICE", days(-1500));
  const maintenance = async (equipmentId: string, performedAgo: number, nextInDays: number | null, note: string) =>
    must("intervention", await recordMaintenance(owner, { equipmentId, performedAt: days(-performedAgo), nextDueAt: nextInDays === null ? undefined : days(nextInDays), note }));
  await maintenance(casque, 220, -10, "Remplacement de la résistance"); // en retard
  await maintenance(casque, 400, 100, "Révision annuelle");
  await maintenance(casque, 220, -10, "Remplacement de la résistance");
  await maintenance(dryer, 60, 15, "Nettoyage des filtres"); // bientôt
  await maintenance(basin, 5, 0, "Détartrage du bac"); // aujourd'hui
  await maintenance(dryerSousse, 30, 3, "Contrôle du moteur"); // dans 3 jours
  await maintenance(casqueDjerba, 300, -25, "Révision annuelle"); // en retard
  await maintenance(chair, 90, 270, "Graissage des vérins"); // lointain
  await maintenance(straightener, 400, null, "Panne irréparable");
  must("archivage matériel", await archiveEquipment(owner, { equipmentId: former }));

  // Fournisseurs fictifs (coordonnées tunisiennes fictives)
  const supplier = async (name: string, phone: string, email: string, leadTimeDays: number, category?: string) => must("fournisseur", await createSupplier(owner, { name, phone, email, leadTimeDays, category })).supplier.id;
  const loreal = await supplier("Beauté Pro Tunisie", "71 861 234", "commandes@beaute-pro.example.tn", 5, "COSMETICS");
  const sfax = await supplier("Grossiste Coiffure Sfax", "74 223 456", "contact@grossiste-sfax.example.tn", 3, "PRODUCTS");
  await supplier("Distri Soins Sousse", "73 345 678", "ventes@distri-soins.example.tn", 2, "CONSUMABLES");
  const closed = await supplier("Ancien fournisseur", "71 000 111", "ancien@fournisseur.example.tn", 10);
  must("archivage fournisseur", await archiveSupplier(owner, { supplierId: closed }));

  // Commandes d'achat : une reçue (stock crédité une fois), une en brouillon, une passée à recevoir, une annulée
  const order = async (who: typeof owner, center: { _id: unknown }, supplierId: string, lines: { productId: string; quantity: number }[]) =>
    must("commande", await createPurchaseOrder(who, { centerId: id(center), supplierId, lines })).order.id;
  const received = await order(owner, tunis, loreal, [{ productId: shampoo, quantity: 2000 }, { productId: mask, quantity: 500 }]);
  must("passage", await placePurchaseOrder(owner, { orderId: received }));
  must("réception", await receivePurchaseOrder(owner, { orderId: received }));
  await order(manager, sousse, sfax, [{ productId: mask, quantity: 400 }, { productId: gloves, quantity: 100 }, { productId: dye, quantity: 300 }]); // brouillon
  const ordered = await order(owner, tunis, loreal, [{ productId: developer, quantity: 3000 }, { productId: dye, quantity: 1000 }]);
  must("passage", await placePurchaseOrder(owner, { orderId: ordered })); // à recevoir pendant la démonstration
  const cancelled = await order(owner, djerba, sfax, [{ productId: gloves, quantity: 200 }]);
  must("annulation", await cancelPurchaseOrder(owner, { orderId: cancelled }));

  // Recettes de consommation par service (configuration seule)
  // Même recette de départ dans chaque centre (une recette est propre à un centre : le propriétaire pourra l'ajuster ensuite par centre).
  const recipe = async (serviceId: string, productId: string, quantityPerService: number) => {
    for (const center of centers) must("recette", await addRecipeLine(owner, { centerId: id(center), serviceId, productId, quantityPerService }));
  };
  await recipe(id(cut), shampoo, 15);
  await recipe(id(cut), gloves, 1);
  await recipe(id(color), dye, 40);
  await recipe(id(color), developer, 60);
  await recipe(id(color), gloves, 2);
  await recipe(id(keratin), mask, 50);
  await recipe(id(keratin), shampoo, 20);

  // ── Prévision (IA) : 8 semaines de consommation fictive, écrites dans le journal avec des rendez-vous fictifs ──
  const { StockMovement } = stockModels;
  const { projectLevel } = await import("@/lib/stock/ledger");
  const { SIMULATION_NOTE } = await import("@/lib/stock/simulate-history");
  const DAY_MS = 86_400_000;
  // Profil de la semaine (lundi → dimanche) : le samedi consomme le plus, le dimanche le moins ; légère variation d'une semaine à l'autre.
  const WEEK_PROFILE = [0.6, 0.9, 1, 1, 1.1, 1.8, 0.4];
  const demand = (perDay: number, daysAgo: number) => {
    const day = new Date(Date.now() - daysAgo * DAY_MS);
    return Math.max(1, Math.round(perDay * WEEK_PROFILE[(day.getUTCDay() + 6) % 7] * (1 + 0.08 * Math.sin(daysAgo * 1.7))));
  };
  // Suivi d'un produit dans un centre : niveau activé, stock initial et consommations datées du passé, stock final exact.
  const track = async (productId: string, center: { _id: unknown }, o: { perDay: number; days: number; finalStock: number; threshold: number }) => {
    must("activation", await activateProductInCenter(owner, { productId, centerId: id(center), alertThreshold: o.threshold, initialQuantity: 0 }));
    const daily = Array.from({ length: o.days }, (_, i) => demand(o.perDay, o.days - i));
    const total = daily.reduce((a, b) => a + b, 0);
    const key = { organizationId: org._id, productId, centerId: center._id as never };
    let seq = 1;
    let balance = total + o.finalStock;
    await StockMovement.create({ ...key, kind: "OPENING", seq: seq++, delta: balance, balanceAfter: balance, note: "Stock initial", createdAt: new Date(Date.now() - (o.days + 4) * DAY_MS) });
    for (let i = 0; i < daily.length; i++) {
      balance -= daily[i];
      await StockMovement.create({
        ...key,
        kind: "CONSUMPTION",
        seq: seq++,
        delta: -daily[i],
        balanceAfter: balance,
        requested: daily[i],
        shortfall: 0,
        note: SIMULATION_NOTE, // la page d'analyse signale ainsi ces données comme simulées
        bookingId: new mongoose.Types.ObjectId(),
        createdAt: new Date(Date.now() - (o.days - i) * DAY_MS),
      });
    }
    await projectLevel({ organizationId: id(org), productId, centerId: id(center), seq: seq - 1, balanceAfter: balance });
  };
  const forecastProduct = async (name: string, unit: "PIECE" | "ML" | "G", supplierId?: string) => must(`produit ${name}`, await createProduct(owner, { name, unit, supplierId })).product.id;

  const shampooSalon = await forecastProduct("Shampoing salon", "ML", loreal); // rupture imminente, délai du fournisseur 5 jours : URGENT
  const keratinPro = await forecastProduct("Kératine pro", "ML", sfax); // à commander bientôt
  const nitrileGloves = await forecastProduct("Gants nitrile", "PIECE", sfax); // stock confortable
  const repairMask = await forecastProduct("Masque réparateur", "G"); // sans fournisseur habituel : pas de date limite de commande
  const dye71 = await forecastProduct("Teinture 7.1", "G", loreal); // produit récent : pas assez d'historique
  await track(shampooSalon, tunis, { perDay: 70, days: 56, finalStock: 300, threshold: 100 });
  await track(shampooSalon, sousse, { perDay: 35, days: 56, finalStock: 700, threshold: 100 });
  await track(keratinPro, tunis, { perDay: 30, days: 56, finalStock: 250, threshold: 50 });
  await track(nitrileGloves, tunis, { perDay: 20, days: 56, finalStock: 1200, threshold: 100 });
  await track(repairMask, tunis, { perDay: 40, days: 56, finalStock: 200, threshold: 50 });
  await track(dye71, tunis, { perDay: 25, days: 6, finalStock: 80, threshold: 100 });
  // Une commande déjà passée pour le shampoing de Tunis : elle est déduite de la quantité suggérée.
  const demoOrder = must("commande démo", await createPurchaseOrder(owner, { centerId: id(tunis), supplierId: loreal, lines: [{ productId: shampooSalon, quantity: 300 }] })).order.id;
  must("passage démo", await placePurchaseOrder(owner, { orderId: demoOrder }));

  // ── Analyses IA (onglet « Analyses IA ») : trois centres au comportement différent, 84 jours de rendez-vous fictifs partagés entre produits ──
  // Voir DEMO_SCENARIO (lib/stock/simulate-centers.ts) : dosage plus fort à Sousse, pic d'oxydant, stock dormant à Djerba et transfert possible vers
  // Tunis, sorties manuelles élevées, hausse, produit rarement utilisé. Tout est écrit avec la note de simulation, dans la base en mémoire seulement.
  const { DEMO_SCENARIO, planScenario, writeScenario } = await import("@/lib/stock/simulate-centers");
  const centerIds: Record<string, string> = { tunis: id(tunis), sousse: id(sousse), djerba: id(djerba) };
  const scenarioProducts: Record<string, string> = {};
  for (const p of DEMO_SCENARIO.products) {
    scenarioProducts[p.key] = await product(p.name, p.unit as "PIECE" | "ML" | "G");
    for (const centerId of Object.values(centerIds)) must("activation", await activateProductInCenter(owner, { productId: scenarioProducts[p.key], centerId, alertThreshold: p.threshold, initialQuantity: 0 }));
  }
  const written = await writeScenario(planScenario(DEMO_SCENARIO, 84), (center, productKey) => ({ organizationId: id(org), productId: scenarioProducts[productKey], centerId: centerIds[center] }));
  log(`analyses IA : ${written.movements} mouvements simulés sur ${written.pairs} couples produit/centre`);

  log("données fictives créées (rendez-vous terminés : non créés, la réconciliation n'existe pas dans le domaine)");
}

async function main() {
  if (!(await isPortFree(PORT))) {
    console.error(`Le port ${PORT} est déjà utilisé : choisissez-en un autre (--port). Aucun processus n'est arrêté par ce script.`);
    process.exit(1);
  }
  log("copie du projet vers un dossier temporaire (sans .env*, .git, .next)…");
  const dir = makeCopy();

  log("démarrage de la base MongoDB en mémoire…");
  mongo = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1" } });
  const uri = mongo.getUri();
  if (!LOCAL_HOSTS.has(new URL(uri).hostname)) throw new Error(`URI refusée (hôte non local) : ${new URL(uri).hostname}`);
  const dbName = `salonia_stock_sandbox_${randomBytes(4).toString("hex")}`;

  await seed(uri, dbName);

  log(`démarrage de Next.js sur le port ${PORT} (copie : ${dir})…`);
  const nextBin = join(dir, "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    // Environnement construit de zéro : aucune variable du processus parent (secrets, MONGODB_URI…) n'est transmise.
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
      APPDATA: process.env.APPDATA ?? "",
      LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
      TEMP: process.env.TEMP ?? tmpdir(),
      TMP: process.env.TMP ?? tmpdir(),
      HOME: process.env.USERPROFILE ?? "",
      TMPDIR: process.env.TEMP ?? tmpdir(),
      LANG: process.env.LANG ?? "en_US.UTF-8",
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      MONGODB_URI: uri,
      MONGODB_DB: dbName,
      AUTH_SECRET: randomBytes(32).toString("hex"),
      CRON_SECRET: randomBytes(16).toString("hex"),
      ANTHROPIC_API_KEY: "",
      // Seule variable transmise depuis le terminal de lancement : la clé Gemini de la démonstration (vide = phrase de secours).
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? "",
      DEMO_MODE: "true",
    },
  });
  child = server;
  server.on("exit", (code) => {
    if (!closing) {
      log(`le serveur Next.js s'est arrêté (code ${code}).`);
      void shutdown(code ?? 1);
    }
  });
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("Le serveur n'est pas prêt après 180 s.")), 180_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text.replace(/^/gm, "[next] "));
      if (/Ready in/.test(text.replace(/\u001b\[[0-9;]*m/g, ""))) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    server.stdout?.on("data", onData);
    server.stderr?.on("data", onData);
  });
  await ready;

  console.log(`
────────────────────────────────────────────────────────────
  Démonstration de la prévision de stock prête
  Adresse : http://127.0.0.1:${PORT}/login
            (127.0.0.1 et non localhost : les cookies de session restent séparés de ceux du serveur du port 3000)
  Base : MongoDB EN MÉMOIRE (${dbName}), supprimée à l'arrêt. Aucune base réelle n'est utilisée.
  Comptes (mot de passe : ${DEMO_PASSWORD}, valable uniquement ici) :
    OWNER        owner@salonia.tn     tous les centres
    MANAGER      manager@salonia.tn   Sousse seulement
    STAFF        staff@salonia.tn     sans droit sur le stock
    CLIENT       client@salonia.tn    sans droit sur le stock
    SUPER_ADMIN  admin@salonia.tn     sans droit sur le stock
  Arrêt : Ctrl+C
────────────────────────────────────────────────────────────`);
}

main().catch(async (error) => {
  console.error("Échec du bac à sable :", error instanceof Error ? error.message : error);
  await shutdown(1);
});
