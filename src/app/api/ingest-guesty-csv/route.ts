import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { recordSyncFailure, recordSyncSuccess } from '@/lib/sync-status';

// Property matching -- keep in sync with statements/render/page.tsx
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

// Lenient number parse: handles "", " ", "$1,234.56". Returns null when blank.
function parseMoney(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,$"\s]/g, '').trim();
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
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

    // Normalise line endings, split, header parse.
    const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV has no rows' }, { status: 400 });
    }
    const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
    const colIdx = (name: string) => headers.indexOf(name.toUpperCase());
    const iCheckIn = colIdx('CHECK-IN');
    const iCheckOut = colIdx('CHECK-OUT');
    const iCode = colIdx('CONFIRMATION CODE');
    const iListing = colIdx('LISTING');
    const iGuest = colIdx('GUEST');
    const iPlatform = colIdx('PLATFORM');
    const iReview = colIdx("GUEST'S PUBLIC REVIEW");
    // Money columns -- added when Dotti expanded the report to pipe the
    // guest-paid gross into our calcs (see /api/ingest for the formula).
    // Any of these can be -1 (missing) on older CSV exports and we fall
    // back to null in the DB.
    const iTotalPaid = colIdx('TOTAL PAID');
    const iTaxes = colIdx('TOTAL TAXES');
    const iCommission = colIdx('CHANNEL COMMISSION INCL TAX');
    const iOwnerNet = colIdx('OWNER NET REVENUE (ACCOUNTING)');

    if (iCheckIn < 0 || iCheckOut < 0 || iListing < 0) {
      return NextResponse.json(
        { error: `CSV missing required headers (CHECK-IN, CHECK-OUT, LISTING). Got: ${headers.join(', ')}` },
        { status: 400 },
      );
    }

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
      if (f.length < Math.max(iListing, iCheckIn, iCheckOut) + 1) continue;

      const checkIn = (f[iCheckIn] || '').split(' ')[0];
      const checkOut = (f[iCheckOut] || '').split(' ')[0];
      const confirmationCode = iCode >= 0 ? (f[iCode] || '').trim() : '';
      const listing = (f[iListing] || '').trim();
      const guest = iGuest >= 0 ? (f[iGuest] || '').trim() : '';
      const platform = iPlatform >= 0 ? (f[iPlatform] || '').trim() : '';
      const reviewText = iReview >= 0 ? (f[iReview] || '').trim() : '';

      if (!checkIn || !checkOut || !listing) continue;
      const propertyId = matchProperty(listing);
      if (!propertyId) { unmatched++; continue; }
      parsed++;

      const nights = nightsBetween(checkIn, checkOut);
      const channel = channelLabel(platform);

      // Money (may be null if these columns aren't in the uploaded CSV).
      const totalPaid = iTotalPaid >= 0 ? parseMoney(f[iTotalPaid]) : null;
      const totalTaxes = iTaxes >= 0 ? parseMoney(f[iTaxes]) : null;
      const channelCommission = iCommission >= 0 ? parseMoney(f[iCommission]) : null;
      const ownerNetGuesty = iOwnerNet >= 0 ? parseMoney(f[iOwnerNet]) : null;

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
        total_paid: totalPaid,
        total_taxes: totalTaxes,
        channel_commission: channelCommission,
        owner_net_revenue_guesty: ownerNetGuesty,
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

    // Upsert reservations. When an API-sourced row already exists for a code,
    // skip the CSV row to preserve API metadata (channel ids, status, etc.) --
    // BUT also gap-fill the money columns (TOTAL_PAID, TOTAL_TAXES,
    // CHANNEL_COMMISSION, OWNER_NET) from the CSV when the API row left them
    // at 0/null. In practice Guesty's API regularly returns 0 for these on
    // VRBO/Booking/Manual stays (and even some Airbnb), so the CSV is the
    // reliable source for that subset of fields. Gap-fill only -- never
    // overwrite a real positive API value.
    let reservationsUpserted = 0;
    let apiRowsBackfilled = 0;
    if (reservationRows.length > 0) {
      const codes = reservationRows.map(r => r.confirmation_code).filter(Boolean);
      const { data: apiExisting } = codes.length
        ? await sb.from('guesty_reservations')
            .select('confirmation_code, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty')
            .eq('source', 'guesty-api')
            .in('confirmation_code', codes)
        : { data: [] as Array<{ confirmation_code: string; total_paid: number | null; total_taxes: number | null; channel_commission: number | null; owner_net_revenue_guesty: number | null }> };
      const apiByCode = new Map((apiExisting || []).map(r => [r.confirmation_code, r]));
      const apiCodes = new Set(apiByCode.keys());

      // CSV rows whose code is NOT already API-sourced -> upsert as csv-fallback.
      const filtered = reservationRows.filter(r => !r.confirmation_code || !apiCodes.has(r.confirmation_code));
      if (filtered.length > 0) {
        const { error } = await sb.from('guesty_reservations').upsert(filtered, { onConflict: 'guesty_reservation_id' });
        if (error) throw new Error(`reservations upsert failed: ${error.message}`);
        reservationsUpserted = filtered.length;
      }

      // Money-column gap-fill on existing API rows.
      const csvByCode = new Map(reservationRows.filter(r => r.confirmation_code).map(r => [r.confirmation_code, r]));
      for (const code of apiCodes) {
        const api = apiByCode.get(code); const csv = csvByCode.get(code);
        if (!api || !csv) continue;
        const updates: Record<string, unknown> = {};
        const fill = (col: 'total_paid' | 'total_taxes' | 'channel_commission' | 'owner_net_revenue_guesty') => {
          const apiVal = Number(api[col] ?? 0);
          const csvVal = csv[col];
          if (apiVal === 0 && csvVal != null && csvVal > 0) updates[col] = csvVal;
        };
        fill('total_paid'); fill('total_taxes'); fill('channel_commission'); fill('owner_net_revenue_guesty');
        if (Object.keys(updates).length > 0) {
          const { error } = await sb.from('guesty_reservations')
            .update(updates)
            .eq('confirmation_code', code)
            .eq('source', 'guesty-api');
          if (!error) apiRowsBackfilled++;
        }
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

    // Track sync status. csv-fallback is on-demand (no cron pulls it), so
    // daily-brief's EXPECTED_FEEDS gives it maxAge null: stale here doesn't
    // false-positive the brief between uploads.
    await recordSyncSuccess('csv-fallback', {
      parsed,
      unmatched,
      reservations: reservationsUpserted,
      reviews: reviewsUpserted,
    });

    return NextResponse.json({
      success: true,
      parsed,
      unmatched_listings: unmatched,
      reservations_upserted: reservationsUpserted,
      api_rows_backfilled: apiRowsBackfilled,
      reviews_upserted: reviewsUpserted,
    });
  } catch (err) {
    console.error('ingest-guesty-csv error:', err);
    await recordSyncFailure('csv-fallback', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
