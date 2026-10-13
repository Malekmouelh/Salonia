// Données de démonstration : une marque avec 3 centres (Tunis, Sousse, Djerba)
// et un compte par rôle. Mot de passe commun : Demo1234
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const passwordHash = await bcrypt.hash("Demo1234", 12);

  await prisma.organization.deleteMany({ where: { slug: "salon-yasmine" } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@salonia.tn" } } });

  const org = await prisma.organization.create({
    data: {
      name: "Salon Yasmine",
      slug: "salon-yasmine",
      centers: {
        create: [
          { name: "Yasmine Tunis — Lac 2", governorate: "TUNIS" },
          { name: "Yasmine Sousse — Corniche", governorate: "SOUSSE" },
          { name: "Yasmine Djerba — Houmt Souk", governorate: "MEDENINE" },
        ],
      },
    },
    include: { centers: true },
  });
  const center = (g: string) => org.centers.find((c) => c.governorate === g)!;
  const [tunis, sousse, djerba] = [center("TUNIS"), center("SOUSSE"), center("MEDENINE")];

  const users = [
    { firstName: "Admin", lastName: "Plateforme", email: "admin@salonia.tn", role: "SUPER_ADMIN", organizationId: null, centers: [] },
    { firstName: "Yasmine", lastName: "Ben Ali", email: "owner@salonia.tn", phone: "98123456", role: "OWNER", organizationId: org.id, centers: [tunis, sousse, djerba] },
    { firstName: "Karim", lastName: "Trabelsi", email: "manager@salonia.tn", role: "MANAGER", organizationId: org.id, centers: [sousse] },
    { firstName: "Amira", lastName: "Gharbi", email: "staff@salonia.tn", phone: "22345678", role: "STAFF", organizationId: org.id, centers: [tunis] },
    { firstName: "Sarra", lastName: "Mansouri", email: "client@salonia.tn", role: "CLIENT", organizationId: org.id, centers: [] },
  ] as const;

  for (const { centers, ...u } of users) {
    await prisma.user.create({
      data: {
        ...u,
        passwordHash,
        centers: { create: centers.map((c) => ({ centerId: c.id })) },
      },
    });
  }

  console.log("✔ Données de démo créées (mot de passe : Demo1234)");
  for (const u of users) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
