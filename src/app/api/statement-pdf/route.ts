import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderStatementPdf, statementPdfFilename } from '@/lib/pdf';
import { getProperty } from '@/lib/properties';

/**
 * GET /api/statement-pdf?id=<property_statement_id>&month=YYYY-MM
 *
 * Renders the HTML statement to a PDF (same pipeline that powers the
 * Gmail-draft attachment) and streams it back as application/pdf with
 * a friendly filename. Use this from a dashboard "Download PDF" link
 * or any other place that wants the statement as a PDF file directly.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

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
    const month = request.nextUrl.searchParams.get('month');
    if (!id || !month) {
      return NextResponse.json({ error: 'id and month are required' }, { status: 400 });
    }

    // Prefer the short PROPERTIES name ("21 Horton St") for the filename,
    // fall back to whatever property_statements has if that lookup fails.
    let propertyShort: string | null = null;
    try {
      const sb = getSupabase();
      const { data } = await sb.from('property_statements').select('property_id, property_name').eq('id', id).maybeSingle();
      if (data) {
        propertyShort = getProperty(data.property_id)?.name || data.property_name;
      }
    } catch {}
    if (!propertyShort) propertyShort = 'Statement';

    const origin = request.nextUrl.origin;
    const pdf = await renderStatementPdf({ statementId: id, month, origin });
    const filename = statementPdfFilename(propertyShort, month);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('statement-pdf error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
