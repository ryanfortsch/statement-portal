import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Operator-applied credit on a specific cleaning_event row.
 *
 * PATCH /api/cleaning-events/:id  body { credit_amount, credit_reason }
 *   -> Marks the event as (fully or partially) credited. cleaning_total
 *      drops by the credit amount; the duplicate row stays on file for
 *      audit. credit_amount=0 clears a prior credit. The corresponding
 *      property_statement's cleaning_total + owner_payout recompute.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const creditAmount = Number(body.credit_amount);
  const creditReason = body.credit_reason ? String(body.credit_reason).slice(0, 200) : null;
  if (!Number.isFinite(creditAmount) || creditAmount < 0) {
    return NextResponse.json({ error: 'credit_amount must be a non-negative number' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Load the event so we know which statement to recompute and so we can
  // cap the credit at the original charge amount.
  const { data: event, error: loadErr } = await supabase
    .from('cleaning_events')
    .select('id, amount, property_statement_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!event) return NextResponse.json({ error: 'cleaning_event not found' }, { status: 404 });

  const eventAmount = Number(event.amount) || 0;
  const cappedCredit = round2(Math.min(creditAmount, eventAmount));

  const { error: updErr } = await supabase
    .from('cleaning_events')
    .update({ credit_amount: cappedCredit, credit_reason: creditReason })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Recompute cleaning_total and owner_payout for the parent statement.
  const stmtId = event.property_statement_id as string;
  const { data: stmt } = await supabase
    .from('property_statements')
    .select('id, rental_revenue, add_ons_revenue, management_fee, repairs_total')
    .eq('id', stmtId)
    .maybeSingle();
  if (stmt) {
    const { data: allEvents } = await supabase
      .from('cleaning_events')
      .select('amount, credit_amount')
      .eq('property_statement_id', stmtId);
    const cleaningTotal = round2((allEvents || []).reduce(
      (s, e) => s + (Number(e.amount) || 0) - (Number(e.credit_amount) || 0), 0,
    ));
    const rental = Number(stmt.rental_revenue) || 0;
    const addOns = Number(stmt.add_ons_revenue) || 0;
    const mgmt = Number(stmt.management_fee) || 0;
    const repairs = Number(stmt.repairs_total) || 0;
    const ownerPayout = round2(rental + addOns - mgmt - cleaningTotal - repairs);
    await supabase
      .from('property_statements')
      .update({ cleaning_total: cleaningTotal, owner_payout: ownerPayout })
      .eq('id', stmtId);
    return NextResponse.json({ ok: true, cleaning_total: cleaningTotal, owner_payout: ownerPayout, credit_amount: cappedCredit });
  }
  return NextResponse.json({ ok: true, credit_amount: cappedCredit });
}
