import { NextResponse } from 'next/server';
import { linkedFeedFor } from '@/lib/listing-links';
import { linkedIcal } from '@/lib/listing-links-core';

/**
 * /api/channels/ical/linked/<token>.ics: the closures Helm places on a
 * linked listing Guesty does not run (17 Beach's back unit), for that
 * listing to import on Airbnb. Public by the /api/channels/ical/ prefix and
 * guarded by the unguessable token, like the export feed. Dates only: no
 * guest, no reservation, no source.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const clean = decodeURIComponent(token ?? '').replace(/\.ics$/i, '');
  let feed: Awaited<ReturnType<typeof linkedFeedFor>>;
  try {
    feed = await linkedFeedFor(clean);
  } catch {
    // A failed read must not publish an empty calendar (which would reopen
    // every night Helm had closed): answer an error the OTA will retry.
    return new NextResponse('unavailable', { status: 503 });
  }
  if (!feed) return new NextResponse('not found', { status: 404 });
  return new NextResponse(linkedIcal(feed.label, feed.blocks, new Date()), {
    status: 200,
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
