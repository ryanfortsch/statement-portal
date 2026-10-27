import type { NextConfig } from "next";

// One stable identifier per production deployment, for version-skew
// detection: a tab whose JS came from build A while the server is already
// serving build B, and the old build vanishes the moment a deploy lands.
// NEXT_DEPLOYMENT_ID is checked first because when a platform sets it, Next
// itself adopts it and errors if the config disagrees. Locally all three are
// absent and every skew feature stays inert.
//
// Two layers handle a tab whose bundle is older than the server's:
//   1. Platform Skew Protection, on since 2026-08-26 at skewProtectionMaxAge =
//      43200 (12 hours; checked on the project 2026-10-22). Vercel routes a
//      stale tab's requests back to its ORIGINAL deployment, so it keeps
//      working.
//   2. `deploymentId` below, Next's own check. Past the 12 hours, a
//      navigation, refresh or server action that comes back from a newer
//      deployment hard-reloads the tab instead of applying a payload the old
//      bundle can't render.
//
// The homegrown layer that ran alongside them (VersionGuard's 60s poll and
// tab-wake check, /api/version, lib/version-skew.ts) was retired on
// 2026-10-22 after eight weeks of deploys under the platform feature. What
// stays: the Button/SubmitButton watchdog's 30s reload, which covers a
// response Vercel shed rather than skew (lib/use-pending-watchdog.ts), and
// the unsaved-work registry, which keeps AutoRefresh from refreshing into
// that hard reload while someone is typing.
const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  '';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        // Preserve origin-based integrations without sending token-bearing paths.
        { key: 'Referrer-Policy', value: 'strict-origin' },
      ],
    }];
  },

  // Native skew handling: Next stamps RSC and server-action requests with
  // x-deployment-id and compares the id echoed on navigation responses, so
  // a stale client hard-navigates instead of applying a payload its bundle
  // can't render (the 2026-08-02 spin-then-error-boundary failure).
  deploymentId: deploymentId || undefined,

  // Keep @sparticuz/chromium + puppeteer-core out of the bundler's graph --
  // they're consumed on the server at runtime and trying to trace them
  // pulls in native binaries that shouldn't be webpacked.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

  // The listing-copy generator posts photos through a server action.
  // Next's default body cap is 1MB, which a single un-compressed phone
  // photo blows past -- the platform then drops the request before our
  // code runs and the browser shows a dead "page couldn't load" screen.
  // The client now downscales photos before upload (~300KB each), so
  // 4mb gives 6 compressed photos + form text generous headroom while
  // staying under Vercel's 4.5MB hard request limit.
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },

  // Next's output-file-tracing skips the Chromium binary under
  // node_modules/@sparticuz/chromium/bin by default. Without this, the
  // packaged Lambda can't find the executable and draft-email falls back
  // to "no PDF attached". Force-include the whole package.
  outputFileTracingIncludes: {
    '/api/draft-email': ['./node_modules/@sparticuz/chromium/**/*'],
    '/api/statement-pdf': ['./node_modules/@sparticuz/chromium/**/*'],
  },

  async redirects() {
    return [
      // ─── Cleaner live-schedule link shortened to /c/ ────────────────
      // The link ships at the end of every cleaner SMS, so the path was
      // cut from "/clean/<32 hex>?d=YYYY-MM-DD" (85 chars) to
      // "/c/<16 hex>" (~48). Never remove this redirect: a texted link
      // lives on a cleaner's phone indefinitely and there is no way to
      // reissue one already delivered.
      {
        source: '/clean/:token',
        destination: '/c/:token',
        permanent: true,
      },
      // ─── Canonical domain: statements. → helm. ──────────────────────
      // The deployment answers on multiple aliases (helm.risingtidestr.com,
      // statements.risingtidestr.com, plus vercel.app URLs), but AUTH_URL
      // pins the Google OAuth callback to helm.risingtidestr.com. If a
      // user starts the sign-in flow on statements.risingtidestr.com, the
      // PKCE/state cookies get scoped to that host, the callback lands on
      // helm.risingtidestr.com (no cookie there), and Auth.js fails with
      // `InvalidCheck` — the user sees a bare "Server error" page.
      //
      // Fix: forward every statements.risingtidestr.com request to the
      // same path on helm.risingtidestr.com BEFORE the app (or any auth
      // cookie) is touched, so the whole OAuth flow lives on one host.
      // Old bookmarks keep working; the redirect just teaches them the
      // new domain. helm.risingtidestr.com itself doesn't match the host
      // condition, so there's no loop; preview vercel.app URLs are
      // untouched.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'statements.risingtidestr.com' }],
        destination: 'https://helm.risingtidestr.com/:path*',
        permanent: true,
      },

      // Audience → Guests rename (2026-05-07). Permanent redirect so old
      // bookmarks, emails, and shared links keep working. Subpaths
      // (campaigns, segments, import, [id]) all funnel through the same
      // wildcard.
      {
        source: '/audience',
        destination: '/guests',
        permanent: true,
      },
      {
        source: '/audience/:path*',
        destination: '/guests/:path*',
        permanent: true,
      },

      // /me folded into the home ForMeFeed (2026-06-21). The "Planned
      // walks" / "Your work slips" / "Your tasks" sections live on the home
      // page now; the orphan /me page was deleted. Redirect any stale
      // bookmark to home so nobody hits a 404.
      {
        source: '/me',
        destination: '/',
        permanent: true,
      },
      // The cleaner and contractor inboxes are one Team inbox (2026-10-18).
      // Old links (alerts, texts, bookmarks) land on the same cards with the
      // filter set; query strings ride along and the browser keeps #anchors.
      {
        source: '/cleaner-messaging',
        destination: '/messaging/team?audience=cleaners',
        permanent: true,
      },
      {
        source: '/contractor-messaging',
        destination: '/messaging/team?audience=contractors',
        permanent: true,
      },
      // The guest gear grid moved from Work to Properties (2026-10-18): it is
      // a fact about the homes, not daily work. Bookmarks and the old Work
      // tab land on the same grid.
      {
        source: '/work/gear',
        destination: '/properties/guest-gear',
        permanent: true,
      },
      // /today retired into the home (2026-10-18): today's stays are a home
      // section under the feed, the emails were already on it. Old morning
      // texts and bookmarks still carry the link, so it lands on the home.
      {
        source: '/today',
        destination: '/',
        permanent: true,
      },
      // Balance charges moved under Payments (2026-10-18): it charges a
      // guest's saved card, a payments job, not a step of the statement
      // close. The concierge's older balance work slips carry the old link.
      {
        source: '/statements/balance-charges',
        destination: '/payments/balance-charges',
        permanent: true,
      },

      // ─── IA rename (2026-08-20): URL honesty pass ───────────────────
      // /operations became /turnovers, the contractor-facing lenses moved
      // under /fieldwork, and the prospect workroom moved from /projections
      // to /prospects. Permanent because the old URLs live in SMS and email
      // history (field-notify links, the morning brief, owner emails); the
      // statements-domain incident proved external callers keep hitting old
      // URLs for months. Never remove these.
      //
      // NOT redirected on purpose: /projections/:id/(render|guide|contract|
      // onboarding-render) are public deliverable surfaces with external
      // callers (proxy allowlist + Puppeteer). They stay at their old URLs.
      // The single-segment '/projections/:id' source below cannot match
      // those two-segment paths, so they render in place.
      {
        source: '/operations',
        destination: '/turnovers',
        permanent: true,
      },
      {
        source: '/operations/packets/:path*',
        destination: '/fieldwork/packets/:path*',
        permanent: true,
      },
      {
        source: '/operations/contractors/applicants',
        destination: '/fieldwork/hiring',
        permanent: true,
      },
      {
        source: '/operations/contractors/rate-card',
        destination: '/fieldwork/rate-card',
        permanent: true,
      },
      {
        source: '/operations/contractors/hiring-package',
        destination: '/fieldwork/hiring-package',
        permanent: true,
      },
      {
        source: '/operations/contractors',
        destination: '/fieldwork/roster',
        permanent: true,
      },
      {
        source: '/operations/creative/:path*',
        destination: '/fieldwork/shoots/:path*',
        permanent: true,
      },
      {
        source: '/projections/new',
        destination: '/prospects/new',
        permanent: true,
      },
      {
        source: '/projections/:id/readiness',
        destination: '/prospects/:id/readiness',
        permanent: true,
      },
      {
        source: '/projections/:id/readiness/print',
        destination: '/prospects/:id/readiness/print',
        permanent: true,
      },
      {
        source: '/projections/:id',
        destination: '/prospects/:id',
        permanent: true,
      },

      // Segments and Import stopped being pages (2026-10-18): the two system
      // segments ride the new-campaign Audience select with their counts,
      // and the CSV import is a file input under Contacts' Manage list menu.
      {
        source: '/guests/segments',
        destination: '/guests/campaigns/new',
        permanent: true,
      },
      {
        source: '/guests/import',
        destination: '/guests/contacts',
        permanent: true,
      },
      // Channels lost three pages (2026-10-18): the 65 Calderwood pilot
      // workspace and its read-only inbox (the hub shows the same
      // reconciliation, in Helm's own skin), the flag-gated Airbnb request
      // desk, and the fleet wiring page, now the Edit wiring fold on each
      // home's hub.
      {
        source: '/channels/pilot/:path*',
        destination: '/channels/65_calderwood',
        permanent: true,
      },
      {
        source: '/channels/pilot',
        destination: '/channels/65_calderwood',
        permanent: true,
      },
      {
        source: '/channels/requests',
        destination: '/channels',
        permanent: true,
      },
      {
        source: '/channels/listings',
        destination: '/channels',
        permanent: true,
      },
      // Marketing Memory moved onto each home's property page as "How we
      // sell it" (Guest & listing tab), 2026-10-18.
      {
        source: '/guests/marketing',
        destination: '/properties',
        permanent: true,
      },

      // Query-param tabs promoted to real routes. Bare /guests stays the
      // Reviews lens; the Contacts and Agreements tabs get honest URLs.
      {
        source: '/guests',
        has: [{ type: 'query', key: 'tab', value: 'contacts' }],
        destination: '/guests/contacts',
        permanent: true,
      },
      {
        source: '/guests',
        has: [{ type: 'query', key: 'tab', value: 'agreements' }],
        destination: '/guests/agreements',
        permanent: true,
      },
      {
        source: '/properties',
        has: [{ type: 'query', key: 'view', value: 'prospects' }],
        destination: '/properties/prospects',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
