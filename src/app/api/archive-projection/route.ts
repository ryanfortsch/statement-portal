import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { renderProjectionPdf } from '@/lib/projection-pdf';
import { archiveProposalToDrive, isDriveArchiveConfigured } from '@/lib/drive-archive';

/**
 * POST /api/archive-projection
 * Body: { projectionId, force? }
 *
 * Renders a proposal (the projection deck) to PDF and archives it to the
 * Rising Tide shared Drive at:
 *   Helm Records / Proposals / <year> / <address> - <prospect> - Sent <date>.pdf
 *
 * This is the standalone counterpart to the archival that now runs inline
 * inside `markSent` (src/app/projections/actions.ts) — the same relationship
 * /api/archive-contract has with countersignContract. Proposals sent before
 * this shipped never reached Drive, so this route is the backfill entry
 * point: point it at a projection id and the deck lands in Drive and
 * `projection_drive_url` gets stamped.
 *
 * Idempotent — returns the existing url unless `force` is set. Uses sent_at
 * (not "today") for the filename + year folder so a backfilled proposal
 * files under the year it was actually sent.
 *
 * nodejs runtime + longer maxDuration for the chromium binary, same as the
 * other archive routes.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { projectionId?: string; force?: boolean };
    const projectionId = body.projectionId;
    if (!projectionId) {
      return NextResponse.json({ ok: false, error: 'projectionId is required' }, { status: 400 });
    }

    if (!isDriveArchiveConfigured()) {
      return NextResponse.json({ ok: false, error: 'Drive archive not configured' }, { status: 503 });
    }

    const sb = supabaseAdmin;
    const { data: proj } = await sb
      .from('projections')
      .select('id, property_address, prospect_name, status, sent_at, created_at, projection_drive_url')
      .eq('id', projectionId)
      .maybeSingle();
    if (!proj) {
      return NextResponse.json({ ok: false, error: 'projection not found' }, { status: 404 });
    }
    const projection = proj as {
      property_address: string | null;
      prospect_name: string | null;
      status: string | null;
      sent_at: string | null;
      created_at: string | null;
      projection_drive_url: string | null;
    };

    // Only archive proposals that actually went out. A draft still being
    // edited would file a deck that no owner ever saw.
    if (projection.status !== 'sent') {
      return NextResponse.json({ ok: false, error: 'proposal has not been sent' }, { status: 400 });
    }
    if (projection.projection_drive_url && !body.force) {
      return NextResponse.json({
        ok: true,
        url: projection.projection_drive_url,
        alreadyArchived: true,
      });
    }

    const stamp = (projection.sent_at ?? projection.created_at ?? new Date().toISOString()).slice(0, 10);
    const year = stamp.slice(0, 4);
    const filename = `${projection.property_address ?? 'Proposal'} - ${projection.prospect_name ?? 'Prospect'} - Sent ${stamp}.pdf`
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();

    const pdf = await renderProjectionPdf({
      projectionId,
      type: 'projection',
      origin: request.nextUrl.origin,
    });

    const archive = await archiveProposalToDrive({ pdf, filename, year });
    if (!archive.ok || !archive.url) {
      return NextResponse.json(
        { ok: false, error: archive.reason || 'Drive archive failed' },
        { status: 502 },
      );
    }

    const { error: updateErr } = await sb
      .from('projections')
      .update({ projection_drive_url: archive.url })
      .eq('id', projectionId);
    if (updateErr) {
      // PDF is in Drive; only the link-back failed. Report but still
      // return the URL.
      console.error('archive-projection: projections update failed', updateErr);
    }

    return NextResponse.json({ ok: true, url: archive.url, filename });
  } catch (err) {
    console.error('archive-projection error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
