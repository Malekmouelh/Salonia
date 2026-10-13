import { appIcon } from "@/lib/app-icon";

const VARIANTS = { "192": 192, "512": 512, maskable: 512 } as const;

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, { params }: RouteContext<"/icons/[variant]">) {
  const { variant } = await params;
  const size = VARIANTS[variant as keyof typeof VARIANTS];
  if (!size) return new Response("Not found", { status: 404 });
  return appIcon(size, { maskable: variant === "maskable" });
}
