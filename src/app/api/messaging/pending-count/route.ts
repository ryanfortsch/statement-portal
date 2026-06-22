import { NextResponse } from 'next/server';
import { listApprovals, listOwnerApprovals, isStayConciergeConfigured } from '@/lib/stay-concierge';

/**
 * Lightweight count endpoint for the Messaging nav badge.
 *
 * The badge polls this every ~30s so Dotti sees from any module when a new
 * draft is waiting. We proxy through Helm rather than letting the client
 * hit stay-concierge directly because the dashboard key is a server-only
 * secret.
 *
 * Returns the COMBINED guest + owner pending count: Messaging is one section
 * with two tabs (see MessagingTabs), so the masthead badge should signal
 * either queue. The individual breakdown is returned alongside for any
 * future caller that wants per-tab counts.
 *
 * Returns 0 when the service is unconfigured. A failure on either sub-call
 * falls back to 0 for that side rather than zeroing out the whole badge.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStayConciergeConfigured()) {
    return NextResponse.json({ count: 0, guests: 0, owners: 0 });
  }
  const [guestRes, ownerRes] = await Promise.all([listApprovals(), listOwnerApprovals()]);
  // Count TRULY-PENDING rows only -- approvals with `resolved_at === null`.
  // Both the `data.count` field and the raw array length have surfaced as
  // over-counting (the live owner queue returns 36 in the array when only a
  // couple are actually waiting, suggesting stay-concierge includes resolved
  // / dismissed rows in the response). `resolved_at` is the explicit "this
  // is done" flag on the row itself, so filtering on it gives a stable
  // "pending" count no matter what stay-concierge decides to include in the
  // array or in `count` later.
  const guests = guestRes.ok ? guestRes.data.approvals.filter((a) => !a.resolved_at).length : 0;
  const owners = ownerRes.ok ? ownerRes.data.approvals.filter((a) => !a.resolved_at).length : 0;
  return NextResponse.json({ count: guests + owners, guests, owners });
}
