import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import { civicForProperty } from '@/lib/civic';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

/**
 * Stay Cape Ann "Welcome Home" guide. One US Letter page, portrait,
 * print-ready. Pre-populates from the operational columns on the property
 * record (wifi_name, wifi_password, parking, heating, cooling, smart-lock
 * details, emergency contact, etc.) which came from the prospect's
 * onboarding intake when the property was promoted.
 *
 * Anything that is not in the DB falls back to a neutral default so the guide
 * still reads cleanly even if the prospect skipped a field.
 */
export default async function HomeGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const stayName = p.title || `Stay at ${p.name}`;
  const cityShort = (p.city || '').split(',')[0] || 'Cape Ann';
  const civic = civicForProperty(p);

  return (
    <>
      <style>{guideCss}</style>
      <div className="rt-doc">
        <article className="rt-page">
          {/* Top: SCA logo mark + display headline */}
          <header className="rt-head">
            <div className="rt-mark-wrap">
              <ScaMark />
              <div className="rt-mark-line">Stay Cape Ann</div>
            </div>
            <h1 className="rt-display">
              Welcome <em>home.</em>
            </h1>
            <p className="rt-tag">
              We&rsquo;re glad you&rsquo;re here at{' '}
              <strong>{stayName}</strong>
              {p.address ? `. ${p.address}, ${cityShort}.` : '.'}
            </p>
          </header>

          {/* Six-cell grid of essential info */}
          <div className="rt-grid">
            <Cell num="01" title="Wi-Fi">
              {p.wifi_name || p.wifi_password ? (
                <>
                  {p.wifi_name && (
                    <p>
                      <span className="rt-k">Network</span>
                      <span className="rt-v rt-mono">{p.wifi_name}</span>
                    </p>
                  )}
                  {p.wifi_password && (
                    <p>
                      <span className="rt-k">Password</span>
                      <span className="rt-v rt-mono">{p.wifi_password}</span>
                    </p>
                  )}
                  <p className="rt-aside">A scannable QR code is posted near the entry.</p>
                </>
              ) : (
                <p className="rt-aside">See the placard near the entry for network and password.</p>
              )}
            </Cell>

            <Cell num="02" title="Climate">
              <p>
                {p.heating || p.cooling ? (
                  <>
                    Heat: {humanize(p.heating) || 'central'}.{' '}
                    Cool: {humanize(p.cooling) || 'central'}.
                  </>
                ) : (
                  'Thermostats control each floor independently.'
                )}
              </p>
              <p className="rt-aside">
                All thermostats must be set to the same mode (heat / cool) to function correctly.
              </p>
            </Cell>

            <Cell num="03" title="Bathrooms">
              <p>
                Use the bathroom fan while showering — the button may not depress, but the fan
                still runs and shuts off automatically.
              </p>
              <p className="rt-aside">
                Please limit any flushed items to toilet paper.
              </p>
            </Cell>

            <Cell num="04" title="Parking">
              <p>{p.parking ? humanize(p.parking) : civic.parking}</p>
              <p className="rt-aside">
                Please keep shared driveway access clear.
              </p>
            </Cell>

            <Cell num="05" title="Kitchen">
              <p><strong>Coffee.</strong> Fill the water tank, insert a pod, choose your size, brew.</p>
              <p><strong>Cooktop.</strong> Slide out the hood to operate the fan; use only the pans we&rsquo;ve provided on the burners.</p>
              <p className="rt-aside">
                Counter tops stain easily — please blot dark drinks and oils right away.
              </p>
            </Cell>

            <Cell num="06" title="Trash & Recycling">
              <p>
                Indoor bins are in the kitchen. When full, empty into the outdoor bins behind
                the home.
                {civic.trashDay
                  ? ` Pickup is on ${civic.trashDay}${civic.recyclingDay && civic.recyclingDay !== civic.trashDay ? ` (recycling on ${civic.recyclingDay})` : ''}.`
                  : ' Pickup runs weekly.'}
              </p>
              <p className="rt-aside">No need to take bins to the curb on departure.</p>
            </Cell>
          </div>

          {/* Bottom — hassle-free departure + signoff */}
          <footer className="rt-foot">
            <div className="rt-foot-rule" />
            <div className="rt-foot-message">
              <h2 className="rt-foot-h">Hassle-free departure.</h2>
              <p>No chores required. Just lock the door and travel safely.</p>
            </div>
            <div className="rt-foot-mark">
              <ScaMark size={32} />
              <div className="rt-foot-domain">staycapeann.com</div>
            </div>
            {p.address && (
              <div className="rt-mark-sub">
                {stayName} &middot; {p.address}{p.city ? `, ${p.city}` : ''}
              </div>
            )}
          </footer>
        </article>
      </div>
    </>
  );
}

