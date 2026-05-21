import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderStatementPdf, statementPdfFilename } from '@/lib/pdf';
import { getProperty } from '@/lib/properties';
import { archiveToDrive } from '@/lib/drive-archive';

/**
 * POST /api/archive-statement
 * Body: { statementId, month, periodId, propertyId }
 *
 * Renders the monthly owner statement to a PDF and archives it to the
 * Rising Tide shared Drive at:
 *   Helm Records / Statements / <year> / <MM Month> / <property> - <Month Year>.pdf
 *
 * Called fire-and-forget from the Statements close-out panel when the
 * operator ticks "Statement sent". On success, stamps the Drive
 * webViewLink onto close_tasks.statement_drive_url so the panel can
 * link straight to the archived copy.
 *
 * Best-effort: a render or Drive failure returns a non-200 with a
 * reason, but the caller treats it as non-fatal — the "Statement sent"
 * checkbox is already persisted client-side independently of this.
 *
 * Mirrors /api/statement-pdf's runtime config — the chromium binary
 * needs the nodejs runtime and a longer maxDuration than the default.
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-04" → { year: "2026", folder: "04 April" } for the Drive path. */
function monthParts(month: string): { year: string; folder: string } {
  const [y, m] = month.split('-');
  const idx = Math.max(0, Math.min(11, Number(m) - 1));
  return { year: y, folder: `${m} ${MONTH_NAMES[idx]}` };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      statementId?: string;
      month?: string;
      periodId?: string;
      propertyId?: string;
    };
    const { statementId, month, periodId, propertyId } = body;
    if (!statementId || !month || !periodId || !propertyId) {
      return NextResponse.json(
        { ok: false, error: 'statementId, month, periodId, propertyId are all required' },
        { status: 400 },
      );
    }

    // Property short name ("21 Horton") for the filename, same lookup
    // pattern as /api/statement-pdf.
    let propertyShort = 'Statement';
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from('property_statements')
        .select('property_id, property_name')
        .eq('id', statementId)
        .maybeSingle();
      if (data) propertyShort = getProperty(data.property_id)?.name || data.property_name || propertyShort;
    } catch {
      // Filename lookup is best-effort; the archive still works.
    }

    const origin = request.nextUrl.origin;
    const pdf = await renderStatementPdf({ statementId, month, origin });
    const filename = statementPdfFilename(propertyShort, month);
    const { year, folder } = monthParts(month);

    const archive = await archiveToDrive({
      pdf,
      filename,
      folderPath: ['Statements', year, folder],
    });
    if (!archive.ok || !archive.url) {
      return NextResponse.json(
        { ok: false, error: archive.reason || 'Drive archive failed' },
        { status: 502 },
      );
    }

    // Stamp the Drive link onto the existing close_tasks row. Targeted
    // UPDATE (not upsert) — the row already exists because the operator
    // just ticked "Statement sent", and an upsert of a partial row
    // would null the other close-task columns.
    const sb = getSupabase();
    const { error: updateErr } = await sb
      .from('close_tasks')
      .update({ statement_drive_url: archive.url })
      .eq('period_id', periodId)
      .eq('property_id', propertyId);
    if (updateErr) {
      // The PDF is in Drive; only the link-back failed. Report it but
      // still return the URL so the caller can show the link.
      console.error('archive-statement: close_tasks update failed', updateErr);
    }

    return NextResponse.json({ ok: true, url: archive.url });
  } catch (err) {
    console.error('archive-statement error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
