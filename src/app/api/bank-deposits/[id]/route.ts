import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { PROPERTIES } from '@/lib/properties';

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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recompute and persist property_statements totals for the
 * (property_id, month) of the given attribution, folding in all currently
 * attributed add-ons. Returns the new totals so the caller can echo them.
 */
async function recomputeStatementTotals(
  supabase: ReturnType<typeof getSupabase>,
  propertyId: string,
  month: string,
): Promise<{ rental_revenue: number; add_ons_revenue: number; attributed_debits_total: number; management_fee: number; owner_payout: number } | null> {
  // Find the property_statement via period + property.
  const { data: period } = await supabase.from('statement_periods').select('id').eq('month', month).maybeSingle();
  if (!period) return null;
  const { data: stmt } = await supabase
    .from('property_statements')
    .select('id, rental_revenue, cleaning_total, repairs_total, management_fee_pct')
    .eq('period_id', period.id)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (!stmt) return null;

  // Pull every attributed row -- both deposits (credits, feed add_ons_revenue)
  // and debits (charges, feed attributed_debits_total). One query, branch
  // by direction so deposit-flavor and debit-flavor totals stay separate.
  const { data: attrs } = await supabase
    .from('bank_deposit_attributions')
    .select('amount, apply_mgmt_fee, direction')
    .eq('property_id', propertyId)
    .eq('month', month)
    .eq('status', 'attributed');

  let addOnsRevenue = 0;
  let addOnsMgmtBase = 0;
  let attributedDebits = 0;
  for (const a of attrs || []) {
    const amt = Number(a.amount) || 0;
    if ((a.direction || 'deposit') === 'debit') {
      attributedDebits += amt;
    } else {
      addOnsRevenue += amt;
      if (a.apply_mgmt_fee) addOnsMgmtBase += amt;
    }
  }
  addOnsRevenue = round2(addOnsRevenue);
  addOnsMgmtBase = round2(addOnsMgmtBase);
  attributedDebits = round2(attributedDebits);

  const rentalRevenue = Number(stmt.rental_revenue) || 0;
  const cleaning = Number(stmt.cleaning_total) || 0;
  const repairs = Number(stmt.repairs_total) || 0;
  const feePct = (Number(stmt.management_fee_pct) || 0) / 100;
  const feeBase = round2(rentalRevenue + addOnsMgmtBase);
  const managementFee = round2(feeBase * feePct);
  const ownerPayout = round2(rentalRevenue + addOnsRevenue - managementFee - cleaning - repairs - attributedDebits);

  await supabase
    .from('property_statements')
    .update({
      add_ons_revenue: addOnsRevenue,
      attributed_debits_total: attributedDebits,
      management_fee: managementFee,
      owner_payout: ownerPayout,
    })
    .eq('id', stmt.id);

  return { rental_revenue: rentalRevenue, add_ons_revenue: addOnsRevenue, attributed_debits_total: attributedDebits, management_fee: managementFee, owner_payout: ownerPayout };
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
  if (action !== 'attribute' && action !== 'dismiss') {
    return NextResponse.json({ error: "action must be 'attribute' or 'dismiss'" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Load the attribution to know which (property, month) to recompute.
  // direction tells us whether this is a deposit (credit) or a debit
  // (charge); attribute semantics differ between the two.
  const { data: existing, error: loadErr } = await supabase
    .from('bank_deposit_attributions')
    .select('id, property_id, month, direction')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'deposit not found' }, { status: 404 });
  const direction = (existing.direction || 'deposit') as 'deposit' | 'debit';

  if (action === 'dismiss') {
    const { error } = await supabase
      .from('bank_deposit_attributions')
      .update({ status: 'dismissed', attributed_reservation_code: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // No totals recompute -- dismissed rows never affect statement totals.
    return NextResponse.json({ ok: true });
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
  if (!PROPERTIES[existing.property_id]) {
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

  const totals = await recomputeStatementTotals(supabase, existing.property_id, existing.month);
  return NextResponse.json({ ok: true, totals });
}
