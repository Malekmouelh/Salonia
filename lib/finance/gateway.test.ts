// Passerelle de paiement de démonstration (F6.2). Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getGateway, luhn } from "./gateway";

describe("passerelle de paiement (sandbox)", () => {
  it("valide les numéros de carte avec l'algorithme de Luhn", () => {
    assert.equal(luhn("4242 4242 4242 4242"), true);
    assert.equal(luhn("4242 4242 4242 4241"), false);
    assert.equal(luhn("1234"), false);
  });

  it("accepte la carte de test et renvoie une référence", async () => {
    const r = await getGateway().authorize({ amountTnd: 30, cardNumber: "4242424242424242", expiry: "12/39", cvc: "123" });
    assert.equal(r.ok, true);
    assert.match(r.ok ? r.reference : "", /^SBX-[0-9A-F]{10}$/);
  });

  it("refuse une carte refusée, expirée ou un code invalide", async () => {
    const gw = getGateway();
    assert.deepEqual(await gw.authorize({ amountTnd: 30, cardNumber: "4000000000000002", expiry: "12/39", cvc: "123" }), { ok: false, error: "Paiement refusé par la banque." });
    assert.equal((await gw.authorize({ amountTnd: 30, cardNumber: "4242424242424242", expiry: "01/20", cvc: "123" })).ok, false);
    assert.equal((await gw.authorize({ amountTnd: 30, cardNumber: "4242424242424242", expiry: "12/39", cvc: "1" })).ok, false);
  });
});
