import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Public path prefixes (no auth required):
 *   /auth/...               sign-in flow
 *   /api/auth/...           NextAuth callback handlers
 *   /statements/render      print page (called by puppeteer with the Vercel
 *                           protection bypass token; no human session)
 *   /onboarding/<token>     owner intake form sent to prospects after the
 *                           contract is signed; gated by knowledge of a
 *                           per-prospect random token
 *
 * Other API routes (/api/ingest, /api/sync-*, etc.) also stay open for now;
 * they're called manually from inside the dashboard. We can gate them later.
 */
const PUBLIC_PATH_PREFIXES = [
  "/auth/",
  "/api/auth/",
  "/statements/render",
  "/onboarding/",
  "/contract/",
];

/**
 * The Projections module's deliverable render pages (deck / partnership guide /
 * contract) need to be reachable by the headless Chromium that generates PDFs
 * for download. They live under `/projections/<uuid>/...`, so a prefix match
 * isn't precise enough (it would expose the auth-gated edit page). Use a regex
 * that matches *only* the deliverable sub-routes.
 */
const PROJECTION_DELIVERABLE_RE = /^\/projections\/[0-9a-f-]+\/(render|guide|contract)(\/.*)?$/;

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return;
  if (PROJECTION_DELIVERABLE_RE.test(pathname)) return;
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
