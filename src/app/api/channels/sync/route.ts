import { NextRequest, NextResponse } from 'next/server';
import { syncAllListings } from '@/lib/ical-sync';

// iCal feeds are small; per-property sync runs in seconds. We allow up to
// 5 minutes for a worst-case full-portfolio sync hitting laggy OTA servers.
export const maxDuration = 300;

/**
 * POST /api/channels/sync
 *
 * Body (optional): { listing_id?: string }
 *
 * If listing_id is present, sync only that listing. Otherwise sync every
 * active listing that has an ical_import_url. Used by:
 *   - The "Run sync now" button on /channels
 *   - The cron route (which forwards via fetch)
 *   - Per-listing "resync" buttons on /channels/listings (via server action)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const onlyListingId = typeof body?.listing_id === 'string' ? body.listing_id : undefined;
    await syncAllListings({ onlyListingId });
    return NextResponse.redirect(new URL('/channels', request.url), 303);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GET form so curl/manual debugging is easy. Returns JSON. */
export async function GET(request: NextRequest) {
  try {
    const result = await syncAllListings({});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
