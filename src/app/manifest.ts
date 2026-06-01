import type { MetadataRoute } from 'next';

/**
 * Web manifest for Helm. The point of this file is "Add to Home Screen"
 * on iOS Safari: with a manifest + apple-icon + appleWebApp metadata in
 * the root layout, iOS treats Helm as a standalone app and stops
 * applying its 7-day Intelligent Tracking Prevention cookie purge to
 * the auth session. End result: Dotti and Allie stop getting bounced
 * back through Google's 2FA flow every few days on mobile.
 *
 * (Auth.js is already configured with a 90-day JWT session + apex
 * cookie domain, so the only thing eating the session on mobile is
 * Safari ITP. Installing as a PWA sidesteps it.)
 *
 * Brand colors taken from globals.css: warm paper background, signal
 * red-orange brand accent. theme_color shows up as the iOS status-bar
 * tint when launched from the home screen.
 *
 * The icon at `/icon` and `/apple-icon` is auto-served by Next.js from
 * src/app/icon.png and src/app/apple-icon.png respectively.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rising Tide Helm',
    short_name: 'Helm',
    description: 'Internal operations hub for Rising Tide STR',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#faf7f1',
    theme_color: '#c85a3a',
    icons: [
      // Same 512x512 source serves both the maskable Android icon and
      // the iOS home-screen tile (iOS uses apple-icon via the auto link
      // tag; this entry is here so Chromium also recognises Helm as
      // installable on desktop / Android).
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
