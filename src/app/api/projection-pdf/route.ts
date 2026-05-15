import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  renderProjectionPdf,
  projectionPdfFilename,
  type DeliverableType,
} from '@/lib/projection-pdf';

/**
 * GET /api/projection-pdf?id=<projection_uuid>&type=projection|guide|contract
 *
 * Renders the requested deliverable to a PDF and streams it back as
 * application/pdf with a friendly filename. Used by the "Download PDF"
 * buttons on /projections/<id>.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_TYPES: DeliverableType[] = ['projection', 'guide', 'contract', 'readiness'];

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
    const type = (request.nextUrl.searchParams.get('type') || 'projection') as DeliverableType;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    // Look up the property address for the filename.
    let propertyAddress = 'Prospect';
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from('projections')
        .select('property_address')
        .eq('id', id)
        .maybeSingle();
      if (data?.property_address) propertyAddress = data.property_address as string;
    } catch {
      // Filename lookup is best-effort; PDF rendering still works.
    }

    const origin = request.nextUrl.origin;
    const pdf = await renderProjectionPdf({ projectionId: id, type, origin });
    const filename = projectionPdfFilename(propertyAddress, type);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('projection-pdf error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
