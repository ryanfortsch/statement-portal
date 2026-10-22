import type { Metadata } from "next";
import "./fonts/fonts.css";
import localFont from "next/font/local";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { auth } from "@/auth";
import { CommandPalette } from "@/components/CommandPalette";
import { Providers } from "@/components/Providers";
import { sessionView } from "@/lib/helm-access-server";

// Fraunces, Inter and JetBrains Mono are self-hosted. The woff2 files in
// ./fonts are the exact bytes next/font/google used to fetch from Google at
// build time, and that fetch was the one recurring cause of failed production
// builds (7 of the 8 failures between 10/15 and 10/22).
//
// These calls declare the latin subset, the one that is preloaded.
// ./fonts/fonts.css declares every other subset, the metric-matched fallback
// faces, and the three variables globals.css reads (--font-fraunces,
// --font-inter, --font-mono-dash). Together they reproduce Google's rules
// exactly, so nothing renders differently. The variables are set there, not
// with next/font's `variable` option, because next/font/local writes the
// const's name as the first family ("mono" here, which fontconfig on Linux
// reads as monospace) rather than the family declared below. The consts are
// never read: assigning them is what makes next/font emit the rules and the
// preload links at build time. See ./fonts/README.md.
/* eslint-disable @typescript-eslint/no-unused-vars */
const fraunces = localFont({
  src: [
    { path: "./fonts/fraunces-italic-latin.woff2", weight: "300", style: "italic" },
    { path: "./fonts/fraunces-italic-latin.woff2", weight: "400", style: "italic" },
    { path: "./fonts/fraunces-italic-latin.woff2", weight: "500", style: "italic" },
    { path: "./fonts/fraunces-italic-latin.woff2", weight: "600", style: "italic" },
    { path: "./fonts/fraunces-latin.woff2", weight: "300", style: "normal" },
    { path: "./fonts/fraunces-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/fraunces-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/fraunces-latin.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "Fraunces" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  adjustFontFallback: false,
});

const inter = localFont({
  src: [
    { path: "./fonts/inter-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/inter-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "Inter" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  adjustFontFallback: false,
});

const mono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "JetBrains Mono" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
  adjustFontFallback: false,
});
/* eslint-enable @typescript-eslint/no-unused-vars */

export const metadata: Metadata = {
  title: "Rising Tide Helm",
  description: "Internal operations hub for Rising Tide STR",
  applicationName: "Helm",
  // The combination of appleWebApp + the manifest exported from
  // src/app/manifest.ts lets iOS treat Helm as a standalone app when
  // it's added to the home screen. That sidesteps Safari's 7-day
  // Intelligent Tracking Prevention cookie purge, which is what
  // actually keeps re-triggering Google's 2FA on phones even with our
  // 90-day Auth.js session + apex cookie domain in place.
  appleWebApp: {
    capable: true,
    title: "Helm",
    statusBarStyle: "default",
  },
  // Phone numbers in tasks/messages shouldn't get auto-linked into
  // tel: handlers by iOS — they're info, not call-to-tap targets.
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  // Status-bar tint when launched from the iOS home screen, matched to
  // the signal red-orange brand accent.
  themeColor: "#c85a3a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read once here and hand to the client SessionProvider, so the nav knows
  // the owner/staff role on first paint (see Providers). Null on the public
  // token pages, which is fine: they render no Helm chrome. The view is the
  // effective role (View as staff included), resolved here on the server.
  const [session, view] = await Promise.all([auth(), sessionView()]);
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <Providers session={session} view={view}>
          {children}
          <CommandPalette />
          {/* Page-view analytics so IA questions are answered by data Helm
              owns (route patterns, not query strings). No-ops locally and
              until Web Analytics is enabled on the Vercel project. */}
          <Analytics />
        </Providers>
      </body>
    </html>
  );
}
