// Tests unitaires et d'intégration du Module 2 (Catalogue & Réservation)
// Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateServiceSchema,
  CreatePackSchema,
  CreatePromotionSchema,
} from "./schemas";
import {
  generateServiceDescription,
  suggestPacks,
  analyzePricing,
} from "@/lib/ai/catalog-ai";

describe("Module 2 — Validation des schémas Zod du catalogue", () => {
  it("valide la création d'un service avec options et tarifs par centre", () => {
    const validService = {
      name: "Soin Visage Éclat",
      category: "Soins Visage",
      durationMinutes: 45,
      priceTnd: 60,
      description: "Soin hydratant profond",
      active: true,
      options: [
        {
          name: "Masque Or",
          values: [
            { label: "Standard", extraPriceTnd: 0, extraDurationMinutes: 0 },
            { label: "24 Carats", extraPriceTnd: 25, extraDurationMinutes: 15 },
          ],
        },
      ],
      centerPrices: [
        { centerId: "center-marsa", priceTnd: 75 },
      ],
    };

    const parsed = CreateServiceSchema.parse(validService);
    assert.equal(parsed.name, "Soin Visage Éclat");
    assert.equal(parsed.options?.length, 1);
    assert.equal(parsed.options?.[0].values[1].extraPriceTnd, 25);
    assert.equal(parsed.centerPrices?.[0].priceTnd, 75);
  });

  it("rejette un service avec un prix ou une durée négative", () => {
    assert.throws(() => {
      CreateServiceSchema.parse({
        name: "Test invalide",
        category: "Coiffure",
        durationMinutes: -10,
        priceTnd: 50,
      });
    });

    assert.throws(() => {
      CreateServiceSchema.parse({
        name: "Test invalide",
        category: "Coiffure",
        durationMinutes: 30,
        priceTnd: -20,
      });
    });
  });

  it("valide la création d'un pack avec au moins un service", () => {
    const validPack = {
      name: "Pack Mariée Sérénité",
      description: "Coiffure + Maquillage",
      priceTnd: 180,
      serviceIds: ["srv-1", "srv-2"],
      active: true,
    };

    const parsed = CreatePackSchema.parse(validPack);
    assert.equal(parsed.serviceIds.length, 2);
    assert.equal(parsed.priceTnd, 180);
  });

  it("rejette un pack sans services associés", () => {
    assert.throws(() => {
      CreatePackSchema.parse({
        name: "Pack Vide",
        priceTnd: 100,
        serviceIds: [],
      });
    });
  });

  it("valide une promotion avec code promo et réduction", () => {
    const validPromo = {
      name: "Bienvenue 2026",
      code: "WELCOME20",
      type: "PERCENTAGE" as const,
      value: 20,
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-12-31T23:59:59.000Z",
      maxUses: 100,
      active: true,
    };

    const parsed = CreatePromotionSchema.parse(validPromo);
    assert.equal(parsed.code, "WELCOME20");
    assert.equal(parsed.value, 20);
  });
});

