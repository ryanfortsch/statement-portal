import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderOnboardingPdf, onboardingPdfFilename } from '@/lib/onboarding-pdf';
import { getProperty } from '@/lib/properties';
import { archiveToDrive } from '@/lib/drive-archive';

/**
 * POST /api/archive-onboarding
 * Body: { projectionId }
 *
 * Renders a submitted owner-onboarding intake to PDF and archives it
 * to the Rising Tide shared Drive at:
 *   Helm Records / Onboarding / <year> / <property> - Owner Intake <date>.pdf
 *
 * Fired fire-and-forget by a client trigger on the onboarding "thanks"
 * page once the owner submits. Idempotent — returns the existing url if
 * already archived (the trigger fires on every thanks-page mount).
 *
 * Best-effort: failures return non-200; the caller treats it as
 * non-fatal. The owner's submission is persisted independently and is
 * never blocked by archival.
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

    const sb = getSupabase();
    const { data: proj } = await sb
      .from('projections')
      .select('id, property_id, property_address, onboarding_submitted_at, onboarding_drive_url')
      .eq('id', projectionId)
      .maybeSingle();
    if (!proj) {
      return NextResponse.json({ ok: false, error: 'projection not found' }, { status: 404 });
    }
    const projection = proj as {
      property_id: string | null;
      property_address: string | null;
      onboarding_submitted_at: string | null;
      onboarding_drive_url: string | null;
    };
    if (!projection.onboarding_submitted_at) {
      return NextResponse.json({ ok: false, error: 'onboarding not submitted' }, { status: 400 });
    }
    // Idempotency — the thanks-page trigger fires on every mount.
    if (projection.onboarding_drive_url) {
      return NextResponse.json({ ok: true, url: projection.onboarding_drive_url, alreadyArchived: true });
    }

    // Prefer the short internal property name when this prospect has been
    // promoted to a managed property; otherwise fall back to the address.
    const propertyShort =
      (projection.property_id ? getProperty(projection.property_id)?.name : null) ||
      projection.property_address ||
      'Prospect';
    const year = projection.onboarding_submitted_at.slice(0, 4);

    const origin = request.nextUrl.origin;
    const pdf = await renderOnboardingPdf({ projectionId, origin });
    const filename = onboardingPdfFilename(propertyShort, projection.onboarding_submitted_at);

    const archive = await archiveToDrive({
      pdf,
      filename,
      folderPath: ['Onboarding', year],
    });
    if (!archive.ok || !archive.url) {
      return NextResponse.json(
        { ok: false, error: archive.reason || 'Drive archive failed' },
        { status: 502 },
      );
    }

    const { error: updateErr } = await sb
      .from('projections')
      .update({ onboarding_drive_url: archive.url })
      .eq('id', projectionId);
    if (updateErr) {
      console.error('archive-onboarding: projections update failed', updateErr);
    }

    return NextResponse.json({ ok: true, url: archive.url });
  } catch (err) {
    console.error('archive-onboarding error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
