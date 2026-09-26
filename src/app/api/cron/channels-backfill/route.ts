import { NextRequest, NextResponse } from 'next/server';
import { backfillGuestyToBookings } from '@/lib/guesty-backfill';
import { backfillBookingFinance } from '@/lib/finance-backfill';
import { authorizeCron } from '@/lib/cron-auth';
import { loadHelmRunPropertyIds } from '@/lib/pms-guards';
import { mirrorWindow, writeHelmCalendarMirror } from '@/lib/helm-calendar-mirror';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/channels-backfill
 *
 * Nightly Vercel cron. Runs after the Guesty API sync (sync-guesty at 04:30)
 * so any new VRBO / Booking.com / direct reservations Guesty picked up flow
 * into the bookings table the same day. Keeps Operations and Revenue, which
 * now read `bookings`, as fresh for those channels as they were when they read
 * guesty_reservations directly. Idempotent.
 *
 * Both backfills skip the homes Helm runs (properties.calendar_authority =
 * 'helm'; the guard lives inside each via pms-guards). For those homes this
 * run then rewrites the WIDE calendar mirror window, today-90 .. today+540,
 * the span the iCal export and the revenue occupancy denominators read, so
 * it is refreshed nightly the way sync-guesty refreshes Guesty's.
 */
const MIRROR_DAYS_BACK = 90;
const MIRROR_DAYS_FORWARD = 540;

async function writeHelmMirrorWide(): Promise<Record<string, unknown>> {
  const helmRunIds = await loadHelmRunPropertyIds();
  if (helmRunIds.size === 0) {
    // A healthy no-op, stamped so the daily brief's 'helm-calendar' watch
    // does not read the feed as dead before the first home flips.
    const skipped = { skipped: 'no_helm_run_properties' };
    await recordSyncResult('helm-calendar', { processed: 0, failed: 0, result: skipped });
    return skipped;
  }
  try {
    const { start, end } = mirrorWindow(MIRROR_DAYS_BACK, MIRROR_DAYS_FORWARD);
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

async function run(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await backfillGuestyToBookings({});
    // Then pool money onto each canonical booking. Runs after the bookings
    // backfill + its dedup so finance attaches to the surviving canonical row.
    let finance = null;
    try {
      finance = await backfillBookingFinance();
    } catch (err) {
      console.error('[cron/channels-backfill] finance backfill failed:', err);
    }
    // Then the Helm mirror for helm-run homes, wide window. Never thrown:
    // recorded in sync_status and returned.
    const helmCalendar = await writeHelmMirrorWide();
    return NextResponse.json({ ...result, finance, helm_calendar: helmCalendar });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/channels-backfill]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
