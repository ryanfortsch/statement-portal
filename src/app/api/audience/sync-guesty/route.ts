/**
 * Manual trigger for Guesty → Audience sync.
 *
 * Fired from the "Sync from Guesty" button on /audience. Auth via Auth.js
 * (Helm's standard internal-route gate). For the scheduled equivalent see
 * /api/cron/audience-guesty-sync.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { syncGuestyGuestsToAudience } from '@/lib/audience-guesty-sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncGuestyGuestsToAudience();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[audience/sync-guesty] failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
