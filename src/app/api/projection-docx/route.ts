import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderProjectionDocx, projectionDocxFilename } from '@/lib/projection-docx';
import type { ProjectionRow } from '@/lib/projections-types';

/**
 * GET /api/projection-docx?id=<projection_id>&type=contract
 *
 * Sibling of /api/projection-pdf but returns an editable Word doc instead
 * of a print-final PDF. Today this only supports type=contract because
 * the contract is the deliverable owners actually negotiate; the deck and
 * partnership guide are sales artifacts whose PDFs are canonical.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

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
    const type = (request.nextUrl.searchParams.get('type') || '') as 'contract';
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (type !== 'contract') {
      return NextResponse.json(
        { error: 'type must be contract (the deck and guide PDFs are canonical).' },
        { status: 400 },
      );
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from('projections')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Prospect not found.' }, { status: 404 });
    }
    const projection = data as ProjectionRow;

    const buf = await renderProjectionDocx({ projection, type });
    const filename = projectionDocxFilename(
      projection.property_address || projection.prospect_name || id,
      type,
    );

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
    console.error('projection-docx error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
