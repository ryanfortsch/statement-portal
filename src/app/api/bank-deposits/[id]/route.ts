import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { writeStatementTotals, type FreezeReceipt } from '@/lib/statement-totals-write';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { auth } from '@/auth';

/**
 * Operator review actions on a pending bank_deposit_attributions row.
 *
 * PATCH /api/bank-deposits/:id  body { action: 'attribute', reservation_code, label?, apply_mgmt_fee? }
 *   -> Marks the deposit as add-on revenue against a specific reservation.
 *      Default label = "Add-on", default apply_mgmt_fee = true.
 *      Recomputes the linked property_statement's totals.
 *
 * PATCH /api/bank-deposits/:id  body { action: 'dismiss' }
 *   -> Marks the deposit as not-revenue (refund, transfer, etc).
 *      Silently dismissed -- no statement total change.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}


/**
 * Recompute and persist the statement for the (property_id, month) of the
 * given attribution through the single write path, which reads every
 * attributed row itself (loadAddOnTotals), derives the rest from rows, and
 * FAILS CLOSED. Until this, the read here discarded its error and a
 * transient failure persisted "this statement has no add-ons".
 *
 * Resolution reads fail closed too: an unreadable period or statement is
 * an error, never "no statement". Returns null only when there genuinely
 * is no statement for the month yet.
 */
class RecomputeAfterWriteError extends Error {}

async function recomputeStatementTotals(
  supabase: ReturnType<typeof getSupabase>,
  propertyId: string,
  month: string,
  action: string,
  gate: FreezeReceipt,
): Promise<{ rental_revenue: number; add_ons_revenue: number; attributed_debits_total: number; management_fee: number; owner_payout: number } | null> {
  const { data: period, error: perErr } = await supabase.from('statement_periods').select('id').eq('month', month).maybeSingle();
  if (perErr) throw new Error(`statement_periods read failed: ${perErr.message}`);
  if (!period) return null;
  const { data: stmt, error: stmtErr } = await supabase
    .from('property_statements')
    .select('id')
    .eq('period_id', period.id)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (stmtErr) throw new Error(`property_statements read failed: ${stmtErr.message}`);
  if (!stmt) return null;

  let after;
  try {
    ({ after } = await writeStatementTotals(supabase, stmt.id as string, { action, assertedFreeze: gate }));
  } catch (e) {
    // The attribution row was already flipped by the caller. Say so.
    throw new RecomputeAfterWriteError(
      `The bank row was ${action === 'Attribute bank row' ? 'attributed' : 'returned to pending'}, but the statement could not be recomputed (${e instanceof Error ? e.message : String(e)}). `
      + 'Re-run Sync Stripe or Refresh Statement before sending.',
    );
  }
  return {
    rental_revenue: after.rental_revenue, add_ons_revenue: after.add_ons_revenue,
    attributed_debits_total: after.attributed_debits_total, management_fee: after.management_fee,
    owner_payout: after.owner_payout,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || '').trim();
  if (action !== 'attribute' && action !== 'dismiss' && action !== 'unattribute') {
    return NextResponse.json({ error: "action must be 'attribute', 'dismiss', or 'unattribute'" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Load the attribution to know which (property, month) to recompute.
  // direction tells us whether this is a deposit (credit) or a debit
  // (charge); attribute semantics differ between the two.
  const { data: existing, error: loadErr } = await supabase
    .from('bank_deposit_attributions')
    .select('id, property_id, month, direction, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'deposit not found' }, { status: 404 });
  const direction = (existing.direction || 'deposit') as 'deposit' | 'debit';

  // Sent-statement freeze: attribute and unattribute both recompute the
  // statement's payout. Dismiss of a pending row touches no totals.
  let finalityGate: FreezeReceipt | undefined;
  if (action === 'attribute' || action === 'unattribute') {
    try {
      finalityGate = await assertStatementWritable(supabase, { propertyId: existing.property_id, month: existing.month }, {
        force: body.force === true,
        action: action === 'attribute'
          ? (direction === 'debit' ? 'Attribute bank debit' : 'Attribute bank deposit')
          : 'Un-attribute bank row',
      });
    } catch (e) {
      if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
      throw e;
    }
  }

  if (action === 'dismiss') {
    // An attributed row is inside the payout; dismissing it directly would
    // leave the statement's stored totals stale. Undo first, then dismiss.
    if (existing.status === 'attributed') {
      return NextResponse.json(
        { error: 'This row is attributed and part of the payout. Undo the attribution first, then dismiss.' },
        { status: 400 },
      );
    }
    const { error } = await supabase
      .from('bank_deposit_attributions')
      .update({ status: 'dismissed', attributed_reservation_code: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // No totals recompute -- dismissed rows never affect statement totals.
    return NextResponse.json({ ok: true });
  }

  if (action === 'unattribute') {
    // Move a previously-attributed row back to the pending queue (e.g. the
    // operator picked the wrong reservation -- $200 Airbnb pet fee went to
    // Erin instead of Margaret). Clears the attribution + label, then
    // recomputes so add_ons_revenue / attributed_debits_total drop and
    // owner_payout updates.
    const { error } = await supabase
      .from('bank_deposit_attributions')
      .update({
        status: 'pending',
        attributed_reservation_code: null,
        label: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    try {
      const totals = await recomputeStatementTotals(supabase, existing.property_id, existing.month, 'Un-attribute bank row', finalityGate as FreezeReceipt);
      return NextResponse.json({ ok: true, totals });
    } catch (e) {
      if (e instanceof RecomputeAfterWriteError) return NextResponse.json({ error: e.message }, { status: 500 });
      throw e;
    }
  }

  // action === 'attribute'
  const reservationCode = String(body.reservation_code || '').trim();
  const label = body.label ? String(body.label).trim().slice(0, 80)
    : (direction === 'debit' ? 'Reimbursement' : 'Add-on');
  // apply_mgmt_fee is only meaningful for deposits (debits don't get a
  // mgmt-fee carve-out; they're a straight deduction).
  const applyMgmtFee = body.apply_mgmt_fee === false ? false : true;
  if (direction === 'deposit' && !reservationCode) {
    return NextResponse.json({ error: 'reservation_code required for deposits' }, { status: 400 });
  }
  // Roster check against the LIVE registry, not the code-side PROPERTIES
  // map. That map carries 15 of the 19 active properties, so gating on it
  // meant an add-on charge on 16 Waterman, 36 Granite, 79 Main or 4 Middle
  // was refused outright with "unknown property_id" -- the same way those
  // properties used to fall off the accountant's remittance sheet. Nothing
  // downstream needs the map: recomputeStatementTotals reads the fee
  // percentage off the statement's own snapshot.
  const { data: registryRow } = await supabase
    .from('properties')
    .select('id')
    .eq('id', existing.property_id)
    .maybeSingle();
  if (!registryRow) {
    return NextResponse.json({ error: `unknown property_id ${existing.property_id}` }, { status: 400 });
  }
  const { error: updErr } = await supabase
    .from('bank_deposit_attributions')
    .update({
      status: 'attributed',
      // Debits can optionally be tagged to a reservation, but it's not
      // required (the trash-can reimbursement isn't tied to a specific stay).
      attributed_reservation_code: reservationCode || null,
      label,
      apply_mgmt_fee: applyMgmtFee,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const totals = await recomputeStatementTotals(supabase, existing.property_id, existing.month, 'Attribute bank row', finalityGate as FreezeReceipt);
  return NextResponse.json({ ok: true, totals });
}
