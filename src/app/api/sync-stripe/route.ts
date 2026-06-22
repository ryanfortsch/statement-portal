import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { syncPropertyStripe, getStripeKeysMap, type StripeSyncResult } from '@/lib/stripe-sync';
import { recordSyncFailure, recordSyncResult } from '@/lib/sync-status';

/**
 * Cross-property Stripe sync. The "Sync Stripe" button on the dashboard
 * fires this for every property in STRIPE_KEYS_JSON for the selected
 * month. Per-property logic lives in @/lib/stripe-sync so /api/ingest
 * can call the same code path automatically at the end of every
 * single-property upload.
 *
 * Rising Tide uses independent Stripe accounts per property (not a
 * Connect platform), so each property's read-only restricted key sits in
 * the STRIPE_KEYS_JSON env var keyed by property_id. Example:
 *
 *   STRIPE_KEYS_JSON={"17_beach_rd":"rk_live_...","21_horton":"rk_live_..."}
 *
 * Airbnb + Booking.com reservations are skipped -- those don't flow
 * through Rising Tide's Stripe accounts.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as { month?: string }));
    const month: string = body.month || '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month is required, format YYYY-MM' }, { status: 400 });
    }

    const keys = getStripeKeysMap();
    if (Object.keys(keys).length === 0) {
      return NextResponse.json(
        { error: 'STRIPE_KEYS_JSON env var is not configured. Set it to a JSON object mapping property_id -> restricted Stripe key.' },
        { status: 400 },
      );
    }

    // Locate the statement period + its property_statements so we can find
    // which reservations to match against.
    const { data: period } = await supabase.from('statement_periods').select('id').eq('month', month).single();
    if (!period) {
      return NextResponse.json({ error: `No statement period for ${month}` }, { status: 404 });
    }

    type StmtRow = {
      id: string;
      property_id: string;
      management_fee_pct: number;
      cleaning_total: number;
      repairs_total: number;
    };
    const { data: stmts } = await supabase
      .from('property_statements')
      .select('id, property_id, management_fee_pct, cleaning_total, repairs_total')
      .eq('period_id', period.id);

    const stmtByPropertyId = new Map<string, StmtRow>();
    ((stmts || []) as StmtRow[]).forEach(s => stmtByPropertyId.set(s.property_id, s));

    const results: StripeSyncResult[] = [];

    // Per-property sync. We intentionally do these sequentially rather than in
    // parallel so a single bad key doesn't cascade into every other account's
    // output and so Stripe rate limits don't spike.
    for (const [propertyId, restrictedKey] of Object.entries(keys)) {
      const stmt = stmtByPropertyId.get(propertyId);
      if (!stmt) {
        // No statement for this property in this month. Two cases worth
        // distinguishing:
        //   (a) the property had real (revenue-generating) bookings but
        //       the monthly ingest wasn't run -- real error, surface it
        //   (b) the property had no real bookings -- common (homeowner
        //       blocked their own calendar, or just an empty month),
        //       silently skip
        // "Real" here means total_paid > 0; null counts too because legacy
        // rows from before the money columns existed can't be distinguished
        // and we err on the side of telling the operator.
        const monthStart = `${month}-01`;
        const [y, m] = month.split('-').map(Number);
        const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
        const { count: gRowCount } = await supabase
          .from('guesty_reservations')
          .select('*', { count: 'exact', head: true })
          .eq('property_id', propertyId)
          .gte('check_out', monthStart)
          .lt('check_out', monthEndExclusive)
          .or('total_paid.is.null,total_paid.gt.0');
        const hadRealBookings = (gRowCount || 0) > 0;
        if (hadRealBookings) {
          results.push({
            property_id: propertyId,
            charges_found: 0, matched: 0,
            unmatched_charges: [], fee_updates: [], refunds_detected: [], gross_mismatches: [], reservations_missing_charge: [],
            error: `No statement for ${propertyId} / ${month} despite ${gRowCount} paid booking(s) in Guesty -- run the monthly ingest first`,
          });
        }
        // Otherwise silently skip -- no error, no entry in results
        continue;
      }

      const result = await syncPropertyStripe({
        supabase,
        propertyId,
        restrictedKey,
        month,
        stmt: {
          id: stmt.id,
          management_fee_pct: stmt.management_fee_pct,
          cleaning_total: stmt.cleaning_total,
          repairs_total: stmt.repairs_total,
        },
      });
      results.push(result);
    }

    // Log last sync for the dashboard's relative-time badge AND surface any
    // per-property failure on the daily brief. A single-property bad-key now
    // lights up sync_status instead of being buried in results[].error.
    const failed = results.filter((r) => r.error).length;
    await recordSyncResult('stripe', {
      processed: results.length - failed,
      failed,
      firstError: results.find((r) => r.error)?.error,
      result: { month, properties: results.length },
    });

    return NextResponse.json({ success: true, month, results });
  } catch (err) {
    console.error('sync-stripe error:', err);
    await recordSyncFailure('stripe', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
