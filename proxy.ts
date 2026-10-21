import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Vérification optimiste de la session NextAuth (sans base de données). La vraie vérification se fait dans lib/dal.ts.
const { auth } = NextAuth(authConfig);

const PROTECTED = ["/dashboard"];
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.includes(path);
  if (!isProtected && !isAuthPage) return NextResponse.next();

  const loggedIn = Boolean(req.auth?.user?.id);
  if (isProtected && !loggedIn) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (isAuthPage && loggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|svg|webp)$).*)"],
};
