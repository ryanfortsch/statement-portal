import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Resolve a data gap via an inline action -- no file upload, no re-ingest.
 *
 * Currently supported:
 *
 *   paid_off_stripe (for stripe_missing_charge gaps)
 *     The guest paid via check / ACH / wire, not via Stripe. Zero out
 *     the reservation's stripe_fee, roll the deducted amount back into
 *     adjusted_revenue, recompute the statement's rental_revenue +
 *     management_fee + owner_payout, and delete the gap.
 *
 * More resolution types can be added as new switch branches.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Pull the confirmation code out of a gap description like:
//   "No Stripe charge found for Julie Polvinen (GY-3RTGZeYm) expected $3500.00"
function extractConfirmationCode(description: string): string | null {
  const m = description.match(/\(([A-Z]{2}[- ]?[A-Za-z0-9]{4,})\)/);
  return m ? m[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as { gap_id?: string; resolution?: string }));
    const gapId: string = body.gap_id || '';
    const resolution: string = body.resolution || '';

    if (!gapId) return NextResponse.json({ error: 'gap_id is required' }, { status: 400 });
    if (!resolution) return NextResponse.json({ error: 'resolution is required' }, { status: 400 });

    const { data: gap, error: gapErr } = await supabase
      .from('data_gaps')
      .select('*')
      .eq('id', gapId)
      .single();
    if (gapErr || !gap) {
      return NextResponse.json({ error: 'gap not found' }, { status: 404 });
    }

    if (resolution === 'paid_off_stripe') {
      if (gap.gap_type !== 'stripe_missing_charge') {
        return NextResponse.json(
          { error: `resolution 'paid_off_stripe' only applies to stripe_missing_charge gaps (got ${gap.gap_type})` },
          { status: 400 },
        );
      }

      const code = extractConfirmationCode(gap.description || '');
      if (!code) {
        return NextResponse.json({ error: 'Could not extract confirmation code from gap description' }, { status: 400 });
      }

      // Find the reservation this gap refers to.
      const { data: res, error: resErr } = await supabase
        .from('reservations')
        .select('*')
        .eq('property_statement_id', gap.property_statement_id)
        .eq('confirmation_code', code)
        .single();
      if (resErr || !res) {
        return NextResponse.json({ error: `reservation ${code} not found on this statement` }, { status: 404 });
      }

      // Safety: this resolution only makes sense for channels where Rising
      // Tide's Stripe would have been the processor. For Airbnb/Booking we
      // never apply a Stripe fee anyway, so the button shouldn't show up.
      const platformUpper = (res.platform || '').toUpperCase();
      const isRTStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper === 'VRBO' || platformUpper === 'MANUAL';
      if (!isRTStripeChannel) {
        return NextResponse.json(
          { error: `Can't mark off-Stripe on ${res.platform} reservations -- their fees don't go through our Stripe accounts` },
          { status: 400 },
        );
      }

      const prevStripeFee = Number(res.stripe_fee || 0);
      const prevAdjusted = Number(res.adjusted_revenue || 0);
      const newAdjusted = round2(prevAdjusted + prevStripeFee);

      // 1. Zero the reservation's Stripe fee, add the reclaimed amount
      //    back onto adjusted_revenue, flag it so future audits can tell
      //    this wasn't a Stripe-processed stay.
      await supabase
        .from('reservations')
        .update({
          stripe_fee: 0,
          adjusted_revenue: newAdjusted,
          bank_match_status: 'paid_off_stripe',
        })
        .eq('id', res.id);

      // 2. Recompute the property statement's totals from the freshest
      //    reservation numbers. Cleaning + repairs stay as they were.
      const { data: stmt } = await supabase
        .from('property_statements')
        .select('management_fee_pct, cleaning_total, repairs_total')
        .eq('id', gap.property_statement_id)
        .single();
      if (!stmt) {
        return NextResponse.json({ error: 'property_statement not found' }, { status: 500 });
      }
      const { data: allRes } = await supabase
        .from('reservations')
        .select('adjusted_revenue')
        .eq('property_statement_id', gap.property_statement_id);
      const newRentalRev = round2((allRes || []).reduce((s, r) => s + (r.adjusted_revenue || 0), 0));
      const newMgmtFee = round2(newRentalRev * (stmt.management_fee_pct / 100));
      const newOwnerPayout = round2(newRentalRev - newMgmtFee - (stmt.cleaning_total || 0) - (stmt.repairs_total || 0));
      await supabase
        .from('property_statements')
        .update({ rental_revenue: newRentalRev, management_fee: newMgmtFee, owner_payout: newOwnerPayout })
        .eq('id', gap.property_statement_id);

      // 3. Clear the gap.
      await supabase.from('data_gaps').delete().eq('id', gapId);

      return NextResponse.json({
        success: true,
        resolution: 'paid_off_stripe',
        reservation: { guest: res.guest_name, confirmation_code: code, prev_stripe_fee: prevStripeFee, new_adjusted_revenue: newAdjusted },
        statement: { rental_revenue: newRentalRev, management_fee: newMgmtFee, owner_payout: newOwnerPayout },
      });
    }

    return NextResponse.json({ error: `unknown resolution: ${resolution}` }, { status: 400 });
  } catch (err) {
    console.error('resolve-gap error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
