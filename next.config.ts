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
};

export default nextConfig;
