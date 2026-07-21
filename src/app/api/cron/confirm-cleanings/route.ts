import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { getServiceClient } from '@/lib/supabase-admin';
import { autoGraduateQuietEstimates, autoConfirmThresholdMinutes } from '@/lib/cleaning-sessions';

export const runtime = 'nodejs';
// Lower than thermostats' 300s (mostly DB reads/writes), but not the lowest
// possible: rows that clear the quiet-time check also get one live Seam
// device read per lock before writing (see allLocksConfirmedLocked in
// cleaning-sessions.ts), so a large backlog clearing for the first time can
// make dozens of API calls in one run. Don't "correct" this back down to
// match a pure-DB job.
export const maxDuration = 180;

/**
 * Cleaning auto-confirm cron.
 *
 * GET or POST /api/cron/confirm-cleanings (Vercel Cron every 10 min).
 *
 * Scans every cleaning_sessions row still sitting at an unconfirmed
 * lock.locked estimate and graduates it to authoritative once every lock on
 * the property has stayed quiet long enough since the relock AND a live Seam
 * read confirms it's actually locked right now -- no operator tap required.
 *
 * Auth: CRON_SECRET bearer for Vercel Cron, or a signed-in Helm user.
 */
async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await autoGraduateQuietEstimates(getServiceClient(), autoConfirmThresholdMinutes());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/confirm-cleanings]', err);
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
