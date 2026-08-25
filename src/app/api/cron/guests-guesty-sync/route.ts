/**
 * Nightly Guesty → Audience sync.
 *
 * Vercel cron schedule: 0 13 * * *  (9am ET, after the daily Guesty
 * reservation/review sync at 5am UTC has completed).
 *
 * Auth: authorizeCron — Vercel Cron's bearer, or a signed-in Helm user
 * running it by hand. Fails closed when CRON_SECRET is unset.
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncGuestyGuestsToList } from '@/lib/guests-guesty-sync';
import { authorizeCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await syncGuestyGuestsToList();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[cron/guests-guesty-sync] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
