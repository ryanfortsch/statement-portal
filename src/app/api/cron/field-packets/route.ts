import { NextRequest, NextResponse } from 'next/server';
import { revalidatePublishedPackets, suggestRecurringInspections } from '@/lib/field-packets';
import { renotifyDuePackets } from '@/lib/field-notify';

export const maxDuration = 300;

/**
 * GET /api/cron/field-packets
 *
 * Nightly Field maintenance (schedule in vercel.json): re-validate every
 * published packet against current bookings/blocks so the marketplace never
 * shows a packet a guest has since moved into, re-ping inspectors about
 * unclaimed-but-due packets, and draft routine checks for idle homes (the
 * operator reviews + publishes those from the board).
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
    const renotified = await renotifyDuePackets();
    // Draft routine checks for idle homes; the operator publishes them.
    const drafted = await suggestRecurringInspections().catch(() => 0);
    return NextResponse.json({ ok: true, revalidated, renotified, drafted });
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
