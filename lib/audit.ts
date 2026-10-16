import "server-only";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import type { AuthEventType } from "@/lib/enums";
import { AuthEvent } from "@/lib/models/core";

// Journal des actions sensibles. Ne bloque jamais l'action en cas d'échec d'écriture.
export async function logEvent(
  type: AuthEventType,
  data: { userId?: string | null; organizationId?: string | null; detail?: string } = {},
) {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
    await connectDB();
    await AuthEvent.create({
      type,
      userId: data.userId ?? null,
      organizationId: data.organizationId ?? null,
      detail: data.detail?.slice(0, 200),
      ip,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    });
  } catch (error) {
    console.error("Journal de sécurité indisponible :", error);
  }
}

// « Chrome · Windows », « Safari · iPhone »… à partir du user-agent.
export function describeDevice(ua: string | null | undefined) {
  if (!ua) return "Appareil inconnu";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navigateur";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} · ${os}` : browser;
}
