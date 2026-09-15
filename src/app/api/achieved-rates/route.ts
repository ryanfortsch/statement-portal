import { NextResponse } from 'next/server';
import { computeAchievedRates } from '@/lib/achieved-rates';

/**
 * Achieved-rates bridge: what a property ACTUALLY transacted per night, from
 * the statements data, for stays touching a date window.
 *
 * Built for stay-concierge's far-future book-now quoting (2026-08-20): the
 * Guesty calendar's price fields on sold-out peak months are PriceLabs-decayed
 * leftover LIST prices, not transacted rates - 17 Beach's Aug 2027 quoted
 * $685/night off calendar averages while the statements showed $1,785/night
 * actually achieved (Kate Bacon, Jun 27 - Aug 1). This endpoint is the source
 * of truth the quoter prefers: adjusted_revenue / nights per stay.
 *
 * The query + slice-merge logic lives in src/lib/achieved-rates.ts
 * (computeAchievedRates) so the custom quote composer can read the same
 * numbers in-process. This route is auth + validation over that function
 * and returns exactly what it builds.
 *
 * Auth: STAY_CONCIERGE_KEY shared secret, HEADER ONLY (x-stay-concierge-key).
 * No ?key= form: query-string secrets leak through URL logging (the 8/20
 * rotation was traced to exactly that in httpx).
 *
 *   GET /api/achieved-rates?property_id=17_beach_rd&start=2026-08-01&end=2026-09-01
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'bridge disabled (no key configured)' }, { status: 503 });
  }
  if (req.headers.get('x-stay-concierge-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const propertyId = (searchParams.get('property_id') || '').trim();
  const start = (searchParams.get('start') || '').trim();
  const end = (searchParams.get('end') || '').trim();
  if (!propertyId || !ISO_DAY.test(start) || !ISO_DAY.test(end) || start > end) {
    return NextResponse.json(
      { error: 'expected property_id, start, end (YYYY-MM-DD, start <= end)' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await computeAchievedRates(propertyId, start, end));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
