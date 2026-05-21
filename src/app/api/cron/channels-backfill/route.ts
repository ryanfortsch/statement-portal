import { NextRequest, NextResponse } from 'next/server';
import { backfillGuestyToBookings } from '@/lib/guesty-backfill';

export const maxDuration = 300;

/**
 * GET /api/cron/channels-backfill
 *
 * Nightly Vercel cron. Runs after the Guesty API sync (sync-guesty at 04:30)
 * so any new VRBO / Booking.com / direct reservations Guesty picked up flow
 * into the bookings table the same day. Keeps Operations and Revenue, which
 * now read `bookings`, as fresh for those channels as they were when they read
 * guesty_reservations directly. Idempotent.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await backfillGuestyToBookings({});
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/channels-backfill]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
