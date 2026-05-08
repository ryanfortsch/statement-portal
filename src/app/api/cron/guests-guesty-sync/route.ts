/**
 * Nightly Guesty → Audience sync.
 *
 * Vercel cron schedule: 0 13 * * *  (9am ET, after the daily Guesty
 * reservation/review sync at 5am UTC has completed).
 *
 * Auth: optional CRON_SECRET in Authorization header. If unset, the route
 * is open (Vercel cron is the only scheduled caller) — set CRON_SECRET in
 * env to lock it to scheduled runs in prod.
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncGuestyGuestsToList } from '@/lib/guests-guesty-sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
