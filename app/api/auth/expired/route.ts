import { signOut } from "@/auth";

// Session encore valide mais compte supprimé : on efface le cookie NextAuth puis retour à la connexion.
// Une page serveur ne peut pas modifier les cookies, d'où cette route.
export async function GET() {
  await signOut({ redirectTo: "/login" });
}
