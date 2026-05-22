import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchContractPdf } from '@/lib/contract-email';
import { archiveContractToDrive, isDriveArchiveConfigured } from '@/lib/drive-archive';

/**
 * POST /api/archive-contract
 * Body: { projectionId }
 *
 * Renders a fully-executed management contract to PDF and archives it to
 * the Rising Tide shared Drive at:
 *   Helm Records / Contracts / <year> / <address> - <owner> - Executed <date>.pdf
 *
 * This is the standalone counterpart to the archival that already runs
 * inline inside `countersignContract` (src/app/projections/actions.ts).
 * That inline path only fires at the moment Allie countersigns, so any
 * contract executed BEFORE the Drive-archival feature shipped never made
 * it to the Drive. This route is the backfill / re-archive entry point:
 * point it at a projection id and it lands the executed PDF in Drive and
 * stamps `contract_drive_url`, exactly like the live path.
 *
 * Idempotent — returns the existing url if already archived. Uses the
 * countersign date (not "today") for the filename + year folder, so a
 * backfilled contract files under the year it was actually executed.
 *
 * Best-effort: render / Drive failures return a non-200 with a reason.
 * nodejs runtime + longer maxDuration for the chromium binary, same as
 * the other archive routes.
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
    const body = (await request.json()) as { projectionId?: string };
    const projectionId = body.projectionId;
    if (!projectionId) {
      return NextResponse.json({ ok: false, error: 'projectionId is required' }, { status: 400 });
    }

    if (!isDriveArchiveConfigured()) {
      return NextResponse.json({ ok: false, error: 'Drive archive not configured' }, { status: 503 });
    }

    const sb = getSupabase();
    const { data: proj } = await sb
      .from('projections')
      .select('id, property_address, prospect_name, onboarding_token, contract_signed_at, contract_countersigned_at, contract_drive_url')
      .eq('id', projectionId)
      .maybeSingle();
    if (!proj) {
      return NextResponse.json({ ok: false, error: 'projection not found' }, { status: 404 });
    }
    const projection = proj as {
      property_address: string | null;
      prospect_name: string | null;
      onboarding_token: string | null;
      contract_signed_at: string | null;
      contract_countersigned_at: string | null;
      contract_drive_url: string | null;
    };
    // Only archive fully-executed contracts (owner-signed AND countersigned),
    // matching the inline countersign path that produces the "Executed" PDF.
    if (!projection.contract_countersigned_at) {
      return NextResponse.json({ ok: false, error: 'contract not fully executed' }, { status: 400 });
    }
    // Idempotency.
    if (projection.contract_drive_url) {
      return NextResponse.json({ ok: true, url: projection.contract_drive_url, alreadyArchived: true });
    }

    // File under the year it was actually executed, not today.
    const dateStr = projection.contract_countersigned_at.slice(0, 10); // YYYY-MM-DD
    const year = dateStr.slice(0, 4);
    const filename = `${projection.property_address ?? 'Contract'} - ${projection.prospect_name ?? 'Owner'} - Executed ${dateStr}.pdf`
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();

    const origin = request.nextUrl.origin;
    const pdf = await fetchContractPdf({ projectionId, origin, token: projection.onboarding_token });

    const archive = await archiveContractToDrive({ pdf, filename, year });
    if (!archive.ok || !archive.url) {
      return NextResponse.json(
        { ok: false, error: archive.reason || 'Drive archive failed' },
        { status: 502 },
      );
    }

    const { error: updateErr } = await sb
      .from('projections')
      .update({ contract_drive_url: archive.url })
      .eq('id', projectionId);
    if (updateErr) {
      // PDF is in Drive; only the link-back failed. Report but still
      // return the URL.
      console.error('archive-contract: projections update failed', updateErr);
    }

    return NextResponse.json({ ok: true, url: archive.url });
  } catch (err) {
    console.error('archive-contract error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
