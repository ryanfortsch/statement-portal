import { NextRequest, NextResponse } from 'next/server';
import { syncAllListings } from '@/lib/ical-sync';
import { loadGuestyListingMap, syncCalendarDays } from '@/lib/calendar-days';
import { recordSyncFailure, recordSyncSuccess } from '@/lib/sync-status';

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
    return result as unknown as Record<string, unknown>;
  } catch (err) {
    await recordSyncFailure('guesty-calendar', err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
