import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { checkLiveGuestyStatus, isCancelledStatus } from '@/lib/cancel-check';

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

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const code = String(body.confirmation_code || '').trim();
  const psid = String(body.property_statement_id || '').trim();
  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  if (!psid) return NextResponse.json({ error: 'property_statement_id required' }, { status: 400 });

  const supabase = getSupabase();

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

  // Delete the reservation, then its gaps (the cancelled_reservation gap +
  // the unmatched_bank gap for this guest/code).
  const { error: delErr } = await supabase.from('reservations').delete().eq('id', res.id);
  if (delErr) return NextResponse.json({ error: `delete failed: ${delErr.message}` }, { status: 500 });
  await supabase
    .from('data_gaps')
    .delete()
    .eq('property_statement_id', psid)
    .or(`expected_data.ilike.%${code}%,description.ilike.%${(res.guest_name || '').replace(/[%,]/g, '')}%`);

  // Recompute the statement from the remaining reservations.
  const { data: stmt } = await supabase
    .from('property_statements')
    .select('period_id, management_fee_pct, cleaning_total, repairs_total, reserve_holdback, attributed_debits_total, add_ons_revenue')
    .eq('id', psid)
    .single();
  const { data: period } = stmt
    ? await supabase.from('statement_periods').select('month').eq('id', stmt.period_id).maybeSingle()
    : { data: null };
  const month = (period?.month as string) || '';

  const { data: remaining } = await supabase
    .from('reservations')
    .select('adjusted_revenue, nights, check_out')
    .eq('property_statement_id', psid);
  const rows = remaining || [];

  const rentalRevenue = round2(rows.reduce((s, r) => s + (Number(r.adjusted_revenue) || 0), 0));
  const feePct = (Number(stmt?.management_fee_pct) || 0) / 100;
  const managementFee = round2(rentalRevenue * feePct);
  const addOns = Number(stmt?.add_ons_revenue) || 0;
  const cleaning = Number(stmt?.cleaning_total) || 0;
  const repairs = Number(stmt?.repairs_total) || 0;
  const reserve = Number(stmt?.reserve_holdback) || 0;
  const attributedDebits = Number(stmt?.attributed_debits_total) || 0;
  const ownerPayout = round2(rentalRevenue + addOns - managementFee - cleaning - repairs - reserve - attributedDebits);
  const numStays = rows.filter(r =>
    (Number(r.adjusted_revenue) || 0) > 0 && (r.check_out || '').slice(0, 7) === month,
  ).length;
  const nightsBooked = rows.reduce((s, r) => s + (Number(r.nights) || 0), 0);

  const { error: updErr } = await supabase
    .from('property_statements')
    .update({
      rental_revenue: rentalRevenue,
      management_fee: managementFee,
      owner_payout: ownerPayout,
      num_stays: numStays,
      nights_booked: nightsBooked,
    })
    .eq('id', psid);
  if (updErr) return NextResponse.json({ error: `recompute failed: ${updErr.message}` }, { status: 500 });

  return NextResponse.json({
    ok: true,
    removed: { guest_name: res.guest_name, confirmation_code: code, amount: Number(res.adjusted_revenue) || 0 },
    statement: { rental_revenue: rentalRevenue, management_fee: managementFee, owner_payout: ownerPayout, num_stays: numStays },
  });
}
