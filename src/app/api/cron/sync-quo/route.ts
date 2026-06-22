import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { POST as syncQuoPost } from '../../sync-quo/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Safety-net cron for the Quo (OpenPhone) backfill.
 *
 * POST or GET /api/cron/sync-quo
 *
 * The webhook is the live path, but it's the ONLY live path — a single
 * missed delivery silently drops a cleaner ping, owner text, or call with
 * no automatic recovery. This re-pulls recent messages + calls per known
 * phone on a cadence so the feed self-heals. Idempotent (dedup on Quo
 * message/call id), so overlapping windows are safe.
 *
 * Thin in-process wrapper around /api/sync-quo. sync_status is now written
 * by the inner route itself via lib/sync-status (one writer per source, so a
 * partial per-phone failure shows up on the daily brief instead of being
 * buried in the response). Auth: CRON_SECRET bearer for Vercel Cron, or a
 * signed-in Helm user for the manual "Sync now" button.
 */

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    return await syncQuoPost(request);
  } catch (err) {
    console.error('[cron/sync-quo]', err);
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
