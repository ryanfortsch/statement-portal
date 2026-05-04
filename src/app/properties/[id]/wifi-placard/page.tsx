import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

/**
 * Stay Collections WiFi placard — a 4 × 6 inch printout with a scannable
 * QR code, network name, and password. Slips into the glass case at the
 * property.
 *
 * QR encoding follows the well-known WIFI: URI format used by both iOS
 * Camera and the Android scanner — when scanned the phone offers to
 * auto-join the network.
 */
export default async function WifiPlacardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // Build the WIFI URI. Default to WPA2 (T:WPA). Escape backslashes,
  // semicolons, commas, colons, and double quotes per spec.
  const ssid = p.wifi_name || '';
  const pass = p.wifi_password || '';
  const wifiUri = `WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(pass)};H:false;;`;

  // Render the QR as an inline SVG string. ECC level Q gives a good
  // balance between size and resilience to print scuffs.
  const qrSvg = ssid && pass
    ? await QRCode.toString(wifiUri, {
        type: 'svg',
        errorCorrectionLevel: 'Q',
        margin: 0,
        color: { dark: '#0a3a64', light: '#FFFFFF00' },
      })
    : '';

  return (
    <>
      <style>{placardCss}</style>
      <div className="rt-doc">
        <article className="rt-card">
          {/* Inner white panel */}
          <div className="rt-panel">
            {/* Wi-Fi signal glyph + title */}
            <div className="rt-glyph" aria-hidden="true">
              <svg viewBox="0 0 80 56" width="64" height="44">
                <path d="M40 46a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" fill="#0e3a6e" />
                <path d="M28 36c3.4-3.4 7.6-5.1 12-5.1S48.6 32.6 52 36" stroke="#0e3a6e" strokeWidth="4" strokeLinecap="round" fill="none" />
                <path d="M19 27.6c5.7-5.7 13.2-8.6 21-8.6s15.3 2.9 21 8.6" stroke="#0e3a6e" strokeWidth="4" strokeLinecap="round" fill="none" />
                <path d="M10 19.2C18.1 11.1 28.7 7 40 7s21.9 4.1 30 12.2" stroke="#0e3a6e" strokeWidth="4" strokeLinecap="round" fill="none" />
              </svg>
            </div>
            <h1 className="rt-title">Wi-Fi</h1>
            <div className="rt-rule" />

            {/* QR — scannable to auto-connect */}
            <div className="rt-qr">
              {qrSvg ? (
                <span dangerouslySetInnerHTML={{ __html: qrSvg }} />
              ) : (
                <div className="rt-qr-empty">
                  <div className="rt-qr-empty-h">QR not generated</div>
                  <div>Add a Wi-Fi name and password<br />to this property in Helm.</div>
                </div>
              )}
            </div>

            {/* Network */}
            <div className="rt-field">
              <div className="rt-field-label">Network</div>
              <div className="rt-field-box">{ssid || ' '}</div>
            </div>

            {/* Password */}
            <div className="rt-field">
              <div className="rt-field-label">Password</div>
              <div className="rt-field-box">{pass || ' '}</div>
            </div>
          </div>

          {/* Stay Cape Ann domain footer (over the navy band) */}
          <div className="rt-tag">staycapeann.com</div>
        </article>
      </div>
    </>
  );
}

/** Escape per the WIFI: URI spec. */
function escapeWifi(s: string): string {
  return s.replace(/([\\;,":])/g, '\\$1');
}

const placardCss = `
  /* 4 × 6 inch placard, portrait */
  @page { size: 4in 6in; margin: 0; }
  html, body { background: #0e1a1f; margin: 0; padding: 0; }

  /* Brand palette — Stay Cape Ann navy, deeper than the previous bright blue */
  :root {
    --sca-navy: #0e3a6e;
    --sca-ink: #0e3a6e;
    --sca-paper: #ffffff;
  }

  .rt-doc {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 24px;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-card {
    /* 4in × 6in @ 96dpi = 384 × 576 px */
    width: 384px;
    height: 576px;
    background: var(--sca-navy);
    border-radius: 12px;
    padding: 12px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    box-shadow: 0 18px 48px rgba(0,0,0,0.32);
  }
  @media print {
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    .rt-card { box-shadow: none; }
  }

  /* Inner white panel */
  .rt-panel {
    flex: 1;
    background: var(--sca-paper);
    border-radius: 6px;
    padding: 22px 24px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: var(--sca-ink);
    text-align: center;
  }
  .rt-glyph { margin-top: 2px; line-height: 0; }
  .rt-title {
    margin: 4px 0 0;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 38px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--sca-ink);
    line-height: 1;
  }
  .rt-rule {
    width: 36px;
    height: 1.5px;
    background: var(--sca-ink);
    margin: 12px 0 4px;
    opacity: 0.7;
  }
  .rt-qr {
    margin-top: 14px;
    width: 200px;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rt-qr svg { width: 100%; height: 100%; }
  .rt-qr-empty {
    color: var(--sca-ink);
    text-align: center;
    padding: 0 12px;
    font-size: 11px;
    line-height: 1.55;
    font-style: italic;
    opacity: 0.65;
  }
  .rt-qr-empty-h {
    font-style: normal;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 14px;
    margin-bottom: 6px;
    opacity: 0.85;
  }

  /* Network / password fields — fieldset-style label that hangs over the box edge */
  .rt-field { width: 100%; margin-top: 14px; position: relative; }
  .rt-field-label {
    position: absolute;
    top: -7px;
    left: 16px;
    background: var(--sca-paper);
    padding: 0 8px;
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--sca-ink);
    font-weight: 600;
  }
  .rt-field-box {
    border: 1px solid var(--sca-ink);
    border-radius: 3px;
    padding: 13px 14px 11px;
    min-height: 14px;
    font-size: 14px;
    color: var(--sca-ink);
    text-align: center;
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    overflow-wrap: break-word;
    word-break: break-all;
    line-height: 1.2;
  }

  /* Bottom tag (over the navy band of the card) — staycapeann.com */
  .rt-tag {
    color: var(--sca-paper);
    text-align: center;
    font-size: 12px;
    letter-spacing: 0.18em;
    font-weight: 500;
    padding: 10px 0 6px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    opacity: 0.95;
  }
`;
