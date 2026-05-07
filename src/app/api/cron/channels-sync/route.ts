import { NextRequest, NextResponse } from 'next/server';
import { syncAllListings } from '@/lib/ical-sync';

export const maxDuration = 300;

/**
 * GET /api/cron/channels-sync
 *
 * Vercel cron entrypoint for iCal channel sync. Schedule lives in
 * vercel.json. Pulls every active channel_listings row with an
 * ical_import_url and refreshes the bookings table.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncAllListings({});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tolerate the pre-migration window: while 20260507b hasn't been
    // applied the channel_listings table doesn't exist, and we'd otherwise
    // throw 500 every 30 minutes. Treat that as a benign no-op so the
    // logs stay clean until the operator runs the SQL.
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/channels-sync]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
