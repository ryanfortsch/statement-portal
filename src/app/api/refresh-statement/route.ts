import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Refresh an existing property_statement by adding any guesty_reservations
 * rows that have checked out in the statement month, are paid (total_paid > 0),
 * and aren't already on the statement.
 *
 * Use case: the monthly ingest was run early (e.g. Apr 20) and captured the
 * stays known at that time. New stays subsequently checked out (e.g. Apr 26)
 * and got synced into guesty_reservations via "Upload Reservations CSV" --
 * but the statement itself doesn't auto-incorporate those.
 *
 * This endpoint inserts the missing reservations using the same Stripe-on-
 * gross + kludge-strip formulas as /api/ingest, then recomputes the
 * statement's rental_revenue / management_fee / owner_payout / num_stays /
 * nights_booked. Cleaning events aren't touched (they're driven by the
 * Chase bank CSV which is a separate flow).
 *
 * Homeowner stays (total_paid <= 0) and reservations already on the
 * statement (matched by confirmation_code) are skipped.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcStripeFee(processedAmount: number): number {
  return round2(processedAmount * 0.039 + 0.40);
}

function nightsBetween(a: string, b: string): number {
  const d1 = Date.parse(a + 'T00:00:00');
  const d2 = Date.parse(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400_000));
}

function normalizePlatform(raw?: string | null): string {
  if (!raw) return 'Unknown';
  const s = raw.trim();
  if (!s) return 'Unknown';
  const l = s.toLowerCase();
  if (l.startsWith('airbnb')) return 'Airbnb';
  if (l.startsWith('homeaway') || l === 'vrbo') return 'HomeAway';
  if (l === 'bookingcom' || l.startsWith('booking')) return 'Booking.com';
  if (l === 'direct' || l === 'manual') return 'Manual';
  return s;
}

