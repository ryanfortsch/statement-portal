import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { writeStatementTotals, type FreezeReceipt } from '@/lib/statement-totals-write';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';

/**
 * PATCH /api/property-statements/[id]/reserve
 *
 * Set (or clear) the Owner Reserve holdback on a statement. Amount is
 * subtracted from owner_payout, appears on the editorial PDF as an
 * "Owner Reserve" line item.
 *
 *   body: { amount: number }   // 0 to clear, > 0 to withhold
 *
 * Returns the recomputed owner_payout so the dashboard can refresh
 * immediately. Recomputes from the current property_statements row --
 * no reservation / cleaning / repair re-reads. The reserve is a pure
 * subtraction, so the formula is:
 *
 *   owner_payout_before_reserve = rental_revenue + add_ons_revenue
 *                                 - management_fee - cleaning_total
 *                                 - repairs_total - attributed_debits_total
 *   owner_payout = owner_payout_before_reserve - reserve_holdback
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
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const amountRaw = Number(body.amount);
  if (!Number.isFinite(amountRaw) || amountRaw < 0) {
    return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 });
  }
  const amount = round2(amountRaw);

  const supabase = getSupabase();

  // Sent-statement freeze: the reserve holdback moves owner_payout.
  let finalityGate: FreezeReceipt;
  try {
    finalityGate = await assertStatementWritable(supabase, { statementId: id }, {
      force: body.force === true,
      action: 'Change Owner Reserve holdback',
      detail: `new amount $${amount.toFixed(2)}`,
    });
  } catch (e) {
    if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
    throw e;
  }

  // reserve_holdback is an OWNED term (operator-set, no ledger): it is
  // passed as an override and every other column is recomputed by the
  // single write path from rows, so a stale stored fee or add-on column can
  // no longer ride along under a reserve change.
  const totals = await writeStatementTotals(supabase, id, {
    action: 'Change Owner Reserve holdback',
    reserveHoldback: amount,
    assertedFreeze: finalityGate,
  });
  const ownerPayout = totals.after.owner_payout;
  const beforeReserve = round2(ownerPayout + amount);

  return NextResponse.json({
    ok: true,
    reserve_holdback: amount,
    owner_payout: ownerPayout,
    owner_payout_before_reserve: beforeReserve,
  });
}
