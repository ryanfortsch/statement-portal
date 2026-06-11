import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import { renderQrForPlacard } from '@/lib/qr-sizing';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

/**
 * Stay Cape Ann WiFi placard. A 4 x 6 inch printout with a scannable QR
 * code, network name, and password. Slips into the glass case at the
 * property.
 *
 * Brand palette pulled directly from the Stay Cape Ann logo: navy #0F2A44
 * on a cream #F4ECD8 ground, with a tan #B89B6E sun accent. Logo mark
 * inlined at the top so the whole card reads as Stay Cape Ann at a glance.
 *
 * QR encoding follows the WIFI: URI format used by both iOS Camera and
 * the Android scanner. When scanned, the phone offers to auto-join the
 * network.
 */
export default async function WifiPlacardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // One placard per network. Two-unit homes (main house + boat house on
  // separate routers) get two cards — each prints on its own 4×6 page so
  // one goes in each unit's glass case. Single-network homes render the
  // one card exactly as before.
  const networks: Array<{ ssid: string; pass: string; label: string | null }> = [
    { ssid: p.wifi_name || '', pass: p.wifi_password || '', label: p.wifi_label },
  ];
  if (p.wifi_name_2 || p.wifi_password_2) {
    networks.push({ ssid: p.wifi_name_2 || '', pass: p.wifi_password_2 || '', label: p.wifi_label_2 });
  }

  // QR rendered onto cream so it prints with no transparency artifacts.
  // ECC level Q balances density against resilience to scuffs in a printed
  // glass-case context. Size scales with module count via renderQrForPlacard
  // so a longer SSID (which forces a denser QR symbol) doesn't push the
  // module size below the ~1.0mm consumer-printer reproduction floor —
  // see lib/qr-sizing.ts for the full geometry argument.
  const cards = await Promise.all(
    networks.map(async (n) => {
      const wifiUri = `WIFI:T:WPA;S:${escapeWifi(n.ssid)};P:${escapeWifi(n.pass)};H:false;;`;
      const qr = n.ssid && n.pass
        ? await renderQrForPlacard({
            uri: wifiUri,
            errorCorrectionLevel: 'Q',
            color: { dark: '#0F2A44', light: '#F4ECD8' },
            floorPx: 140,
          })
        : null;
      return { ...n, qrSvg: qr?.svg ?? '', qrSize: qr?.sizePx ?? 140 };
    }),
  );

  return (
    <>
      <style>{placardCss}</style>
      <div className="rt-doc">
        {cards.map((card, i) => (
          <article className="rt-card" key={i}>
            {/* Cream inner panel */}
            <div className="rt-panel">
              <ScaMark />

              <div className="rt-eyebrow">Wi-Fi</div>
              {/* Unit label distinguishes the two cards of a two-network
                  home ("Main House" / "Boat House"). Hidden when unset. */}
              {card.label && <div className="rt-unit">{card.label}</div>}

              <div className="rt-qr" style={{ width: card.qrSize, height: card.qrSize }}>
                {card.qrSvg ? (
                  <span dangerouslySetInnerHTML={{ __html: card.qrSvg }} />
                ) : (
                  <div className="rt-qr-empty">
                    <div className="rt-qr-empty-h">Add a Wi-Fi name and password</div>
                    <div>to this property in Helm to render the QR.</div>
                  </div>
                )}
              </div>

              {/* Network + password as stacked editorial rows, not boxed inputs */}
              <dl className="rt-fields">
                <div className="rt-row">
                  <dt>Network</dt>
                  <dd>{card.ssid || ' '}</dd>
                </div>
                <div className="rt-row">
                  <dt>Password</dt>
                  <dd>{card.pass || ' '}</dd>
                </div>
              </dl>
            </div>

            {/* Navy footer band */}
            <div className="rt-footer">staycapeann.com</div>
          </article>
        ))}
      </div>
    </>
  );
}

/**
 * Inlined Stay Cape Ann logo mark — simplified version of the full logo
 * (cream circle, tan sun, navy house, horizon line, navy water band).
 * Source of truth: /Users/maguire/Developer/stay-cape-ann/app/icon.svg.
 * Sits on the cream panel without a stroke ring so it reads as a quiet
 * brand stamp rather than a logo lockup.
 */
