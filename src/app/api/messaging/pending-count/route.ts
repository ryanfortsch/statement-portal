import { NextResponse } from 'next/server';
import { listApprovals, isStayConciergeConfigured } from '@/lib/stay-concierge';

/**
 * Lightweight count endpoint for the Messaging nav badge.
 *
 * The badge polls this every ~30s so Dotti sees from any module when a
 * new draft is waiting. We proxy through Helm rather than letting the
 * client hit stay-concierge directly because the dashboard key is a
 * server-only secret.
 *
 * Returns 0 when the service is unconfigured or unreachable — the badge
 * just stays hidden in that case rather than showing an error chip.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStayConciergeConfigured()) {
    return NextResponse.json({ count: 0 });
  }
  const res = await listApprovals();
  if (!res.ok) {
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({ count: res.data.count });
}
