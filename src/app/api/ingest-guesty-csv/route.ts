import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Property matching -- keep in sync with statement/page.tsx
const LISTING_MATCH: Record<string, string> = {
  '3_south_st':    '3 south',
  '21_horton':     '21 horton',
  '53_rocky_neck': '53 rocky neck',
  '4_brier_neck':  '4 brier neck',
  '30_woodward':   '30 woodward',
  '20_hammond':    '20 hammond',
  '20_enon':       '20 enon',
  '73_rocky_neck': '73 rocky neck',
  '17_beach_rd':   '17 beach',
  '65_calderwood': '65 calderwood',
  '3_locust':      '3 locust',
  '3246_ne_27th':  '3246 ne 27th',
};
const NICKNAME_HINTS: Record<string, string> = {
  '3_south_st':    'old garden beach',
  '21_horton':     'rocky neck',
  '53_rocky_neck': 'the neck',
  '4_brier_neck':  'brier neck',
  '30_woodward':   'little river',
  '20_hammond':    'east gloucester',
  '20_enon':       'beverly shops',
  '73_rocky_neck': 'smith cove',
  '17_beach_rd':   'niles beach',
  '65_calderwood': 'black rock harbor',
  '3_locust':      'niles beach',
  '3246_ne_27th':  'lighthouse point',
};

function matchProperty(listing: string): string | null {
  const h = listing.toLowerCase();
  for (const [pid, needle] of Object.entries(LISTING_MATCH)) if (h.includes(needle)) return pid;
  for (const [pid, hint] of Object.entries(NICKNAME_HINTS)) if (h.includes(hint)) return pid;
  return null;
}

function channelLabel(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('homeaway') || p === 'vrbo') return 'VRBO';
  if (p.includes('booking')) return 'Booking.com';
  return 'Direct';
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur); return fields;
}

function nightsBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400_000));
}

// ---- Supabase ----
let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase not configured');
  _sb = createClient(url, key);
  return _sb;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const csvText: string = body.csv || '';
    if (!csvText || csvText.length < 50) {
      return NextResponse.json({ error: 'Missing or empty csv body (send {"csv": "..."}' }, { status: 400 });
    }

    const lines = csvText.split('\n');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const reservationRows: any[] = [];
    const reviewRows: any[] = [];
    let unmatched = 0;
    let parsed = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const f = parseCSVLine(line);
      if (f.length < 7) continue;

      const checkIn = (f[0] || '').split(' ')[0];
      const checkOut = (f[1] || '').split(' ')[0];
      const confirmationCode = (f[2] || '').trim();
      const listing = (f[3] || '').trim();
      const guest = (f[4] || '').trim();
      const platform = (f[5] || '').trim();
      const reviewText = (f[6] || '').trim();

      if (!checkIn || !checkOut || !listing) continue;
      const propertyId = matchProperty(listing);
      if (!propertyId) { unmatched++; continue; }
      parsed++;

      const nights = nightsBetween(checkIn, checkOut);
      const channel = channelLabel(platform);

      // Reservation row: any reservation (past or future) is useful for future
      // "On the horizon" + cross-referencing. Dedupe by synthetic id.
      reservationRows.push({
        guesty_reservation_id: `csv:${confirmationCode || `${propertyId}:${checkIn}`}`,
        property_id: propertyId,
        guest_name: guest || null,
        confirmation_code: confirmationCode || null,
        check_in: checkIn,
        check_out: checkOut,
        nights,
        channel,
        guesty_channel_id: platform || null,
        status: 'confirmed',
        source: 'csv-fallback',
        synced_at: new Date().toISOString(),
      });

      // Review row: infer 5.0 if there's meaningful public review text.
      if (reviewText && reviewText.length > 15 && checkOut <= todayStr) {
        reviewRows.push({
          guesty_review_id: `csv:${confirmationCode || `${propertyId}:${checkOut}:${guest}`.replace(/\s+/g, '_')}`,
          property_id: propertyId,
          guest_name: guest || null,
          channel,
          guesty_channel_id: platform || null,
          overall_rating: 5.0, // inferred: public reviews skew 5-star
          public_review: reviewText,
          review_created_at: checkOut + 'T00:00:00Z',
          source: 'csv-fallback',
          synced_at: new Date().toISOString(),
        });
      }
    }

    const sb = getSupabase();

    // Upsert reservations. Skip rows that would overwrite a Guesty-API-sourced
    // reservation (API data is always more complete than CSV data).
    let reservationsUpserted = 0;
    if (reservationRows.length > 0) {
      // Which confirmation codes already have API-sourced rows?
      const codes = reservationRows.map(r => r.confirmation_code).filter(Boolean);
      const { data: apiExisting } = codes.length
        ? await sb.from('guesty_reservations')
            .select('confirmation_code')
            .eq('source', 'guesty-api')
            .in('confirmation_code', codes)
        : { data: [] as { confirmation_code: string }[] };
      const apiCodes = new Set((apiExisting || []).map(r => r.confirmation_code));
      const filtered = reservationRows.filter(r => !r.confirmation_code || !apiCodes.has(r.confirmation_code));
      if (filtered.length > 0) {
        const { error } = await sb.from('guesty_reservations').upsert(filtered, { onConflict: 'guesty_reservation_id' });
        if (error) throw new Error(`reservations upsert failed: ${error.message}`);
        reservationsUpserted = filtered.length;
      }
    }

    // Same for reviews: skip if API-sourced review already exists for this reservation.
    let reviewsUpserted = 0;
    if (reviewRows.length > 0) {
      const { data: apiReviews } = await sb.from('reviews')
        .select('guesty_review_id')
        .eq('source', 'guesty-api');
      const apiIds = new Set((apiReviews || []).map(r => r.guesty_review_id));
      // Also check by property+date collision -- a simpler heuristic.
      // For now we just upsert all CSV reviews (guesty_review_id starts with "csv:",
      // so they can't collide with API IDs which are Mongo ObjectIds).
      const filtered = reviewRows.filter(r => !apiIds.has(r.guesty_review_id));
      if (filtered.length > 0) {
        const { error } = await sb.from('reviews').upsert(filtered, { onConflict: 'guesty_review_id' });
        if (error) throw new Error(`reviews upsert failed: ${error.message}`);
        reviewsUpserted = filtered.length;
      }
    }

    // Track sync status
    await sb.from('sync_status').upsert(
      { source: 'csv-fallback', last_synced_at: new Date().toISOString(), last_result: {
        parsed, unmatched, reservations: reservationsUpserted, reviews: reviewsUpserted,
      } },
    );

    return NextResponse.json({
      success: true,
      parsed,
      unmatched_listings: unmatched,
      reservations_upserted: reservationsUpserted,
      reviews_upserted: reviewsUpserted,
    });
  } catch (err) {
    console.error('ingest-guesty-csv error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
