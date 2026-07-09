import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  renderPropertyPdf,
  propertyPdfFilename,
  type PropertyDeliverable,
} from '@/lib/property-pdf';

/**
 * GET /api/property-pdf?id=<property_id>&type=<deliverable>[&noticeId=<uuid>]
 *
 * Renders the requested guest-facing deliverable to a PDF via Puppeteer
 * and streams it back as application/pdf with a friendly filename.
 *
 * For type=notice the caller must also pass &noticeId=<uuid>. We pull the
 * notice's title for the download filename so a folder full of bespoke
 * placards stays legible.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_TYPES: PropertyDeliverable[] = ['home-guide', 'wifi-placard', 'info-note', 'notice', 'welcome-card'];

// Was a hand-rolled client that fell back to the anon key when
// SUPABASE_SERVICE_ROLE_KEY was unset -- reuse the canonical service-role
// singleton instead, so a missing env var fails loudly rather than silently
// downgrading to the (soon to be locked down) anon key.
function getSupabase() {
  return supabaseAdmin;
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const type = (request.nextUrl.searchParams.get('type') || '') as PropertyDeliverable;
    const noticeId = request.nextUrl.searchParams.get('noticeId') || undefined;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }
    if (type === 'notice' && !noticeId) {
      return NextResponse.json({ error: 'noticeId is required when type=notice' }, { status: 400 });
    }

    let propertyName = id;
    let propertyCity = '';
    try {
      const sb = getSupabase();
      const { data } = await sb.from('properties').select('name, city').eq('id', id).maybeSingle();
      if (data?.name) propertyName = data.name as string;
      if (data?.city) propertyCity = data.city as string;
    } catch {
      // best-effort
    }

    // Information Note is Gloucester-only — the doc cites the Gloucester
    // STR ordinance and prints a Gloucester-issued permit ID. For other
    // cities the route 404s; fail this endpoint cleanly so the download
    // button surfaces a useful error instead of "PDF rendering failed".
    if (type === 'info-note') {
      const cityShort = propertyCity.split(',')[0].trim().toLowerCase();
      if (cityShort && cityShort !== 'gloucester') {
        return NextResponse.json(
          { error: 'Information Note is only available for Gloucester properties.' },
          { status: 400 },
        );
      }
    }

    // For bespoke notices, look up the title so the download filename
    // is "21 Horton - Notice - Bathroom fan.pdf" rather than a UUID.
    let noticeTitle: string | undefined;
    if (type === 'notice' && noticeId) {
      try {
        const sb = getSupabase();
        const { data } = await sb
          .from('property_notices')
          .select('title, property_id')
          .eq('id', noticeId)
          .maybeSingle();
        if (!data || data.property_id !== id) {
          return NextResponse.json({ error: 'Notice not found for this property.' }, { status: 404 });
        }
        noticeTitle = data.title as string;
      } catch {
        // best-effort: fall through with no title; the renderer 404 will surface real errors.
      }
    }

    const origin = request.nextUrl.origin;
    const pdf = await renderPropertyPdf({ propertyId: id, type, origin, noticeId });
    const filename = propertyPdfFilename(propertyName, type, noticeTitle);

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
