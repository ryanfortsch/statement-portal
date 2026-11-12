import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { sweepBookingRequests } from '@/lib/booking-requests-db';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/booking-requests
 *
 * Hourly (:25). A partner home's host has 24 hours to answer a booking
 * request; this closes the ones whose clock ran out and emails each guest
 * that nothing was charged. It also retries any guest email that failed:
 * the closing email for three days, the receipt while the request is open.
 * The review screen derives a passed clock at read time, so a request reads
 * as closed before this runs.
 *
 * Idempotent: every close is claimed with status = 'pending' in the where
 * clause, and each email carries a Resend idempotency key.
 */
export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  try {
    const r = await sweepBookingRequests();
    if (!r.ok) {
      // The migration not applied yet is not a failure worth paging on.
      if (r.reason === 'not_configured') return NextResponse.json({ ok: true, skipped: 'not_configured' });
      return NextResponse.json({ ok: false, error: r.reason }, { status: 500 });
    }
    return NextResponse.json(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/booking-requests] failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
