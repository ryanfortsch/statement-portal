import type { NextConfig } from "next";

// One stable identifier per production deployment, for version-skew
// detection: a tab whose JS came from build A while the server is already
// serving build B (Hobby plan, so Vercel Skew Protection is unavailable
// and old builds vanish the moment a deploy lands). NEXT_DEPLOYMENT_ID is
// checked first because when a platform sets it, Next itself adopts it and
// errors if the config disagrees. Locally all three are absent and every
// skew feature stays inert.
const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  '';

const nextConfig: NextConfig = {
  // Native skew handling: Next stamps RSC and server-action requests with
  // x-deployment-id and compares the id echoed on navigation responses, so
  // a stale client hard-navigates instead of applying a payload its bundle
  // can't render (the 2026-08-02 spin-then-error-boundary failure).
  deploymentId: deploymentId || undefined,

  // The same id, inlined into BOTH the client and server bundles at build
  // time (next.config `env` goes through the compiler's define step). The
  // 20s AutoRefresh poller compares its inlined copy against /api/version,
  // which returns the server bundle's inlined copy, and hard-reloads once
  // on mismatch. See src/components/AutoRefresh.tsx.
  env: {
    NEXT_PUBLIC_DEPLOYMENT_ID: deploymentId,
  },

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
