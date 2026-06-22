import { NextRequest, NextResponse } from 'next/server';
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
 * Thin in-process wrapper around /api/sync-seam. sync_status is now written
 * by the inner route itself via lib/sync-status (one writer per source, so a
 * partial per-device failure shows up on the daily brief instead of being
 * buried in the response). Auth: CRON_SECRET bearer for Vercel Cron, or a
 * signed-in Helm user for the manual "Sync now" button.
 */

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    return await syncSeamPost();
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
