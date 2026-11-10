import { whatsappLink } from "@/lib/booking/messages";

// Module 5 — Contacter un fournisseur en un clic. Les fournisseurs n'ont pas accès à l'application : on ouvre l'outil de l'utilisateur
// (WhatsApp Web ou l'application, appel, messagerie) et c'est lui qui envoie. Rien n'est envoyé par l'application.
//
// Le lien WhatsApp réutilise whatsappLink (lib/booking/messages.ts, Module 3, non modifié) : numéro tunisien à 8 chiffres → https://wa.me/216….
// Seuls les numéros MOBILES tunisiens (commençant par 2, 4, 5 ou 9) ont WhatsApp : un numéro fixe (3x, 7x) ouvrirait une conversation avec un
// numéro non inscrit. Pour un fixe on propose donc l'appel (tel:). Un numéro étranger ou mal formé ne produit aucun lien.

const TN_LOCAL = /^[2-9]\d{7}$/;
const MOBILE_FIRST_DIGIT = /^[2459]/;

export type SupplierContact = { whatsapp: string | null; tel: string | null; mailto: string | null };

// phone : 8 chiffres normalisés par le serveur (ou saisie avec espaces, +216 ou 00216) ; message : texte prérempli facultatif.
export function supplierContact(phone: string | null | undefined, email: string | null | undefined, message = ""): SupplierContact {
  const digits = (phone ?? "").replace(/[\s.-]/g, "").replace(/^(?:\+216|00216)/, "");
  const valid = TN_LOCAL.test(digits);
  const mobile = valid && MOBILE_FIRST_DIGIT.test(digits);
  const trimmedEmail = (email ?? "").trim();
  return {
    whatsapp: mobile ? whatsappLink(digits, message).replace(/\?text=$/, "") : null,
    tel: valid ? `tel:+216${digits}` : null,
    mailto: /^[^\s@]+@[^\s@]+$/.test(trimmedEmail) ? `mailto:${trimmedEmail}` : null,
  };
}
