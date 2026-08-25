import { NextRequest, NextResponse } from 'next/server';
import { renotifyDuePackets, remindClaimedVisitsToday, sendOfficeFieldDigest, sendCreativeCountsDue, sendCreativeDayOfChecks } from '@/lib/field-notify';
import { authorizeCron } from '@/lib/cron-auth';

export const maxDuration = 300;

/**
 * GET /api/cron/field-morning
 *
 * The PEOPLE-facing half of the Field cron work, deliberately split out of
 * /api/cron/field-packets so it runs at a humane hour. That job fires at
 * 05:15 UTC — 1:15 AM Eastern — which is fine for silent housekeeping
 * (revalidation, booking re-sync) but was putting "your visit is today" on a
 * contractor's phone in the middle of the night.
 *
 * Scheduled in vercel.json at 12:00 UTC = 8 AM EDT / 7 AM EST, so it stays in
 * the morning year-round (Vercel crons are UTC-only, so the wall-clock hour
 * shifts an hour across DST — both ends of that shift are business hours).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === 'production' && !cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    // Re-ping inspectors about unclaimed-but-due packets, remind whoever has a
    // visit today, then brief the office on what needs them.
    const renotified = await renotifyDuePackets();
    const reminded = await remindClaimedVisitsToday().catch(() => 0);
    const digest = await sendOfficeFieldDigest().catch(() => false);
    // Dotti's lock-the-views nag: reels whose count window has closed unread.
    const countsDue = await sendCreativeCountsDue().catch(() => false);
    // Shoot-day go/no-go: re-check each shoot home's calendar, text the
    // contributor the all-clear (or the hold), alert Dotti on conflicts.
    const shootChecks = await sendCreativeDayOfChecks().catch(() => ({ go: 0, hold: 0 }));
    return NextResponse.json({ ok: true, renotified, reminded, digest, countsDue, shootChecks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/field-morning]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
