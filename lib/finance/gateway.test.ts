// ═══════════════════════════════════════════════════════════════════════════
// FICHIER : lib/finance/gateway.test.ts — TESTS DE LA PASSERELLE DE PAIEMENT (F6.2)
// ═══════════════════════════════════════════════════════════════════════════
// Vérifie le comportement de la passerelle de démonstration (lib/finance/gateway.ts) :
// validation des numéros de carte (algorithme de Luhn), acceptation de la carte de test,
// et refus dans les cas d'erreur. Même outil que finance.test.ts (node:test, sans bibliothèque externe).
// Les tests de fonctions asynchrones utilisent `async () => { await … }`.
// ═══════════════════════════════════════════════════════════════════════════

// Passerelle de paiement de démonstration (F6.2). Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGateway, luhn } from "./gateway";

describe("passerelle de paiement (sandbox)", () => {
  it("valide les numéros de carte avec l'algorithme de Luhn", () => {
    assert.equal(luhn("4242 4242 4242 4242"), true); // carte de test valide (les espaces sont ignorés)
    assert.equal(luhn("4242 4242 4242 4241"), false); // un seul chiffre modifié → invalide (faute de frappe détectée)
    assert.equal(luhn("1234"), false); // trop court pour un numéro de carte
  });

  it("accepte la carte de test et renvoie une référence", async () => {
    // Date d'expiration 12/39 (lointaine) pour que le test ne devienne jamais faux avec le temps.
    const r = await getGateway().authorize({ amountTnd: 30, cardNumber: "4242424242424242", expiry: "12/39", cvc: "123" });
    assert.equal(r.ok, true);
    // La référence de transaction a la forme « SBX- » + 10 caractères hexadécimaux en majuscules.
    assert.match(r.ok ? r.reference : "", /^SBX-[0-9A-F]{10}$/);
  });

  it("refuse une carte refusée, expirée ou un code invalide", async () => {
    const gw = getGateway();
    // Carte de test « refusée par la banque » (se termine par 0002) : message exact attendu.
    assert.deepEqual(await gw.authorize({ amountTnd: 30, cardNumber: "4000000000000002", expiry: "12/39", cvc: "123" }), { ok: false, error: "Paiement refusé par la banque." });
    // Carte expirée (janvier 2020).
    assert.equal((await gw.authorize({ amountTnd: 30, cardNumber: "4242424242424242", expiry: "01/20", cvc: "123" })).ok, false);
    // Code de sécurité trop court (1 chiffre au lieu de 3 ou 4).
    assert.equal((await gw.authorize({ amountTnd: 30, cardNumber: "4242424242424242", expiry: "12/39", cvc: "1" })).ok, false);
  });
});
