import { NextRequest, NextResponse } from 'next/server';
import { syncAllListings } from '@/lib/ical-sync';
import { loadGuestyListingMap, syncCalendarDays } from '@/lib/calendar-days';
import { backfillReservationGaps } from '@/lib/reservation-gap-backfill';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';
import { authorizeCron } from '@/lib/cron-auth';
import { loadHelmRunPropertyIds } from '@/lib/pms-guards';
import { mirrorWindow, writeHelmCalendarMirror } from '@/lib/helm-calendar-mirror';
import { ensureOtaThreadForBooking } from '@/lib/helm-inbox';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/channels-sync
 *
 * Vercel cron entrypoint for iCal channel sync. Schedule lives in
 * vercel.json. Pulls every active channel_listings row with an
 * ical_import_url and refreshes the bookings table.
 *
 * Then, for the homes Helm runs (properties.calendar_authority = 'helm'),
 * rewrites their calendar mirror from the bookings just refreshed, over the
 * same operational window the Guesty mirror covers, so a hold placed in
 * Helm shows up named on the Operations calendar within a cycle exactly as a
 * Guesty hold does. Recorded under sync_status 'helm-calendar'.
 *
 * Also refreshes the Guesty per-day calendar mirror (hold notes, nightly
 * prices, min-stay) for the OPERATIONAL window on the same 30-minute beat,
 * skipping the helm-run homes so it never sweeps the rows Helm just wrote.
 * The wide 15-month window stays on the daily /api/sync-guesty run; this one
 * covers what the calendar can display.
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

async function writeHelmMirrorWindow(helmRunIds: ReadonlySet<string>): Promise<Record<string, unknown>> {
  if (helmRunIds.size === 0) {
    // Nothing to mirror yet is a healthy state, not a stale feed: the daily
    // brief watches 'helm-calendar' on a 3h window and must not flag it every
    // morning until the first home flips.
    const skipped = { skipped: 'no_helm_run_properties' };
    await recordSyncResult('helm-calendar', { processed: 0, failed: 0, result: skipped });
    return skipped;
  }
  try {
    const { start, end } = mirrorWindow(CALENDAR_DAYS_BACK, CALENDAR_DAYS_FORWARD);
    const result = await writeHelmCalendarMirror(helmRunIds, start, end);
    await recordSyncResult('helm-calendar', {
      processed: result.properties_written,
      failed: result.errors.length,
      firstError: result.errors[0],
      result: result as unknown as Record<string, unknown>,
    });
    return result as unknown as Record<string, unknown>;
  } catch (err) {
    await recordSyncFailure('helm-calendar', err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Every live OTA stay on a Helm-run home gets its inbox thread (one per
 * confirmation code, carrying the deep link into the OTA app) as soon as the
 * feed lands it, not only once an automation fires. Idempotent; a failure
 * here never fails the sync.
 */
async function ensureOtaThreads(helmRunIds: ReadonlySet<string>): Promise<Record<string, unknown>> {
  if (helmRunIds.size === 0) return { skipped: 'no_helm_run_properties' };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('id, property_id, channel, external_confirmation_code, external_booking_id, guest_name, guest_phone, guest_email')
      .in('property_id', [...helmRunIds])
      .in('channel', ['airbnb', 'vrbo', 'booking_com'])
      .in('status', ['confirmed', 'completed'])
      .is('duplicate_of', null)
      .gte('check_out', today)
      .order('check_in', { ascending: true })
      .limit(500);
    if (error) return { error: error.message };
    let ensured = 0;
    for (const b of (data ?? []) as Parameters<typeof ensureOtaThreadForBooking>[0][]) {
      const t = await ensureOtaThreadForBooking(b);
      if (t) ensured += 1;
    }
    return { stays: (data ?? []).length, threads: ensured };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function syncCalendarWindow(helmRunIds: ReadonlySet<string>): Promise<Record<string, unknown>> {
  if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
    return { skipped: 'guesty_not_configured' };
  }
  try {
    const listingMap = await loadGuestyListingMap();
    if (Object.keys(listingMap).length === 0) return { skipped: 'no_listing_map' };
    const start = new Date(Date.now() - CALENDAR_DAYS_BACK * 86400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + CALENDAR_DAYS_FORWARD * 86400_000).toISOString().slice(0, 10);
    // skipPropertyIds: the Guesty mirror must never rewrite (or sweep) a
    // home Helm runs; helm-calendar-mirror.ts owns those rows now.
    const result = await syncCalendarDays(listingMap, start, end, { skipPropertyIds: helmRunIds });
    // A per-property failure is swallowed inside syncCalendarDays (one
    // property's 404 aborts that property's whole refresh, other listings
    // included). Stamping unconditional success meant sync_status stayed
    // 'ok' and the daily brief's age-and-status check never flagged a
    // mirror that had quietly stopped updating, while every downstream
    // freshness guard kept trusting it.
    await recordSyncResult('guesty-calendar', {
      processed: result.listings_touched,
      failed: result.properties_failed,
      firstError: result.errors?.[0],
      result,
    });
    const gaps = await backfillReservationGaps({ startDate: start, endDate: end });
    return { ...(result as unknown as Record<string, unknown>), reservation_gaps: gaps };
  } catch (err) {
    await recordSyncFailure('guesty-calendar', err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function run(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await syncAllListings({});
    // The cutover switch, read once per run. Empty on a failed read means
    // nothing is skipped and no Helm mirror is written: today's behaviour.
    const helmRunIds = await loadHelmRunPropertyIds();
    // Helm's own mirror first, from the bookings just refreshed. Its
    // failures are recorded in sync_status and returned, never thrown.
    const helmCalendar = await writeHelmMirrorWindow(helmRunIds);
    // Calendar-day refresh rides the same cron; its failures are recorded
    // in sync_status and returned, never thrown: a Guesty hiccup must not
    // mark the iCal import run as failed too.
    const calendarDays = await syncCalendarWindow(helmRunIds);
    const otaThreads = await ensureOtaThreads(helmRunIds);
    return NextResponse.json({ ok: true, ...result, helm_calendar: helmCalendar, calendar_days: calendarDays, ota_threads: otaThreads });
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

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
