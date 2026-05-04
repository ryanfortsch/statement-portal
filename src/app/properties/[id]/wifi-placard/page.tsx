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
            <div className="rt-icon" aria-hidden="true">
              <svg viewBox="0 0 64 64" width="56" height="56">
                <path d="M32 50.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" fill="#0a3a64" />
                <path d="M21 39.5c3-3 7-4.6 11-4.6s8 1.6 11 4.6" stroke="#0a3a64" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <path d="M14 32.4c4.8-4.8 11.2-7.4 18-7.4s13.2 2.6 18 7.4" stroke="#0a3a64" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <path d="M7 25.4C13.7 18.6 22.6 15 32 15s18.3 3.6 25 10.4" stroke="#0a3a64" strokeWidth="3.5" strokeLinecap="round" fill="none" />
              </svg>
            </div>
            <h1 className="rt-title">WIFI</h1>

            {/* QR — scannable to auto-connect */}
            <div className="rt-qr">
              {qrSvg ? (
                <span dangerouslySetInnerHTML={{ __html: qrSvg }} />
              ) : (
                <div className="rt-qr-empty">
                  Add WiFi name + password to this property to generate the QR code.
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

          {/* Tag at the very bottom of the card (over the blue band) */}
          <div className="rt-tag">@stay_collections</div>
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
    background: #2152a8;
    border-radius: 14px;
    padding: 14px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  }
  @media print {
    html, body { background: white; }
    .rt-doc { background: white; padding: 0; min-height: 0; display: block; }
    .rt-card { box-shadow: none; }
  }

  /* Inner white panel */
  .rt-panel {
    flex: 1;
    background: #ffffff;
    border-radius: 8px;
    padding: 20px 22px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: #0a3a64;
  }
  .rt-icon { margin-top: 4px; }
  .rt-title {
    margin: 6px 0 0;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 56px;
    font-weight: 400;
    letter-spacing: 0.04em;
    color: #0a3a64;
    line-height: 1;
  }
  .rt-qr {
    margin-top: 18px;
    width: 200px;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rt-qr svg { width: 100%; height: 100%; }
  .rt-qr-empty {
    border: 1px dashed #0a3a64;
    color: #0a3a64;
    font-size: 11px;
    text-align: center;
    padding: 22px 14px;
    line-height: 1.4;
    font-style: italic;
  }

  /* Network / password fields */
  .rt-field { width: 100%; margin-top: 16px; position: relative; }
  .rt-field-label {
    position: absolute;
    top: -7px;
    left: 18px;
    background: #ffffff;
    padding: 0 8px;
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: #0a3a64;
    font-weight: 500;
  }
  .rt-field-box {
    border: 1px solid #0a3a64;
    border-radius: 2px;
    padding: 12px 14px;
    min-height: 14px;
    font-size: 14px;
    color: #0a3a64;
    text-align: center;
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    overflow-wrap: break-word;
    word-break: break-all;
    line-height: 1.3;
  }

  /* Bottom tag (over the blue band of the card) */
  .rt-tag {
    color: #ffffff;
    text-align: center;
    font-size: 12px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    font-weight: 500;
    padding: 8px 0 6px;
    font-family: var(--font-mono-dash), ui-monospace, monospace;
  }
`;
