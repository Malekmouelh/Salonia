import { z } from "zod";

// Réservation en cours, gardée dans l'adresse (?reprise=…) pendant que le client se connecte
// ou crée son compte : il retrouve ses prestations, son praticien et son créneau au retour.
// Rien n'est réservé tant qu'il n'a pas confirmé ; le serveur revérifie tout à la confirmation.
const id = z.string().regex(/^[a-f\d]{24}$/i);

export const DraftSchema = z.object({
  centerId: id,
  serviceIds: z.array(id).max(6),
  packId: id.nullable(),
  staffId: id.nullable(),
  selectedOptions: z.record(z.string().max(40), z.record(z.string().max(80), z.string().max(80))).optional(),
  slot: z.object({ start: z.iso.datetime(), end: z.iso.datetime(), staffIds: z.array(id).max(30) }),
  viaChatbot: z.boolean().optional(),
});
export type BookingDraft = z.infer<typeof DraftSchema>;

// Encodage base64url (UTF-8) utilisable côté navigateur.
export function encodeDraft(draft: BookingDraft) {
  const bytes = new TextEncoder().encode(JSON.stringify(draft));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDraft(value: string | string[] | undefined): BookingDraft | null {
  if (typeof value !== "string" || value.length > 3000) return null;
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const parsed = DraftSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
