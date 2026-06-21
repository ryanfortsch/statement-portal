import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';

/**
 * Daily-ish refresh for everything Guesty owns: listings map, recent
 * reservations, and (most importantly for the home dashboard) reviews.
 *
 * POST or GET /api/cron/sync-guesty
 *
 * Triggered by Vercel cron (vercel.json) once a day. Manual trigger from
 * the dashboard works the same way — fall back to the user's session
 * when CRON_SECRET isn't presented.
 *
 * This is a thin wrapper around the existing /api/sync-guesty handler.
 * We don't fetch the route over HTTP — instead we import its POST
 * handler and call it in-process so the cron lives inside the same
 * Vercel function and shares env vars without a token round-trip.
 *
 * Auth pattern matches /api/cron/sync-gmail-replies: optional
 * CRON_SECRET in Authorization header; manual sync may pass
 * x-helm-manual-sync: 1 instead.
 */

import { POST as syncGuestyPost } from '../../sync-guesty/route';

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    // Forward to the existing sync handler. Body is empty; sync-guesty
    // doesn't read query params we'd need to preserve.
    const result = await syncGuestyPost(request);
    return result;
  } catch (err) {
    console.error('[cron/sync-guesty]', err);
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
