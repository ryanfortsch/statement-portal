import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { POST as syncPost } from '../../sync-competitors/route';

/**
 * Weekly cron wrapper for /api/sync-competitors.
 *
 * Auth pattern matches the other Helm crons:
 *   - Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` →  allowed
 *   - Manual sync from the dashboard sends `x-helm-manual-sync: 1` → falls
 *     back to the user's session check inside the work handler
 *
 * The cron forwards via an in-process call so we don't pay for a public
 * round-trip and share env vars naturally.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  // Tag downstream so the work handler skips the session check when this
  // came from the cron path with a valid bearer.
  const headers = new Headers(request.headers);
  headers.set('x-helm-cron', '1');
  const forwarded = new NextRequest(request.url, {
    method: 'POST',
    headers,
    body: request.body,
  });

  try {
    return await syncPost(forwarded);
  } catch (err) {
    console.error('[cron/sync-competitors]', err);
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
