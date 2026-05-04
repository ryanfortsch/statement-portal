import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

/**
 * GET /api/wifi-qr?id=<property_id>&format=png|svg
 *
 * Standalone WiFi QR code as a downloadable image. The QR encodes the
 * standard WIFI: URI so iOS Camera and the Android scanner offer to
 * auto-join the network. Useful for stickers, emails, and dropping the
 * QR into other docs without the full placard layout.
 *
 * Default format is PNG (works in email clients, photo editors, etc).
 * Pass &format=svg for vector output.
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

    if (format === 'svg') {
      const svg = await QRCode.toString(wifiUri, {
        type: 'svg',
        errorCorrectionLevel: 'Q',
        margin: 1,
        color: { dark: '#0F2A44', light: '#FFFFFF' },
      });
      return new NextResponse(svg, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    // PNG: render at 1024 px so it's crisp for stickers and prints.
    const buf = await QRCode.toBuffer(wifiUri, {
      type: 'png',
      errorCorrectionLevel: 'Q',
      margin: 2,
      width: 1024,
      color: { dark: '#0F2A44', light: '#F4ECD8' },
    });
    return new NextResponse(new Uint8Array(buf), {
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
