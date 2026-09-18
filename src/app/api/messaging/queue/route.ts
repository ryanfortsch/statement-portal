import { NextResponse } from 'next/server';
import { listApprovals, isStayConciergeConfigured, explainError } from '@/lib/stay-concierge';

/**
 * The guest queue as plain JSON, for the card list to poll on its own.
 *
 * /messaging renders four sections, and the queue used to ride the same
 * router.refresh() as the other three. That coupled a 15s card refresh to the
 * slowest thing on the page: the conversations list rebuilds off a 16-page
 * Guesty burst every 90 seconds and takes ~35s cold, well past the poll
 * interval, so each tick superseded the one still in flight and the queue
 * could sit minutes behind while the header chip still read "just now". The
 * tell was a coached card stuck on "Regenerating" long after the rewrite had
 * landed upstream.
 *
 * This endpoint is the queue's own feed: one upstream call, ~60ms, no
 * aggregations. Same proxy session gate as every other /api route, and the
 * dashboard key stays server-side (see /api/messaging/pending-count, which
 * proxies for the nav badge the same way).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStayConciergeConfigured()) {
    return NextResponse.json({ approvals: [] });
  }
  const res = await listApprovals();
  if (!res.ok) {
    // The client keeps showing its last good queue on a failure, so the body
    // is for diagnosis only.
    return NextResponse.json({ error: explainError(res.error) }, { status: 502 });
  }
  return NextResponse.json({ approvals: res.data.approvals });
}
