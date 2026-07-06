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
 * API routes are gated by default too (see PUBLIC_API_PREFIXES below):
 * everything under /api now requires a Helm session EXCEPT the handful of
 * endpoints that carry their own auth (webhook signatures, CRON_SECRET, the
 * stay-concierge shared key, per-token PDF access) or that serve the guest /
 * owner-facing portals. A gated /api request with no session gets a 401.
 */
const PUBLIC_PATH_PREFIXES = [
  "/auth/",
  "/api/auth/",
  "/statements/render",
  "/onboarding/",
  "/contract/",
  // Direct booking flow lives under /book/<propertyId> and is intentionally
  // guest-facing — it's the Helm-native counterpart to a public Airbnb listing.
  "/book/",
  // Field: the external contractor portal. Inspectors reach it via a
  // per-contractor magic-link token and a session cookie, NOT Helm's Google
  // SSO. The Field tables are RLS-locked and read only through the
  // service-role client, so opening this prefix exposes no internal data.
  "/field/",
];

/**
 * /api prefixes that must stay reachable WITHOUT a Helm session because they
 * carry their own authentication or serve an external caller:
 *
 *   /api/auth/...            NextAuth callback handlers (also above)
 *   /api/webhooks/...        Quo / Seam / inquiry — HMAC/Svix signature verified
 *   /api/cron/...            Vercel Cron (CRON_SECRET) + signed-in manual trigger
 *   /api/channels/ical/...   per-property high-entropy iCal export token
 *   /api/guests/subscribe    staycapeann.com signup (CORS preflight + POST)
 *   /api/guests/unsubscribe  one-click unsubscribe from a marketing email
 *   /api/guests/resend-webhook  Resend engagement events (Svix signature)
 *   /api/projection-pdf      self-guards: Helm auth OR a valid onboarding token
 *                            (lets a prospect download their signed contract)
 *   /api/archive-onboarding  fired by the public onboarding thank-you page
 *   /api/owner-outbound-quo  } the stay-concierge service authenticates to these
 *   /api/owners-sync         } with the STAY_CONCIERGE_KEY shared secret;
 *   /api/kb-facts            } it has no Helm session (kb-facts feeds property
 *   /api/backfill-owner-phones } wifi/parking/notes into the guest AI's KB)
 *   /api/work-slips          } (work-slips: approved guest gear requests
 *                            } become prep slips on /work)
 *
 * Everything else under /api requires a valid session.
 */
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",
  "/api/cron/",
  "/api/channels/ical/",
  "/api/guests/subscribe",
  "/api/guests/unsubscribe",
  "/api/guests/resend-webhook",
  "/api/projection-pdf",
  "/api/archive-onboarding",
  "/api/owner-outbound-quo",
  "/api/owners-sync",
  "/api/kb-facts",
  "/api/backfill-owner-phones",
  "/api/work-slips",
  // Field contractor uploads (profile photo). Self-guards via the contractor
  // session cookie, not Helm SSO — same auth plane as the /field portal.
  "/api/field/",
];

/**
 * The Projections module's deliverable render pages (deck / partnership guide /
 * contract) need to be reachable by the headless Chromium that generates PDFs
 * for download. They live under `/projections/<uuid>/...`, so a prefix match
 * isn't precise enough (it would expose the auth-gated edit page). Use a regex
 * that matches *only* the deliverable sub-routes.
 */
const PROJECTION_DELIVERABLE_RE = /^\/projections\/[0-9a-f-]+\/(render|guide|contract|onboarding-render)(\/.*)?$/;

/** Same pattern for the Properties module. Guest-facing deliverables (Home
 * Guide, WiFi placard, Information Note, Welcome Card) need to be public
 * so puppeteer can render them to PDF. The property edit page at
 * `/properties/<id>` itself stays auth-gated. Property IDs are TEXT slugs
 * (e.g. "21_horton") so the character class is wider than UUIDs. */
const PROPERTY_DELIVERABLE_RE = /^\/properties\/[a-z0-9_-]+\/(home-guide|wifi-placard|info-note|welcome-card)(\/.*)?$/;

/**
 * Bespoke notices live at `/properties/<id>/notice/<uuid>` (singular).
 * The plural `/properties/<id>/notices/...` (new + edit forms) stays
 * auth-gated — only the renderer is public so puppeteer can hit it.
 */
const PROPERTY_NOTICE_RE = /^\/properties\/[a-z0-9_-]+\/notice\/[0-9a-f-]+(\/.*)?$/;

/**
 * The inspection print view at `/inspections/<uuid>/render` needs to be
 * reachable by the headless Chromium that archives completed inspections
 * to Drive. The interactive inspection (`/inspections/<uuid>`) and the
 * summary (`/inspections/<uuid>/summary`) stay auth-gated — only the
 * /render sub-route is public, same pattern as the projection
 * deliverables above.
 */
const INSPECTION_RENDER_RE = /^\/inspections\/[0-9a-f-]+\/render(\/.*)?$/;

export default auth((req) => {
  /**
   * Canonicalize statements.risingtidestr.com to helm.risingtidestr.com.
   *
   * `AUTH_URL` is pinned to helm, so any sign-in initiated from statements
   * bounces statements → helm → Google → helm → statements. iOS Safari's
   * tracking protection treats a cross-host cookie set mid-bounce on a host
   * the user never lands on as bounce-tracking, and was purging the session
   * cookie between launches, which forced a fresh Google sign-in (and 2FA)
   * every visit. Collapsing to one host removes the bounce.
   *
   * The apex session cookie above stays useful for any future subdomain.
   */
  if (req.nextUrl.hostname === "statements.risingtidestr.com") {
    const target = req.nextUrl.clone();
    target.hostname = "helm.risingtidestr.com";
    return NextResponse.redirect(target, 308);
  }

  const { pathname } = req.nextUrl;

  // The "/field/" prefix covers contractor sub-routes; the marketplace home
  // is exactly "/field" (no trailing slash), so allow it explicitly too.
  if (pathname === "/field") return;
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return;
  if (PROJECTION_DELIVERABLE_RE.test(pathname)) return;
  if (PROPERTY_DELIVERABLE_RE.test(pathname)) return;
  if (PROPERTY_NOTICE_RE.test(pathname)) return;
  if (INSPECTION_RENDER_RE.test(pathname)) return;

  // API routes: gate everything except the self-authenticating / portal set.
  // Anonymous callers get a 401 JSON (not an HTML sign-in redirect, which a
  // fetch/integration caller can't follow).
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return;
    if (req.auth) return;
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
