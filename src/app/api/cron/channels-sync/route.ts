import { NextRequest, NextResponse } from 'next/server';
import { syncAllListings } from '@/lib/ical-sync';
import { loadGuestyListingMap, syncCalendarDays } from '@/lib/calendar-days';
import { backfillReservationGaps } from '@/lib/reservation-gap-backfill';
import { recordSyncFailure, recordSyncSuccess } from '@/lib/sync-status';
import { authorizeCron } from '@/lib/cron-auth';

export const maxDuration = 300;

/**
 * GET /api/cron/channels-sync
 *
 * Vercel cron entrypoint for iCal channel sync. Schedule lives in
 * vercel.json. Pulls every active channel_listings row with an
 * ical_import_url and refreshes the bookings table.
 *
 * Also refreshes the Guesty per-day calendar mirror (hold notes, nightly
 * prices, min-stay) for the OPERATIONAL window on the same 30-minute beat,
 * so a hold placed in Guesty shows up named on the Operations calendar
 * within a cycle. The wide 15-month window stays on the daily
 * /api/sync-guesty run; this one covers what the calendar can display.
 *
 * That freshly-refreshed mirror then feeds the reservation gap backfill, which
 * is why the audit rides this cron and not only the nightly one. A stay booked
 * for tonight is the one the turnover rail, the cleaner schedule and the field
 * board all need immediately, and it is also the one most likely to slip a
 * pull. Half an hour is the right blast radius for that; tomorrow morning is
 * not. Costs one paged database read when there is no gap to close.
 */
const CALENDAR_DAYS_BACK = 7;
const CALENDAR_DAYS_FORWARD = 45;

async function syncCalendarWindow(): Promise<Record<string, unknown>> {
  if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
    return { skipped: 'guesty_not_configured' };
  }
  try {
    const listingMap = await loadGuestyListingMap();
    if (Object.keys(listingMap).length === 0) return { skipped: 'no_listing_map' };
    const start = new Date(Date.now() - CALENDAR_DAYS_BACK * 86400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + CALENDAR_DAYS_FORWARD * 86400_000).toISOString().slice(0, 10);
    const result = await syncCalendarDays(listingMap, start, end);
    await recordSyncSuccess('guesty-calendar', result);
    const gaps = await backfillReservationGaps({ startDate: start, endDate: end });
    return { ...(result as unknown as Record<string, unknown>), reservation_gaps: gaps };
  } catch (err) {
    await recordSyncFailure('guesty-calendar', err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await syncAllListings({});
    // Calendar-day refresh rides the same cron; its failures are recorded
    // in sync_status and returned, never thrown — a Guesty hiccup must not
    // mark the iCal import run as failed too.
    const calendarDays = await syncCalendarWindow();
    return NextResponse.json({ ok: true, ...result, calendar_days: calendarDays });
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
