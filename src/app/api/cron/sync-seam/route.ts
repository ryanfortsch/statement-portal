import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeCron } from '@/lib/cron-auth';
import { POST as syncSeamPost } from '../../sync-seam/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Safety-net cron for Seam smart-lock battery telemetry.
 *
 * POST or GET /api/cron/sync-seam
 *
 * The webhook is the live path; this lists every device and runs it
 * through the same ingest so a missed low-battery webhook still surfaces
 * (and auto-opens a maintenance slip) within a day. No-ops gracefully if
 * SEAM_API_KEY is unset.
 *
 * Thin in-process wrapper around /api/sync-seam (same pattern as
 * /api/cron/sync-guesty). Auth: optional CRON_SECRET bearer; manual
 * trigger may pass x-helm-manual-sync: 1.
 */

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await syncSeamPost();
    if (result.ok) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      );
      await supabase
        .from('sync_status')
        .upsert(
          { source: 'seam', last_synced_at: new Date().toISOString() },
          { onConflict: 'source' },
        );
    }
    return result;
  } catch (err) {
    console.error('[cron/sync-seam]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
