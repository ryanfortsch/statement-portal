import type { Metadata, Viewport } from 'next';
import { auth } from '@/auth';
import { cache } from 'react';
import { loadGuestAppByToken as loadByToken, recordGuestAppOpen } from '@/lib/guest-app-db';
import { GuestAppScreen, InactiveLink } from './GuestAppScreen';

/**
 * The Stay Cape Ann guest app for one home: /h/<token>.
 *
 * A guest reaches it from the QR card in the house or a link in a message.
 * The token is the credential (64 random bits on the RLS-locked
 * guest_app_homes table, read through the service role), so the proxy lets
 * /h/ through without a Helm session, the way it lets /c/ through for
 * Rosa's schedule. Knowing the token shows the home's Wi-Fi password and
 * how the house works, never an access code (see src/lib/guest-app.ts).
 *
 * Live on every load (force-dynamic): a fact fixed on the property page is
 * on the guest's phone the next time they open it. noindex and
 * no-referrer, so the link stays out of search and out of the Referer a
 * tapped Directions link would otherwise send.
 */
export const dynamic = 'force-dynamic';

/** One read per request: the metadata and the page share it. */
const loadGuestAppByToken = cache((token: string) => loadByToken(token));

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const found = await loadGuestAppByToken(token);
  const title = found ? `${found.app.title} · Stay Cape Ann` : 'Stay Cape Ann';
  return {
    title,
    description: 'Your home guide: Wi-Fi, checkout, how the house works, and Cape Ann nearby.',
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    referrer: 'no-referrer',
    applicationName: found?.app.title ?? 'Stay Cape Ann',
    manifest: found ? `/h/${token}/manifest.webmanifest` : undefined,
    icons: { icon: '/h/app-icon', apple: '/h/app-icon' },
    appleWebApp: { capable: true, title: found?.app.title ?? 'Stay Cape Ann', statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F2A44',
};

export default async function GuestAppPage({ params }: Params) {
  const { token } = await params;
  const found = await loadGuestAppByToken(token);

  // A rotated or switched-off link still lands somewhere kind, with a way
  // to reach us. Same page for a token that never existed: nothing here
  // says which it was.
  if (!found) return <InactiveLink />;
  const { app } = found;

  // The team previewing from the property page does not count as a guest.
  if (!(await auth())?.user) await recordGuestAppOpen(token);

  return <GuestAppScreen app={app} />;
}
