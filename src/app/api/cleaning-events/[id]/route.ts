import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { writeStatementTotals, type FreezeReceipt, type WriteResult } from '@/lib/statement-totals-write';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';

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
  const stmtId = event.property_statement_id as string;

  // Sent-statement freeze: a credit changes cleaning_total and owner_payout.
  // Checked BEFORE the credit write -- a declined override must leave zero
  // partial state (a credit persisted on the event with the totals never
  // recomputed would silently fold into the payout on the next recompute).
  let finalityGate: FreezeReceipt;
  try {
    finalityGate = await assertStatementWritable(supabase, { statementId: stmtId }, {
      force: body.force === true,
      action: 'Apply cleaning credit',
    });
  } catch (e) {
    if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
    throw e;
  }

  const { error: updErr } = await supabase
    .from('cleaning_events')
    .update({ credit_amount: cappedCredit, credit_reason: creditReason })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // The single write path derives cleaning_total from the bank-family
  // cleaning_events rows net of credits -- so an invoice-only row (an
  // attribution waiting for its ACH) can no longer be pulled into the bill
  // by applying a credit, which was the audit's #11 critical. Every other
  // term is derived or owned the same way for every writer, and a read
  // failure refuses rather than reporting ok with the credit stranded.
  let totals: WriteResult;
  try {
    totals = await writeStatementTotals(supabase, stmtId, {
      action: 'Apply cleaning credit',
      assertedFreeze: finalityGate,
    });
  } catch (e) {
    return NextResponse.json({
      error: `The credit was saved on the charge, but the statement could not be recomputed (${e instanceof Error ? e.message : String(e)}). `
        + 'Re-run Sync Stripe or Refresh Statement before sending: cleaning_total does not yet reflect this credit.',
    }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    cleaning_total: totals.after.cleaning_total,
    owner_payout: totals.after.owner_payout,
    credit_amount: cappedCredit,
  });
}
