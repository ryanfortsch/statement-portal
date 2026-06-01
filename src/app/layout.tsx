import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CommandPalette } from "@/components/CommandPalette";
import { Providers } from "@/components/Providers";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-dash",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {children}
          <CommandPalette />
        </Providers>
      </body>
    </html>
  );
}
