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
    console.error('[cron/channels-sync]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
