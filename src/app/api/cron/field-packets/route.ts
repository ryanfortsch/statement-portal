import { NextRequest, NextResponse } from 'next/server';
import { revalidatePublishedPackets, resyncLivePacketBookings } from '@/lib/field-packets';

export const maxDuration = 300;

/**
 * GET /api/cron/field-packets
 *
 * Nightly Field HOUSEKEEPING (schedule in vercel.json, 05:15 UTC = 1:15 AM ET):
 * re-validate every published packet against current bookings/blocks so the
 * marketplace never shows a packet a guest has since moved into, and heal stale
 * packet->booking links. Silent, no one is contacted — everything that texts or
 * emails a human moved to /api/cron/field-morning so it lands at a humane hour.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  // In production the secret is mandatory — never let the revalidation cron run
  // unauthenticated (it's what keeps the marketplace off occupied houses).
  if (process.env.NODE_ENV === 'production' && !cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const revalidated = await revalidatePublishedPackets();
    // Heal stale packet->booking links: re-point live packets' stops to the
    // current nearest upcoming check-in, so a turnover that gained a nearer
    // guest after the packet was built still shows as covered on the board.
    const resynced = await resyncLivePacketBookings().catch(() => ({ checked: 0, updated: 0 }));
    return NextResponse.json({ ok: true, revalidated, resynced });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tolerate the pre-migration window so the cron doesn't 500 nightly until
    // the Field tables exist.
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/field-packets]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