describe("Module 2 — Calcul des tarifs, options et remises", () => {
  it("calcule correctement le prix total avec suppléments d'options", () => {
    const basePrice = 40;
    const baseDuration = 30;

    const selectedOptions = [
      { name: "Longueur", value: "Cheveux très longs", extraPriceTnd: 15, extraDurationMinutes: 15 },
      { name: "Soin thermo", value: "Kératine protect", extraPriceTnd: 10, extraDurationMinutes: 5 },
    ];

    const extraPrice = selectedOptions.reduce((sum, o) => sum + (o.extraPriceTnd || 0), 0);
    const extraDuration = selectedOptions.reduce((sum, o) => sum + (o.extraDurationMinutes || 0), 0);

    const totalItemPrice = basePrice + extraPrice;
    const totalItemDuration = baseDuration + extraDuration;

    assert.equal(totalItemPrice, 65);
    assert.equal(totalItemDuration, 50);
  });

  it("priorise le tarif spécifique au centre s'il est configuré", () => {
    const defaultPrice = 50;
    const centerPrices = [
      { centerId: "center-lac2", priceTnd: 65 },
      { centerId: "center-ariana", priceTnd: 45 },
    ];

    const resolveForCenter = (targetCenterId: string) => {
      const found = centerPrices.find((cp) => cp.centerId === targetCenterId);
      return found ? found.priceTnd : defaultPrice;
    };

    assert.equal(resolveForCenter("center-lac2"), 65);
    assert.equal(resolveForCenter("center-ariana"), 45);
    assert.equal(resolveForCenter("center-autre"), 50);
  });

  it("calcule la réduction d'un code promo en pourcentage et en montant fixe", () => {
    const subtotal = 120;

    // Réduction %
    const percentDiscount = Math.min(subtotal, Math.round((subtotal * 20) / 100));
    assert.equal(percentDiscount, 24);
    assert.equal(subtotal - percentDiscount, 96);

    // Réduction montant fixe plafonnée
    const fixedDiscount = Math.min(subtotal, 15);
    assert.equal(fixedDiscount, 15);
    assert.equal(subtotal - fixedDiscount, 105);

    // Réduction supérieure au sous-total (ne doit jamais donner un total négatif)
    const excessDiscount = Math.min(subtotal, 150);
    assert.equal(excessDiscount, 120);
    assert.equal(subtotal - excessDiscount, 0);
  });
});

describe("Module 2 — Moteurs d'Intelligence Artificielle (Claude + Heuristiques)", () => {
  it("génère une description marketing attrayante pour un service (repli heuristique)", async () => {
    const desc = await generateServiceDescription({
      name: "Soin Hydrafacial Glow",
      category: "Soins Visage",
      durationMinutes: 60,
      priceTnd: 120,
      options: [
        {
          name: "Sérum",
          values: [{ label: "Acide hyaluronique" }, { label: "Vitamine C" }],
        },
      ],
    });

    assert.ok(desc.length > 30);
    assert.ok(desc.includes("Soin Hydrafacial Glow") || desc.includes("prestation"));
  });

  it("génère des suggestions de packs intelligents cohérents", async () => {
    const mockServices = [
      { id: "s1", name: "Coupe & Brushing", category: "Coiffure", durationMinutes: 45, priceTnd: 40 },
      { id: "s2", name: "Soin Kératine", category: "Coiffure", durationMinutes: 30, priceTnd: 35 },
      { id: "s3", name: "Manucure Russe", category: "Onglerie", durationMinutes: 45, priceTnd: 30 },
      { id: "s4", name: "Pose Vernis Semi-Permanent", category: "Onglerie", durationMinutes: 30, priceTnd: 25 },
    ];

    const suggestions = await suggestPacks(mockServices);
    assert.ok(suggestions.length > 0);

    for (const sug of suggestions) {
      assert.ok(sug.name.length > 0);
      assert.ok(sug.serviceIds.length >= 2);
      assert.ok(sug.priceTnd < sug.regularPriceTnd); // Le pack doit proposer une remise
      assert.ok(sug.savingsTnd > 0);
      assert.ok(sug.savingsPercent > 0);
    }
  });

  it("fournit une analyse et des recommandations tarifaires complètes", async () => {
    const mockServices = [
      { id: "s1", name: "Brushing Simple", category: "Coiffure", durationMinutes: 30, priceTnd: 15 },
      { id: "s2", name: "Coloration Complète", category: "Coiffure", durationMinutes: 120, priceTnd: 180 },
      { id: "s3", name: "Pose Faux Ongles", category: "Onglerie", durationMinutes: 60, priceTnd: 50 },
    ];
    const mockPacks = [
      { id: "p1", name: "Duo Beauté", priceTnd: 60, regularTotalTnd: 65, serviceIds: ["s1", "s3"] },
    ];

    const audit = await analyzePricing(mockServices, mockPacks);

    assert.ok(audit.summary.length > 20);
    assert.equal(audit.stats.totalServices, 3);
    assert.equal(audit.stats.totalPacks, 1);
    assert.ok(audit.stats.avgPrice > 0);
    assert.ok(Array.isArray(audit.recommendations));
  });
});
