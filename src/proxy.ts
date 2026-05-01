import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Public path prefixes (no auth required):
 *   /auth/...               sign-in flow
 *   /api/auth/...           NextAuth callback handlers
 *   /statements/render      print page (called by puppeteer with the Vercel
 *                           protection bypass token; no human session)
 *
 * Other API routes (/api/ingest, /api/sync-*, etc.) also stay open for now;
 * they're called manually from inside the dashboard. We can gate them later.
 */
const PUBLIC_PATH_PREFIXES = [
  "/auth/",
  "/api/auth/",
  "/statements/render",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return;
  if (pathname.startsWith("/api/")) return;

  if (!req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
});

export const config = {
  // Run middleware on everything except Next.js internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|apple-icon|icon.png|rising-tide-logo.png|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
