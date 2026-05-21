import { NextRequest, NextResponse } from 'next/server';
import { backfillGuestyToBookings } from '@/lib/guesty-backfill';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * POST /api/channels/backfill-from-guesty
 *
 * Copies guesty_reservations into the bookings table (source='guesty_legacy')
 * and runs the cross-source dedup. Idempotent. Callable from the dashboard
 * button (HTML form -> redirect) or via JSON ({ dryRun?: boolean }).
 *
 * The nightly automated run is /api/cron/channels-backfill.
 */
export async function POST(request: NextRequest) {
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await request.json().catch(() => ({})) : {};
  const dryRun = body?.dryRun === true;
  const isHtmlForm = !isJson;

  try {
    const result = await backfillGuestyToBookings({ dryRun });
    if (isHtmlForm) {
      return NextResponse.redirect(new URL(`/channels?backfilled=${result.inserted}`, request.url), 303);
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
