import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { writeStatementTotals, type FreezeReceipt } from '@/lib/statement-totals-write';

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
    const body = await request.json().catch(() => ({} as { gap_id?: string; resolution?: string; force?: boolean }));
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

    let finalityGate: FreezeReceipt | undefined;
    // Sent-statement freeze: resolutions below recompute the payout.
    if (gap.property_statement_id) {
      try {
        finalityGate = await assertStatementWritable(supabase, { statementId: gap.property_statement_id }, {
          force: body.force === true,
          action: `Resolve gap (${resolution})`,
          detail: `gap ${gapId} · ${String(gap.gap_type || '')}`,
        });
      } catch (e) {
        if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
        throw e;
      }
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
        .select('period_id, property_id, management_fee_pct, cleaning_total, repairs_total, reserve_holdback')
        .eq('id', gap.property_statement_id)
        .single();
      if (!stmt) {
        return NextResponse.json({ error: 'property_statement not found' }, { status: 500 });
      }

      // Attributed add-ons / debits stay in the equation (canonical formula,
      // same as refresh-statement + the bank-deposits and reserve routes), so
      // The single write path: month, add-ons and every other input are
      // resolved inside it and it fails closed on any read error, so the
      // month-less-add-on hazard this branch used to guard against cannot
      // recur. The early guard's receipt keeps a forced resolve to one
      // audit row.
      const totals = await writeStatementTotals(supabase, gap.property_statement_id, {
        action: `Resolve gap (${resolution})`,
        assertedFreeze: finalityGate,
      });
      const newRentalRev = totals.after.rental_revenue;
      const newMgmtFee = totals.after.management_fee;
      const newOwnerPayout = totals.after.owner_payout;

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
