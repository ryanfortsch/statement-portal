import { NextRequest, NextResponse } from 'next/server';
import { renotifyDuePackets, remindClaimedVisitsToday, sendOfficeFieldDigest } from '@/lib/field-notify';

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
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === 'production' && !cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Re-ping inspectors about unclaimed-but-due packets, remind whoever has a
    // visit today, then brief the office on what needs them.
    const renotified = await renotifyDuePackets();
    const reminded = await remindClaimedVisitsToday().catch(() => 0);
    const digest = await sendOfficeFieldDigest().catch(() => false);
    return NextResponse.json({ ok: true, renotified, reminded, digest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/field-morning]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
