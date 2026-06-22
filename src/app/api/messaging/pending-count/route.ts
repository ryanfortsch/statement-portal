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
  // Count from the approvals ARRAY length, not the response's `count` field.
  // stay-concierge's `count` has been observed to over-report (e.g. include
  // recent / dismissed rows, not just truly pending), which made the masthead
  // badge show wildly more drafts than the messaging pages actually list.
  // The pages render `data.approvals` directly, so using `.length` here keeps
  // the badge and the page in lockstep: if the badge says 5, the page shows 5.
  const guests = guestRes.ok ? guestRes.data.approvals.length : 0;
  const owners = ownerRes.ok ? ownerRes.data.approvals.length : 0;
  return NextResponse.json({ count: guests + owners, guests, owners });
}
