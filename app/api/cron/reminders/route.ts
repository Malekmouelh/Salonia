import { NextResponse, type NextRequest } from "next/server";
import { sendDueReminders } from "@/lib/booking/reminders";

// Déclenchement planifié des rappels (Vercel Cron chaque jour à 8 h, heure de Tunis : voir vercel.json ;
// le plan gratuit de Vercel autorise une exécution par jour, toutes les heures avec le plan Pro).
// Protégé par CRON_SECRET : en-tête « Authorization: Bearer <CRON_SECRET> ».
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const result = await sendDueReminders();
  return NextResponse.json(result);
}
