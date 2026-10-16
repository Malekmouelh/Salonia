"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { chatbotReply, type ChatReply } from "@/lib/booking/chatbot";
import { getPublicSalon } from "@/lib/data/public-salon";

const MessagesSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(600) }))
  .min(1)
  .max(20)
  .refine((m) => m[m.length - 1].role === "user");

const PER_HOUR = 40;
const hits = new Map<string, number[]>();

export async function sendChatMessage(slug: string, messages: { role: "user" | "assistant"; text: string }[]): Promise<ChatReply> {
  const parsed = MessagesSchema.safeParse(messages);
  if (!parsed.success) return { source: "offline", text: "Message invalide." };

  // Limite d'usage par connexion (coût de l'IA, cahier des charges §13).
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const recent = (hits.get(ip) ?? []).filter((t) => Date.now() - t < 3_600_000);
  if (recent.length >= PER_HOUR) return { source: "offline", text: "Beaucoup de messages en peu de temps : utilisez la réservation en 4 étapes ci-dessus." };
  hits.set(ip, [...recent, Date.now()]);

  const salon = await getPublicSalon(slug);
  if (!salon) return { source: "offline", text: "Salon introuvable." };
  return chatbotReply(salon, parsed.data);
}
