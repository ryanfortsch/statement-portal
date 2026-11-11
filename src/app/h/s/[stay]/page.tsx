import type { Metadata, Viewport } from 'next';
import { cache } from 'react';
import { auth } from '@/auth';
import { loadGuestStay, recordStaySeen } from '@/lib/guest-app-stays-db';
import type { GuestApp } from '@/lib/guest-app';
import { GuestAppScreen, InactiveLink, ScaMark } from '../../[token]/GuestAppScreen';
import { guestAppCss } from '../../[token]/guest-app-css';
import { StayCard } from './StayCard';

/**
 * One stay's guest app: /h/s/<token> (src/lib/guest-app-stays.ts).
 *
 * The home's app (the permanent page's own loader and screen) plus "Your
 * stay" inside the stay's window: 10:00 AM Eastern the day before check-in
 * to the guest's checkout. Before the window it is the home's app and the
 * hour the stay opens; after it, a thank-you page; a cancelled stay or a
 * revoked link reads as a moved link, like a retired home link.
 *
 * The token is the credential (128 random bits on the RLS-locked
 * guest_app_stays table), so the proxy lets /h/ through as it does for the
 * permanent page. The door code is not in this page's HTML: the stay card
 * has a button that POSTs to ./code for it, so link previews, mail scanners
 * and the service worker's offline copy never hold it.
 *
 * No web-app manifest here: the installed app would open this link, which
 * stops working at checkout, and the manifest's start URL would put the
 * home's permanent token in a page the stay link alone can open.
 */
export const dynamic = 'force-dynamic';

const load = cache((token: string) => loadGuestStay(token));

type Params = { params: Promise<{ stay: string }> };

function appOf(view: Awaited<ReturnType<typeof loadGuestStay>>): GuestApp | null {
  return view.kind === 'void' ? null : view.app;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { stay } = await params;
  const app = appOf(await load(stay));
  return {
    title: app ? `${app.title} · Stay Cape Ann` : 'Stay Cape Ann',
    description: 'Your stay: arrival steps, the door, Wi-Fi, checkout, and Cape Ann nearby.',
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    referrer: 'no-referrer',
    icons: { icon: '/h/app-icon', apple: '/h/app-icon' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0F2A44',
};

export default async function GuestStayPage({ params }: Params) {
  const { stay: token } = await params;
  const view = await load(token);
  if (view.kind === 'void') return <InactiveLink />;

  // The team previewing from the property page does not count as a guest.
  if (!(await auth())?.user) await recordStaySeen(token, false);

  if (view.kind === 'over') return <StayEnded app={view.app} />;
  if (view.kind === 'before') {
    return <GuestAppScreen app={view.app} top={<p className="ga-stay-later">{view.opens}</p>} />;
  }
  return <GuestAppScreen app={view.app} top={<StayCard token={token} stay={view.stay} textUs={view.app.contact.text} />} />;
}

/** After checkout: thanks, the way back, and nothing about the house. */
function StayEnded({ app }: { app: GuestApp }) {
  return (
    <div className="ga" lang="en">
      <style>{guestAppCss}</style>
      <main className="ga-main ga-inactive">
        <ScaMark size={44} />
        <p className="ga-display">
          Thank you for <em>staying with us.</em>
        </p>
        <p className="ga-welcome-text">
          This link was for your stay at {app.title}, and it has ended. Left something behind? Text us.
        </p>
        <a className="ga-btn" href={app.contact.text}>
          Text {app.contact.phoneDisplay}
        </a>
        {app.bookAgainUrl ? (
          <a className="ga-btn ga-btn-light" href={app.bookAgainUrl} target="_blank" rel="noreferrer">
            Book this home again
          </a>
        ) : null}
        <p className="ga-foot-tip">
          <a href="https://staycapeann.com">staycapeann.com</a>
        </p>
      </main>
    </div>
  );
}
