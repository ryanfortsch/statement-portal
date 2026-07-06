import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

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
  const { data: stmt, error: readErr } = await supabase
    .from('property_statements')
    .select('id, rental_revenue, add_ons_revenue, management_fee, cleaning_total, repairs_total, attributed_debits_total')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!stmt) return NextResponse.json({ error: 'statement not found' }, { status: 404 });

  const rental = Number(stmt.rental_revenue) || 0;
  const addOns = Number(stmt.add_ons_revenue) || 0;
  const mgmt = Number(stmt.management_fee) || 0;
  const cleaning = Number(stmt.cleaning_total) || 0;
  const repairs = Number(stmt.repairs_total) || 0;
  const attributedDebits = Number(stmt.attributed_debits_total) || 0;

  const beforeReserve = round2(rental + addOns - mgmt - cleaning - repairs - attributedDebits);
  const ownerPayout = round2(beforeReserve - amount);

  const { error: updErr } = await supabase
    .from('property_statements')
    .update({ reserve_holdback: amount, owner_payout: ownerPayout })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    reserve_holdback: amount,
    owner_payout: ownerPayout,
    owner_payout_before_reserve: beforeReserve,
  });
}
