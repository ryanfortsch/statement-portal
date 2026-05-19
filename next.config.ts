import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep @sparticuz/chromium + puppeteer-core out of the bundler's graph --
  // they're consumed on the server at runtime and trying to trace them
  // pulls in native binaries that shouldn't be webpacked.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

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
    ];
  },
};

export default nextConfig;
