import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep @sparticuz/chromium + puppeteer-core out of the bundler's graph --
  // they're consumed on the server at runtime and trying to trace them
  // pulls in native binaries that shouldn't be webpacked.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
};

export default nextConfig;