function stripLegacyCommissionKludge(args: {
  platform: string; totalPaid: number; totalTaxes: number; commission: number;
}): number {
  const { platform, totalPaid, totalTaxes, commission } = args;
  if (!commission || commission <= 0) return 0;
  const base = Math.max(totalPaid - totalTaxes, 0);
  if (base <= 0) return commission;
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL' && ratio > 0.02) return 0;
  if ((p.includes('HOMEAWAY') || p === 'VRBO') && ratio > 0.07) {
    return round2(base * 0.05);
  }
  return commission;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as { month?: string; property_id?: string }));
    const month = body.month || '';
    const propertyId = body.property_id || '';
    if (!/^\d{4}-\d{2}$/.test(month) || !propertyId) {
      return NextResponse.json({ error: 'month (YYYY-MM) and property_id are required' }, { status: 400 });
    }

    const { data: period } = await supabase.from('statement_periods').select('id').eq('month', month).single();
    if (!period) {
      return NextResponse.json({ error: `No statement period for ${month}` }, { status: 404 });
    }

    const { data: stmt } = await supabase
      .from('property_statements')
      .select('id, management_fee_pct, cleaning_total, repairs_total, reserve_holdback')
      .eq('period_id', period.id)
      .eq('property_id', propertyId)
      .single();
    if (!stmt) {
      return NextResponse.json(
        { error: `No statement for ${propertyId} / ${month}. Run a full ingest first via Re-Upload Data.` },
        { status: 404 },
      );
    }

    // Existing reservation codes -- we won't duplicate any of these.
    const { data: existing } = await supabase
      .from('reservations')
      .select('confirmation_code')
      .eq('property_statement_id', stmt.id);
    const existingCodes = new Set(
      (existing || []).map(r => r.confirmation_code).filter((c): c is string => !!c),
    );

    // Candidate guesty_reservations: same property, checked out in month,
    // paid (total_paid > 0). Owner stays (total_paid = 0) excluded.
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const { data: candidates } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, total_paid, total_taxes, channel_commission')
      .eq('property_id', propertyId)
      .gte('check_out', monthStart)
      .lt('check_out', monthEndExclusive)
      .gt('total_paid', 0);

    const missing = (candidates || []).filter(c =>
      c.confirmation_code && !existingCodes.has(c.confirmation_code)
    );

    if (missing.length === 0) {
      return NextResponse.json({
        success: true,
        added: [],
        message: 'No new bookings to add. The statement is up to date with guesty_reservations.',
      });
    }

    const newRows = missing.map(g => {
      const platform = normalizePlatform(g.channel || g.guesty_channel_id);
      const platformUpper = platform.toUpperCase();
      const isStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper === 'VRBO' || platformUpper === 'MANUAL';
      const totalPaid = Number(g.total_paid) || 0;
      const totalTaxes = Number(g.total_taxes) || 0;
      const rawCommission = Number(g.channel_commission) || 0;

      let stripeFee = 0;
      let adjustedRevenue: number;
      let guestyRentalIncome: number;

      if (isStripeChannel) {
        // VRBO / Manual: reconstruct net from gross
        const effComm = stripLegacyCommissionKludge({ platform, totalPaid, totalTaxes, commission: rawCommission });
        stripeFee = calcStripeFee(totalPaid);
        guestyRentalIncome = round2(totalPaid - totalTaxes - effComm);
        adjustedRevenue = round2(guestyRentalIncome - stripeFee);
      } else {
        // Airbnb / Booking.com: total_paid is already net of channel fees
        guestyRentalIncome = totalPaid;
        adjustedRevenue = totalPaid;
      }

      return {
        property_statement_id: stmt.id,
        guest_name: g.guest_name,
        confirmation_code: g.confirmation_code,
        check_in: g.check_in,
        check_out: g.check_out,
        nights: g.nights || nightsBetween(g.check_in, g.check_out),
        platform,
        guesty_rental_income: guestyRentalIncome,
        stripe_fee: stripeFee,
        adjusted_revenue: adjustedRevenue,
        bank_match_status: 'unmatched',
        bank_deposit_amount: null,
      };
    });

    const { error: insertErr } = await supabase.from('reservations').insert(newRows);
    if (insertErr) throw insertErr;

    // Recompute statement totals from the freshest reservations.
    const { data: allRes } = await supabase
      .from('reservations')
      .select('adjusted_revenue, nights')
      .eq('property_statement_id', stmt.id);
    const newRentalRev = round2((allRes || []).reduce((s, r) => s + (r.adjusted_revenue || 0), 0));
    const newMgmtFee = round2(newRentalRev * (stmt.management_fee_pct / 100));
    const reserveHoldback = Number((stmt as { reserve_holdback?: number }).reserve_holdback ?? 0);
    const newOwnerPayout = round2(
      newRentalRev - newMgmtFee - (stmt.cleaning_total || 0) - (stmt.repairs_total || 0) - reserveHoldback,
    );
    const newNumStays = (allRes || []).filter(r => (r.adjusted_revenue || 0) > 0).length;
    const newNightsBooked = (allRes || []).reduce((s, r) => s + (r.nights || 0), 0);

    await supabase
      .from('property_statements')
      .update({
        rental_revenue: newRentalRev,
        management_fee: newMgmtFee,
        owner_payout: newOwnerPayout,
        num_stays: newNumStays,
        nights_booked: newNightsBooked,
      })
      .eq('id', stmt.id);

    return NextResponse.json({
      success: true,
      added: newRows.map(r => ({
        guest: r.guest_name,
        confirmation_code: r.confirmation_code,
        check_in: r.check_in,
        check_out: r.check_out,
        platform: r.platform,
        adjusted_revenue: r.adjusted_revenue,
      })),
      statement: {
        rental_revenue: newRentalRev,
        management_fee: newMgmtFee,
        owner_payout: newOwnerPayout,
        num_stays: newNumStays,
        nights_booked: newNightsBooked,
      },
    });
  } catch (err) {
    console.error('refresh-statement error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
