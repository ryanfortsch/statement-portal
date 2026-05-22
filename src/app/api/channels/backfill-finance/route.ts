import { NextResponse } from 'next/server';
import { backfillBookingFinance } from '@/lib/finance-backfill';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Populate booking_finance from the Guesty mirror on demand. GET returns JSON;
 * the nightly /api/cron/channels-backfill runs this automatically after the
 * bookings backfill.
 */
export async function GET() {
  try {
    const result = await backfillBookingFinance();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
