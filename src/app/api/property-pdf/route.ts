import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  renderPropertyPdf,
  propertyPdfFilename,
  type PropertyDeliverable,
} from '@/lib/property-pdf';

/**
 * GET /api/property-pdf?id=<property_id>&type=home-guide|wifi-placard
 *
 * Renders the requested guest-facing deliverable to a PDF via Puppeteer
 * and streams it back as application/pdf with a friendly filename.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_TYPES: PropertyDeliverable[] = ['home-guide', 'wifi-placard'];

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  _sb = createClient(url, key);
  return _sb;
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const type = (request.nextUrl.searchParams.get('type') || '') as PropertyDeliverable;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    let propertyName = id;
    try {
      const sb = getSupabase();
      const { data } = await sb.from('properties').select('name').eq('id', id).maybeSingle();
      if (data?.name) propertyName = data.name as string;
    } catch {
      // best-effort
    }

    const origin = request.nextUrl.origin;
    const pdf = await renderPropertyPdf({ propertyId: id, type, origin });
    const filename = propertyPdfFilename(propertyName, type);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('property-pdf error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
