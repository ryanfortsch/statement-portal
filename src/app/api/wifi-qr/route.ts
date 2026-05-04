import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import sharp from 'sharp';

/**
 * GET /api/wifi-qr?id=<property_id>&format=png|svg
 *
 * A small branded Stay Cape Ann WiFi QR card. 480 × 480 px, cream
 * background, navy QR, network name caption underneath. Designed to
 * drop into emails, stickers, or other docs without the full 4 × 6
 * placard chrome.
 *
 * SVG output is the canonical artifact (vector, scales perfectly).
 * PNG is rasterized from the SVG via sharp at 2× device pixel ratio.
 */

export const runtime = 'nodejs';

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  _sb = createClient(url, key);
  return _sb;
}

function escapeWifi(s: string): string {
  return s.replace(/([\\;,":])/g, '\\$1');
}

/** Encode special chars for SVG text content. */
function svgEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the composed Stay Cape Ann WiFi QR card as an SVG string.
 *
 * Layout (480 × 480):
 *   y=  0  cream rounded square
 *   y= 60  small letter-spaced eyebrow "STAY CAPE ANN · WI-FI"
 *   y=104  QR code, 272 × 272 px, centered
 *   y=400  network name in monospace
 *   y=434  small italic "Scan to connect" hint
 */
async function composeQrSvg(wifiUri: string, ssid: string): Promise<string> {
  // Get the bare QR SVG (no margin so we can position precisely)
  const qrSvg = await QRCode.toString(wifiUri, {
    type: 'svg',
    errorCorrectionLevel: 'Q',
    margin: 0,
    color: { dark: '#0F2A44', light: '#FFFFFF00' },
  });
  // Strip XML declaration so the fragment can be embedded
  const qrInner = qrSvg.replace(/<\?xml[^?]*\?>/, '').trim();

  const W = 480;
  const H = 480;
  const QR_SIZE = 272;
  const QR_X = (W - QR_SIZE) / 2;
  const QR_Y = 104;

  // Note on fonts: SVGs that travel as standalone files can't pull in
  // Fraunces / Inter, so we fall back to system serif / monospace.
  // Looks clean enough; the SCA palette carries the brand.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" rx="18" fill="#F4ECD8"/>
  <text x="${W / 2}" y="60" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="11" letter-spacing="3.6" fill="#0F2A44" font-weight="500">STAY CAPE ANN &#xB7; WI-FI</text>
  <svg x="${QR_X}" y="${QR_Y}" width="${QR_SIZE}" height="${QR_SIZE}">${qrInner}</svg>
  <text x="${W / 2}" y="406" text-anchor="middle"
        font-family="ui-monospace, 'SF Mono', Menlo, monospace"
        font-size="15" fill="#0F2A44" font-weight="500">${svgEscape(ssid)}</text>
  <text x="${W / 2}" y="432" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="11" font-style="italic" fill="#0F2A44" fill-opacity="0.55">Scan to connect</text>
</svg>`;
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const format = (request.nextUrl.searchParams.get('format') || 'png').toLowerCase();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (format !== 'png' && format !== 'svg') {
      return NextResponse.json({ error: 'format must be png or svg' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data } = await sb
      .from('properties')
      .select('name, wifi_name, wifi_password')
      .eq('id', id)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'property not found' }, { status: 404 });

    const ssid = (data.wifi_name as string) || '';
    const pass = (data.wifi_password as string) || '';
    if (!ssid || !pass) {
      return NextResponse.json(
        { error: 'property is missing wifi_name or wifi_password' },
        { status: 400 },
      );
    }

    const wifiUri = `WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(pass)};H:false;;`;
    const propertyName = (data.name as string) || id;
    const safeName = propertyName.replace(/[\\/:*?"<>|]/g, '').trim();
    const filename = `${safeName} - WiFi QR.${format}`;

    const composedSvg = await composeQrSvg(wifiUri, ssid);

    if (format === 'svg') {
      return new NextResponse(composedSvg, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    // PNG: rasterize the SVG at 2× scale (960 × 960) for crisp prints
    // and email-friendly sharpness; viewer apps can scale down without
    // softening.
    const png = await sharp(Buffer.from(composedSvg))
      .resize(960, 960)
      .png({ compressionLevel: 9 })
      .toBuffer();

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('wifi-qr error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
