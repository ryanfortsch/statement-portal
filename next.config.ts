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

  // Audience → Guests rename (2026-05-07). Permanent redirect so old
  // bookmarks, emails, and shared links keep working. Subpaths
  // (campaigns, segments, import, [id]) all funnel through the same
  // wildcard.
  async redirects() {
    return [
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
