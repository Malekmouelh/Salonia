// Module 5 — Liens de contact d'un fournisseur : WhatsApp seulement pour un mobile tunisien, appel pour un fixe, e-mail validé. Lancer : npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { supplierContact } from "./contact";

describe("contact d'un fournisseur", () => {
  it("un mobile tunisien ouvre WhatsApp (wa.me, indicatif +216, sans texte) et reste appelable", () => {
    for (const phone of ["22345678", "22 345 678", "+216 22 345 678", "0021622345678", "98.123.456".replace(/\./g, "")]) {
      const c = supplierContact(phone, null);
      assert.match(c.whatsapp ?? "", /^https:\/\/wa\.me\/216[2459]\d{7}$/, phone);
      assert.match(c.tel ?? "", /^tel:\+216[2459]\d{7}$/, phone);
    }
    assert.equal(supplierContact("22 345 678", null).whatsapp, "https://wa.me/21622345678");
  });

  it("un numéro fixe (7x, 3x) n'a pas de WhatsApp : seulement l'appel", () => {
    for (const phone of ["71861234", "73 345 678", "74223456", "31234567"]) {
      const c = supplierContact(phone, null);
      assert.equal(c.whatsapp, null, phone);
      assert.match(c.tel ?? "", /^tel:\+216\d{8}$/, phone);
    }
  });

  it("un message prérempli est encodé dans le lien WhatsApp", () => {
    assert.equal(supplierContact("22345678", null, "Bonjour, une commande ?").whatsapp, "https://wa.me/21622345678?text=Bonjour%2C%20une%20commande%20%3F");
  });

  it("un numéro absent, trop court, étranger ou mal formé ne produit aucun lien téléphonique", () => {
    for (const phone of [null, undefined, "", "1234", "123456789", "+33612345678", "abcdefgh", "12345678"]) {
      const c = supplierContact(phone, null);
      assert.deepEqual([c.whatsapp, c.tel], [null, null], String(phone));
    }
  });

  it("l'e-mail ouvre la messagerie seulement s'il est bien formé ; aucun script ni espace ne passe dans un lien", () => {
    assert.equal(supplierContact(null, "commandes@beaute-pro.example.tn").mailto, "mailto:commandes@beaute-pro.example.tn");
    for (const email of [null, "", "pas un mail", "a b@c.tn", "javascript:alert(1)"]) assert.equal(supplierContact(null, email).mailto, null, String(email));
  });
});
