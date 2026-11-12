import { renderQrForPlacard } from '@/lib/qr-sizing';
import { QUO_LINES } from '@/lib/quo-lines';
import { phoneDisplay, smsHref, type GuestApp } from '@/lib/guest-app';
import { GuestAppBody } from './GuestAppBody';
import { guestAppCss } from './guest-app-css';

/**
 * The guest app's screen for one built GuestApp, apart from the route so the
 * page stays a thin read (token, open count) around it.
 *
 * `top` is the stay link's slot (/h/s/<token>): "Your stay" inside the
 * window, or the hour it opens. `join` is its email line on a direct booking
 * (src/app/h/s/[stay]/StayJoin.tsx). The permanent page passes neither: it is
 * printed in the house, so whoever reads it may be on an OTA booking.
 */
export async function GuestAppScreen({ app, top, join }: { app: GuestApp; top?: React.ReactNode; join?: React.ReactNode }) {
  const wifiQr: Record<string, string> = {};
  for (const n of app.wifi) {
    if (!n.joinUri) continue;
    const { svg } = await renderQrForPlacard({
      uri: n.joinUri,
      errorCorrectionLevel: 'M',
      color: { dark: '#0F2A44', light: '#FCFAF5' },
      floorPx: 160,
    });
    wifiQr[n.ssid] = svg;
  }

  const hero = (
    <header className={`ga-hero${app.heroUrl ? ' has-photo' : ''}`}>
      {app.heroUrl ? (
        // A plain img on purpose: Blob photos are already sized, and the
        // page must not depend on Helm's image optimizer config.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ga-hero-img" src={app.heroUrl} alt="" />
      ) : null}
      <div className="ga-hero-inner">
        <div className="ga-brand">
          <ScaMark size={26} navy="#FCFAF5" sand="#C8B89A" />
          <span>Stay Cape Ann</span>
        </div>
        <h1 className="ga-h1">{app.title}</h1>
        {app.address ? (
          <p className="ga-hero-addr" translate="no">
            {app.address}
            {app.cityLine ? ` · ${app.cityLine}` : ''}
          </p>
        ) : null}
      </div>
    </header>
  );

  const intro = (
    <>
      <section className="ga-welcome">
        <p className="ga-display">
          Welcome <em>home.</em>
        </p>
        <p className="ga-welcome-text">{app.welcome}</p>
      </section>
      {top}
    </>
  );

  return (
    <div className="ga" lang="en">
      <style>{guestAppCss}</style>
      <GuestAppBody app={app} wifiQr={wifiQr} mark={<ScaMark size={36} navy="#FCFAF5" sand="#C8B89A" />} hero={hero} intro={intro} join={join} />
    </div>
  );
}

export function InactiveLink() {
  const line = QUO_LINES.guests.number;
  return (
    <div className="ga" lang="en">
      <style>{guestAppCss}</style>
      <main className="ga-main ga-inactive">
        <ScaMark size={44} />
        <p className="ga-display">
          This guide link <em>has moved.</em>
        </p>
        <p className="ga-welcome-text">
          The page for this home has a new address. Text us and we will send it right over.
        </p>
        <a className="ga-btn" href={smsHref(line, 'Hi, the home guide link I have is not working. Could you send the new one?')}>
          Text {phoneDisplay(line)}
        </a>
        <p className="ga-foot-tip">
          <a href="https://staycapeann.com">staycapeann.com</a>
        </p>
      </main>
    </div>
  );
}

/** The Stay Cape Ann mark (src/components/properties/ScaMark.tsx geometry), inline so the page stays self-contained. */
export function ScaMark({ size = 40, navy = '#0F2A44', sand = '#C8B89A' }: { size?: number; navy?: string; sand?: string }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
      <path d="M16.5 145.3 L183.5 145.3 A95 95 0 0 1 16.5 145.3 Z" fill={navy} />
      <circle cx="100" cy="100" r="95" fill="none" stroke={navy} strokeWidth="5" />
      <path d="M100 47.9 L136.8 79.6 L136.8 110.5 L63.6 110.5 L63.6 79.6 Z" fill={navy} />
      <rect x="39.1" y="114.6" width="121.4" height="4.4" rx="2.2" fill={sand} />
    </svg>
  );
}
