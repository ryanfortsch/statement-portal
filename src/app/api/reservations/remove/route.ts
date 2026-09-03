import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { checkLiveGuestyStatus, isCancelledStatus } from '@/lib/cancel-check';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { writeStatementTotals, type FreezeReceipt, type WriteResult } from '@/lib/statement-totals-write';

/**
 * POST /api/reservations/remove
 *   body: { confirmation_code, property_statement_id }
 *
 * Remove a CANCELLED reservation from a statement and recompute the totals.
 * Backs the "Remove from statement" button on a cancelled_reservation data
 * gap.
 *
 * Safety: re-verifies the reservation is actually cancelled LIVE in Guesty
 * server-side before deleting anything, so a confirmed booking can't be
 * removed by a misclick (or a stale gap). If Guesty doesn't confirm the
 * cancel, it refuses (409) and changes nothing.
 *
 * Recompute mirrors the canonical owner_payout formula (bank-deposits route):
 *   owner_payout = rental + add_ons - mgmt - cleaning - repairs
 *                  - attributed_debits - reserve_holdback
 * num_stays = remaining reservations with revenue > 0 that check out IN the
 * statement month (installment synthetic rows check out later and don't count).
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}


export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const code = String(body.confirmation_code || '').trim();
  const psid = String(body.property_statement_id || '').trim();
  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  if (!psid) return NextResponse.json({ error: 'property_statement_id required' }, { status: 400 });

  const supabase = getSupabase();

  // Count the statement's stays BEFORE the delete: the write path's
  // empty-reservations refusal may only be waived when this removal takes
  // the LAST one. Waiving it unconditionally would let a silently-empty
  // read after removing one stay out of eight zero the whole statement.
  const { count: priorCount, error: countErr } = await supabase
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('property_statement_id', psid);
  if (countErr) return NextResponse.json({ error: `could not count the statement's reservations: ${countErr.message}. Nothing was changed.` }, { status: 502 });
  const removingLastStay = (priorCount ?? 0) <= 1;

  // Sent-statement freeze: removing a reservation recomputes owner_payout.
  let finalityGate: FreezeReceipt;
  try {
    finalityGate = await assertStatementWritable(supabase, { statementId: psid }, {
      force: body.force === true,
      action: 'Remove cancelled reservation',
      detail: `confirmation code ${String(body.confirmation_code || '')}`,
    });
  } catch (e) {
    if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
    throw e;
  }

  const { data: res, error: resErr } = await supabase
    .from('reservations')
    .select('id, guest_name, adjusted_revenue')
    .eq('property_statement_id', psid)
    .eq('confirmation_code', code)
    .maybeSingle();
  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });
  if (!res) return NextResponse.json({ error: 'reservation not found on this statement' }, { status: 404 });

  // Re-verify LIVE before deleting anything. Never remove a booking Guesty
  // doesn't confirm as cancelled.
  const live = await checkLiveGuestyStatus([code]);
  const status = live.get(code);
  if (!isCancelledStatus(status)) {
    return NextResponse.json({
      error: `Guesty status for ${res.guest_name} is "${status || 'unknown/unreachable'}", not cancelled. Refusing to remove -- re-check in Guesty.`,
    }, { status: 409 });
  }

  // Everything the recompute needs that the delete does NOT change: the
  // statement's own fields, its month, and the attributed add-on totals.
  // Read them BEFORE deleting so a failure here refuses cleanly instead of
  // stranding a statement whose reservation is gone but whose totals are stale.
  const { data: stmt } = await supabase
    .from('property_statements')
    .select('period_id, property_id, management_fee_pct, cleaning_total, repairs_total, reserve_holdback')
    .eq('id', psid)
    .single();
  if (!stmt) return NextResponse.json({ error: 'property_statement not found' }, { status: 404 });

  const { data: period } = await supabase
    .from('statement_periods')
    .select('month')
    .eq('id', stmt.period_id)
    .maybeSingle();
  const month = (period?.month as string) || '';
  if (!month) {
    return NextResponse.json(
      { error: 'could not resolve the statement month; refusing to remove and recompute' },
      { status: 500 },
    );
  }

  // addOnsMgmtBase counts only attributions flagged apply_mgmt_fee, so it
  // cannot be read off the stored add_ons_revenue column -- that is what the
  // fee base was missing. Source of truth is bank_deposit_attributions.

  // Delete the reservation, then its gaps (the cancelled_reservation gap +
  // the unmatched_bank gap for this guest/code).
  const { error: delErr } = await supabase.from('reservations').delete().eq('id', res.id);
  if (delErr) return NextResponse.json({ error: `delete failed: ${delErr.message}` }, { status: 500 });
  await supabase
    .from('data_gaps')
    .delete()
    .eq('property_statement_id', psid)
    .or(`expected_data.ilike.%${code}%,description.ilike.%${(res.guest_name || '').replace(/[%,]/g, '')}%`);

  // The single write path recomputes every money column from the remaining
  // rows. The delete above already happened, so a read failure cannot be a
  // clean refusal -- but it is loud (throws) rather than a silent rewrite
  // to zero. This is the ONE caller allowed to assert an empty reservations
  // read: it may have just removed the last stay.
  let totals: WriteResult;
  try {
    totals = await writeStatementTotals(supabase, psid, {
      action: 'Remove cancelled reservation',
      assertedFreeze: finalityGate,
      expectEmptyReservations: removingLastStay,
    });
  } catch (e) {
    // Refresh cannot recompute an emptied statement (the write path refuses
    // an empty read against stored stays, by design); only a re-ingest can.
    return NextResponse.json({
      error: `The reservation was removed, but the statement totals could not be recomputed (${e instanceof Error ? e.message : String(e)}). `
        + (removingLastStay
          ? 'That was the statement\'s last stay; re-ingest the month before sending.'
          : 'Re-run Refresh Statement (or re-ingest the month) before sending: the totals still include the removed stay.'),
    }, { status: 500 });
  }
  const rentalRevenue = totals.after.rental_revenue;
  const managementFee = totals.after.management_fee;
  const ownerPayout = totals.after.owner_payout;
  const numStays = totals.after.num_stays;

  return NextResponse.json({
    ok: true,
    removed: { guest_name: res.guest_name, confirmation_code: code, amount: Number(res.adjusted_revenue) || 0 },
    statement: { rental_revenue: rentalRevenue, management_fee: managementFee, owner_payout: ownerPayout, num_stays: numStays },
  });
}
