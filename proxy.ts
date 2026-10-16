import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decrypt } from "@/lib/session";

// Vérification optimiste (cookie seulement). La vraie vérification se fait dans lib/dal.ts.
const PROTECTED = ["/dashboard"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.includes(path);
  if (!isProtected && !isAuthPage) return NextResponse.next();

  const session = await decrypt(req.cookies.get(SESSION_COOKIE)?.value);

  if (isProtected && !session) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (isAuthPage && session) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
