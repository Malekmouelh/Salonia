// Base MongoDB locale sans installation (développement hors ligne).
// Données conservées dans ~/.salonia-mongo (hors du projet : Tailwind et Turbopack ne doivent pas les lire).
// Usage : npm run db:local  puis, dans .env : MONGODB_URI="mongodb://127.0.0.1:27017"
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";

async function main() {
  const dbPath = join(homedir(), ".salonia-mongo");
  mkdirSync(dbPath, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: { port: 27017, dbPath, storageEngine: "wiredTiger" },
  });

  console.log("✔ MongoDB local prêt (Ctrl+C pour arrêter)");
  console.log(`  MONGODB_URI="${server.getUri().replace(/\/$/, "")}"`);

  const stop = async () => {
    await server.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
