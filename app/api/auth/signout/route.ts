import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// Supprime une session devenue invalide (compte supprimé) puis renvoie vers la connexion.
// Une page serveur ne peut pas modifier les cookies, d'où cette route.
export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.nextUrl));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