function ScaMark() {
  return (
    <div className="rt-mark" aria-hidden="true">
      <svg viewBox="0 0 200 200" width="48" height="48">
        <circle cx="100" cy="82" r="28" fill="#B89B6E" />
        <path d="M100 48 L138 82 L138 112 L62 112 L62 82 Z" fill="#0F2A44" />
        <line x1="40" y1="118" x2="160" y2="118" stroke="#B89B6E" strokeWidth="5" />
        <path d="M18 145 L182 145 A95 95 0 0 1 18 145 Z" fill="#0F2A44" />
      </svg>
    </div>
  );
}

function escapeWifi(s: string): string {
  return s.replace(/([\\;,":])/g, '\\$1');
}

const placardCss = `
  /* 4 x 6 inch placard, portrait. */
  @page { size: 4in 6in; margin: 0; }
  html, body { background: #0e1a1f; margin: 0; padding: 0; }

  :root {
    --sca-navy: #0F2A44;
    --sca-cream: #F4ECD8;
    --sca-tan: #B89B6E;
    --sca-fog: #8A9AA6;
  }

  .rt-doc {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    gap: 32px;
    min-height: 100vh;
    padding: 24px;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  /* 4in × 6in @ 96dpi = 384 × 576 px. Outer navy padding is intentionally
     generous (36px ≈ 0.375") so consumer printers that crop ~0.125" of
     bleed still leave a visibly substantial navy frame on the printed
     card. At 20px the frame survived bleed as a hairline. */
  .rt-card {
    width: 384px;
    height: 576px;
    background: var(--sca-navy);
    padding: 36px 36px 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  }
  @media print {
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    /* One placard per 4x6 page. Two-network homes print two pages, one
       card per unit's glass case. */
    .rt-card { box-shadow: none; page-break-after: always; }
    .rt-card:last-child { page-break-after: auto; }
  }

  /* Cream inner panel */
  .rt-panel {
    flex: 1;
    background: var(--sca-cream);
    padding: 28px 28px 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--sca-navy);
  }

  .rt-mark { line-height: 0; margin-top: 4px; }

  .rt-eyebrow {
    margin-top: 14px;
    font-family: var(--font-fraunces), Georgia, "Times New Roman", serif;
    font-size: 28px;
    line-height: 1;
    font-weight: 400;
    color: var(--sca-navy);
    letter-spacing: -0.01em;
  }

  /* Unit label under the Wi-Fi headline on two-network homes. Small
     caps in tan so it reads as a quiet qualifier, not a second title. */
  .rt-unit {
    margin-top: 8px;
    font-size: 10px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--sca-tan);
  }

  /* QR — square, no chrome, sits naturally on the cream. Width and
     height come from inline style (set by renderQrForPlacard so the
     module size stays ≥ ~1.06mm at 4×6 print regardless of how dense
     the WIFI: URI's QR symbol turns out to be — see lib/qr-sizing.ts). */
  .rt-qr {
    margin-top: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rt-qr svg { width: 100%; height: 100%; }
  .rt-qr-empty {
    color: var(--sca-navy);
    text-align: center;
    padding: 0 12px;
    font-size: 11px;
    line-height: 1.55;
    font-style: italic;
    opacity: 0.65;
  }
  .rt-qr-empty-h {
    font-style: normal;
    font-family: var(--font-fraunces), Georgia, serif;
    font-size: 14px;
    margin-bottom: 6px;
    opacity: 0.85;
  }

  /* Network + password fields — editorial stacked rows divided by a
     hairline rule. Cleaner and more on-brand than fieldset-style boxes. */
  .rt-fields {
    margin: 30px 0 0;
    padding: 0;
    width: 100%;
    border-top: 1px solid var(--sca-navy);
  }
  .rt-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid var(--sca-navy);
    gap: 4px;
  }
  .rt-row dt {
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--sca-navy);
    font-weight: 600;
    opacity: 0.7;
    margin: 0;
  }
  .rt-row dd {
    margin: 0;
    font-family: var(--font-mono-dash), ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 14px;
    color: var(--sca-navy);
    word-break: break-all;
    overflow-wrap: break-word;
    line-height: 1.2;
  }

  /* Navy footer band — staycapeann.com. Bottom padding deliberately
     generous (22px) so the wordmark sits well inside the bleed-safe
     zone on a printed card. */
  .rt-footer {
    color: var(--sca-cream);
    text-align: center;
    font-family: var(--font-fraunces), Georgia, serif;
    font-style: italic;
    font-size: 13px;
    letter-spacing: 0.04em;
    padding: 18px 0 22px;
  }
`;
