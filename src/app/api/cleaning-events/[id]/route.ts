import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { writeStatementTotals, type FreezeReceipt, type WriteResult } from '@/lib/statement-totals-write';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { familyOfSource, isAutoNettedReason } from '@/lib/cleaning-credit-overrides';
import { CREDIT_OVERRIDES_TABLE } from '@/lib/cleaning-credit-overrides-db';

/**
 * Operator-applied credit on a specific cleaning_event row.
 *
 * PATCH /api/cleaning-events/:id  body { credit_amount, credit_reason }
 *   -> Marks the event as (fully or partially) credited. cleaning_total
 *      drops by the credit amount; the duplicate row stays on file for
 *      audit. credit_amount=0 clears a prior credit. The corresponding
 *      property_statement's cleaning_total + owner_payout recompute.
 *
 * The credit also becomes a durable override row keyed on the charge's
 * bank identity (cleaning_credit_overrides), which is what survives the
 * next rebuild: /api/ingest and /api/fill-gap wipe cleaning_events and
 * re-apply the overrides to the rebuilt charges. The row on the event is
 * the live copy; the override is the one that outlives the wipe.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

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

  // Load the event so we know which statement to recompute, so we can cap
  // the credit at the original charge amount, and so the override row can
  // be keyed on the charge's bank identity.
  const { data: event, error: loadErr } = await supabase
    .from('cleaning_events')
    .select('id, amount, property_statement_id, source, bank_charge_date, credit_amount, credit_reason')
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

  // Keep the durable override in step with the credit just written. Only a
  // bank charge has an identity a rebuild can find again (family, posting
  // date, amount); an invoice-only row is never billed on its own, so a
  // credit on it needs no override. Twins (same identity) may each carry
  // one override, so the count of override rows for an identity tracks
  // the count of hand-credited twins: setting a credit updates the row
  // that matched this event's previous hand credit or adds one; clearing
  // removes that row. An auto-netted credit being edited by hand becomes
  // a hand credit from here on. A failure here is reported, not hidden:
  // the live row is right, but the next rebuild would lose the credit.
  let overrideWarning: string | null = null;
  const family = familyOfSource(event.source as string | null);
  const chargeDate = (event.bank_charge_date as string | null) || null;
  if (family && chargeDate && eventAmount > 0) {
    try {
      const { data: stmt, error: stmtErr } = await supabase
        .from('property_statements')
        .select('property_id, period_id')
        .eq('id', stmtId)
        .maybeSingle();
      if (stmtErr) throw new Error(stmtErr.message);
      if (!stmt) throw new Error('statement not found');
      const { data: period, error: perErr } = await supabase
        .from('statement_periods')
        .select('month')
        .eq('id', stmt.period_id as string)
        .maybeSingle();
      if (perErr) throw new Error(perErr.message);
      if (!period?.month) throw new Error('statement period not found');
      const propertyId = stmt.property_id as string;
      const month = period.month as string;

      const { data: existing, error: exErr } = await supabase
        .from(CREDIT_OVERRIDES_TABLE)
        .select('id, credit_amount, created_at')
        .eq('property_id', propertyId)
        .eq('month', month)
        .eq('family', family)
        .eq('charge_date', chargeDate)
        .gte('charge_amount', eventAmount - EPS)
        .lte('charge_amount', eventAmount + EPS)
        .order('created_at', { ascending: true });
      if (exErr) throw new Error(exErr.message);
      const rows = existing || [];
      const prevCredit = Number(event.credit_amount) || 0;
      const prevWasHand = prevCredit > 0 && !isAutoNettedReason(event.credit_reason as string | null);
      const prevRow = prevWasHand ? rows.find(r => Math.abs(Number(r.credit_amount) - prevCredit) <= EPS) : undefined;
      const who = session.user.email;
      const now = new Date().toISOString();

      if (cappedCredit > 0) {
        if (prevRow) {
          const { error } = await supabase
            .from(CREDIT_OVERRIDES_TABLE)
            .update({ credit_amount: cappedCredit, reason: creditReason, updated_by: who, updated_at: now })
            .eq('id', prevRow.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase
            .from(CREDIT_OVERRIDES_TABLE)
            .insert({
              property_id: propertyId,
              month,
              family,
              charge_date: chargeDate,
              charge_amount: eventAmount,
              credit_amount: cappedCredit,
              reason: creditReason,
              created_by: who,
              updated_by: who,
            });
          if (error) throw new Error(error.message);
        }
      } else {
        // Clearing: remove the row this event's hand credit corresponds
        // to; if that cannot be told apart, the newest one for the identity.
        const target = prevRow ?? (prevWasHand ? rows[rows.length - 1] : undefined);
        if (target) {
          const { error } = await supabase.from(CREDIT_OVERRIDES_TABLE).delete().eq('id', target.id);
          if (error) throw new Error(error.message);
        }
      }
    } catch (e) {
      overrideWarning = `The credit is on the charge, but it could not be saved as a durable override (${e instanceof Error ? e.message : String(e)}). It will be lost on the next re-ingest of this month; apply it again after.`;
      console.warn('cleaning_credit_overrides sync failed:', overrideWarning);
    }
  }

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
    ...(overrideWarning ? { warning: overrideWarning } : {}),
  });
}
