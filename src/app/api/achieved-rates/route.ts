import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

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
 * Shape notes:
 *  - Cross-month installment stays are materialized as MULTIPLE reservations
 *    rows (one per statement month), each carrying the FULL stay dates but
 *    only that month's nights + revenue slice. Slices are merged here by
 *    (confirmation_code|guest, check_in, check_out); nights-prorated slices
 *    share one nightly rate, so sum(revenue)/sum(nights) is exact.
 *  - Overlap is touch-inclusive (check_in <= end AND check_out >= start): a
 *    stay whose checkout lands ON the window start is a valid rate sample for
 *    that window (its last paid night is the prior day at the same rate).
 *  - Homeowner stays (adjusted_revenue = 0) are excluded; they are not
 *    transactions.
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

type ReservationRow = {
  guest_name: string | null;
  confirmation_code: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  adjusted_revenue: number | string | null;
  platform: string | null;
  property_statements: {
    property_id: string;
    statement_periods: { month: string | null } | null;
  } | null;
};

type Stay = {
  guest_name: string;
  confirmation_code: string;
  check_in: string;
  check_out: string;
  platform: string;
  months: string[];
  nights: number;
  adjusted_revenue: number;
  nightly: number;
};

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

  const { data, error } = await supabase
    .from('reservations')
    .select(
      'guest_name, confirmation_code, check_in, check_out, nights, adjusted_revenue, platform, ' +
        'property_statements!inner(property_id, statement_periods(month))',
    )
    .eq('property_statements.property_id', propertyId)
    .lte('check_in', end)
    .gte('check_out', start);
  if (error) {
    return NextResponse.json({ error: `query failed: ${error.message}` }, { status: 500 });
  }

  // Merge installment slices into whole stays.
  const byStay = new Map<string, Stay>();
  for (const row of (data || []) as unknown as ReservationRow[]) {
    const nights = Number(row.nights) || 0;
    const revenue = Number(row.adjusted_revenue) || 0;
    if (nights <= 0 || revenue <= 0 || !row.check_in || !row.check_out) continue;
    const key = `${(row.confirmation_code || '').trim() || (row.guest_name || '').trim()}|${row.check_in}|${row.check_out}`;
    const month = row.property_statements?.statement_periods?.month || '';
    const existing = byStay.get(key);
    if (existing) {
      existing.nights += nights;
      existing.adjusted_revenue += revenue;
      if (month && !existing.months.includes(month)) existing.months.push(month);
    } else {
      byStay.set(key, {
        guest_name: row.guest_name || '',
        confirmation_code: row.confirmation_code || '',
        check_in: row.check_in,
        check_out: row.check_out,
        platform: row.platform || '',
        months: month ? [month] : [],
        nights,
        adjusted_revenue: revenue,
        nightly: 0,
      });
    }
  }

  const cents = (n: number) => Math.round(n * 100) / 100;
  const stays = [...byStay.values()]
    .map((s) => ({ ...s, adjusted_revenue: cents(s.adjusted_revenue), nightly: cents(s.adjusted_revenue / s.nights) }))
    .sort((a, b) => a.check_in.localeCompare(b.check_in));

  const totalNights = stays.reduce((sum, s) => sum + s.nights, 0);
  const totalRevenue = cents(stays.reduce((sum, s) => sum + s.adjusted_revenue, 0));

  return NextResponse.json({
    property_id: propertyId,
    start,
    end,
    stays,
    aggregate: {
      stay_count: stays.length,
      nights: totalNights,
      adjusted_revenue: totalRevenue,
      nightly: totalNights > 0 ? cents(totalRevenue / totalNights) : 0,
    },
  });
}
