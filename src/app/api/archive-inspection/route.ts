import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderInspectionPdf, inspectionPdfFilename } from '@/lib/inspection-pdf';
import { getProperty } from '@/lib/properties';
import { archiveToDrive } from '@/lib/drive-archive';

/**
 * POST /api/archive-inspection
 * Body: { inspectionId }
 *
 * Renders a completed inspection's report to a PDF and archives it to
 * the Rising Tide shared Drive at:
 *   Helm Records / Inspections / <year> / <property> / <property> - <date> Inspection.pdf
 *
 * Fired fire-and-forget by a client trigger on the inspection summary
 * page once the inspection is completed. Idempotent — if the
 * inspection already has a drive_url, returns it without re-uploading
 * (the trigger fires on every mount of the summary page).
 *
 * Best-effort: render / Drive failures return a non-200 with a reason;
 * the caller treats it as non-fatal. Completing the inspection is never
 * blocked by archival.
 *
 * nodejs runtime + longer maxDuration for the chromium binary, same as
 * the other PDF routes.
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { inspectionId?: string };
    const inspectionId = body.inspectionId;
    if (!inspectionId) {
      return NextResponse.json({ ok: false, error: 'inspectionId is required' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: insp } = await sb
      .from('inspections')
      .select('id, property_id, completed_at, drive_url')
      .eq('id', inspectionId)
      .maybeSingle();
    if (!insp) {
      return NextResponse.json({ ok: false, error: 'inspection not found' }, { status: 404 });
    }
    const inspection = insp as {
      property_id: string;
      completed_at: string | null;
      drive_url: string | null;
    };
    if (!inspection.completed_at) {
      return NextResponse.json({ ok: false, error: 'inspection not completed' }, { status: 400 });
    }
    // Idempotency — the client trigger fires on every summary-page mount.
    if (inspection.drive_url) {
      return NextResponse.json({ ok: true, url: inspection.drive_url, alreadyArchived: true });
    }

    const propertyShort = getProperty(inspection.property_id)?.name || inspection.property_id;
    const year = inspection.completed_at.slice(0, 4);

    const origin = request.nextUrl.origin;
    const pdf = await renderInspectionPdf({ inspectionId, origin });
    const filename = inspectionPdfFilename(propertyShort, inspection.completed_at);

    const archive = await archiveToDrive({
      pdf,
      filename,
      folderPath: ['Inspections', year, propertyShort],
    });
    if (!archive.ok || !archive.url) {
      return NextResponse.json(
        { ok: false, error: archive.reason || 'Drive archive failed' },
        { status: 502 },
      );
    }

    const { error: updateErr } = await sb
      .from('inspections')
      .update({ drive_url: archive.url })
      .eq('id', inspectionId);
    if (updateErr) {
      // PDF is in Drive; only the link-back failed. Report but still
      // return the URL.
      console.error('archive-inspection: inspections update failed', updateErr);
    }

    return NextResponse.json({ ok: true, url: archive.url });
  } catch (err) {
    console.error('archive-inspection error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
