import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderPropertyDocx, propertyDocxFilename } from '@/lib/property-docx';
import type { PropertyDeliverable } from '@/lib/property-pdf';
import type { HelmPropertyRow } from '@/lib/properties';

/**
 * GET /api/property-docx?id=<property_id>&type=<deliverable>
 *
 * Mirror of /api/property-pdf, but returns an editable .docx instead of a
 * print-final PDF. Staff use this when a deliverable needs a tweak before
 * printing — different SSID for a one-night owner stay, custom owner-name
 * change between turnovers, last-minute parking note, etc.
 *
 * Bespoke notices (type=notice) intentionally aren't supported here — they
 * already have a native in-Helm editor at /properties/<id>/notices/...
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const VALID_TYPES: PropertyDeliverable[] = [
  'home-guide',
  'wifi-placard',
  'info-note',
  'welcome-card',
];

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
      return NextResponse.json(
        { error: `type must be one of ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const sb = getSupabase();
    const { data: row, error } = await sb
      .from('properties')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
    }
    const property = row as HelmPropertyRow;

    // Info Note is Gloucester-only — mirror the PDF endpoint's gate so the
    // download button surfaces a useful error rather than silently producing
    // a misleading doc.
    if (type === 'info-note') {
      const cityShort = (property.city || '').split(',')[0].trim().toLowerCase();
      if (cityShort && cityShort !== 'gloucester') {
        return NextResponse.json(
          { error: 'Information Note is only available for Gloucester properties.' },
          { status: 400 },
        );
      }
    }

    const buf = await renderPropertyDocx({ property, type });
    const filename = propertyDocxFilename(property.name || id, type);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('property-docx error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