function Cell({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="rt-cell">
      <div className="rt-cell-head">
        <span className="rt-cell-num">{num}</span>
        <h3 className="rt-cell-title">{title}</h3>
      </div>
      <div className="rt-cell-body">{children}</div>
    </section>
  );
}

/** Lower-cases an enum-y value for inline prose (e.g. "Central A/C" -> "central a/c"). */
function humanize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Stay Cape Ann logo mark (cream circle dropped, just the navy house +
 * tan sun + horizon + water band). Sits naturally on the cream guide
 * page without the outer ring fighting the background.
 *
 * Source of truth: /Users/maguire/Developer/stay-cape-ann/app/icon.svg
 */
function ScaMark({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
      <circle cx="100" cy="82" r="28" fill="#B89B6E" />
      <path d="M100 48 L138 82 L138 112 L62 112 L62 82 Z" fill="#0F2A44" />
      <line x1="40" y1="118" x2="160" y2="118" stroke="#B89B6E" strokeWidth="5" />
      <path d="M18 145 L182 145 A95 95 0 0 1 18 145 Z" fill="#0F2A44" />
    </svg>
  );
}

const guideCss = `
  /* Stay Cape Ann brand palette pulled directly from the consumer site
     (tailwind.config.ts in /Users/maguire/Developer/stay-cape-ann). */
  :root {
    --sca-navy: #0F2A44;
    --sca-cream: #F4ECD8;
    --sca-tan: #B89B6E;
    --sca-fog: #8A9AA6;
  }

  @page { size: 8.5in 11in; margin: 0; }
  html, body { background: #0e1a1f; margin: 0; padding: 0; }
  .rt-doc {
    display: flex;
    justify-content: center;
    padding: 24px 0;
    background: #0e1a1f;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-page {
    width: 816px;
    height: 1056px;
    background: var(--sca-cream);
    color: var(--sca-navy);
    padding: 64px 64px 56px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
  }
  @media print {
    html, body { background: var(--sca-cream); }
    .rt-doc { background: var(--sca-cream); padding: 0; display: block; }
    .rt-page { box-shadow: none; }
  }

  /* Header */
  .rt-head { padding-bottom: 28px; border-bottom: 1px solid var(--sca-navy); }
  .rt-mark-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .rt-mark-line {
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 14px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--sca-navy);
    font-weight: 500;
  }
  .rt-display {
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 56px;
    line-height: 1;
    font-weight: 300;
    color: var(--sca-navy);
    letter-spacing: -0.025em;
    margin: 18px 0 0;
  }
  .rt-display em { font-style: italic; font-weight: 400; }
  .rt-tag {
    margin: 16px 0 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--sca-navy);
    opacity: 0.75;
    max-width: 600px;
  }
  .rt-tag strong {
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-weight: 400;
    color: var(--sca-navy);
    opacity: 1;
    font-size: 15px;
  }

  /* Six-cell info grid */
  .rt-grid {
    margin-top: 32px;
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 36px;
    row-gap: 24px;
    align-content: start;
  }
  .rt-cell {
    display: flex;
    flex-direction: column;
    border-top: 1.5px solid var(--sca-navy);
    padding-top: 12px;
  }
  .rt-cell-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }
  .rt-cell-num {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 10px;
    color: var(--sca-tan);
    letter-spacing: 0.08em;
    font-weight: 600;
  }
  .rt-cell-title {
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--sca-navy);
    margin: 0;
  }
  .rt-cell-body { font-size: 11.5px; line-height: 1.55; color: var(--sca-navy); }
  .rt-cell-body p { margin: 0 0 6px; }
  .rt-cell-body p:last-child { margin-bottom: 0; }
  .rt-aside { color: var(--sca-navy); opacity: 0.65; font-size: 10.5px; font-style: italic; }

  /* Wi-Fi key/value rows */
  .rt-k {
    display: inline-block;
    width: 70px;
    font-size: 9.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--sca-navy);
    opacity: 0.65;
    font-weight: 600;
  }
  .rt-v { color: var(--sca-navy); }
  .rt-mono {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11.5px;
    color: var(--sca-navy);
    background: rgba(15, 42, 68, 0.06);
    padding: 1px 6px;
    border-radius: 2px;
  }

  /* Footer */
  .rt-foot { margin-top: 32px; }
  .rt-foot-rule { height: 1.5px; background: var(--sca-navy); margin-bottom: 22px; }
  .rt-foot-message { text-align: center; }
  .rt-foot-h {
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 24px;
    line-height: 1.1;
    font-weight: 400;
    color: var(--sca-navy);
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  .rt-foot-message p {
    margin: 0;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 13px;
    color: var(--sca-navy);
    opacity: 0.7;
  }
  .rt-foot-mark {
    margin-top: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .rt-foot-domain {
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--sca-navy);
  }
  .rt-mark-sub {
    margin-top: 8px;
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--sca-navy);
    opacity: 0.55;
    font-weight: 500;
  }
`;
