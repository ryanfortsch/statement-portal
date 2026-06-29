import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getStripeKeysMap } from '@/lib/stripe-sync';

/**
 * Cross-verify an installment-candidate booking's revenue against the
 * actual Stripe charge.
 *
 * GET /api/installments/verify-source?confirmation_code=GY-...&property_id=3_south_st
 *
 * Returns:
 *   {
 *     guesty: { total_paid, total_taxes, channel_commission, owner_net_revenue_guesty, host_payout, channel },
 *     stripe: { total, charge_id, description, match_method } | null,
 *     stripe_status: 'matched' | 'no_key' | 'wrong_channel' | 'no_match' | 'no_target' | 'error',
 *     stripe_note: string | null,
 *     target: { amount: number, source: 'total_paid' | 'host_payout' | 'none' }
 *   }
 *
 * Two distinct gotchas surfaced and motivate the lookup ordering:
 *
 * 1. The Hancock case: Guesty cached $29,343.60; Dotti updated Guesty
 *    UI to $32,000; Helm's guesty_reservations row hadn't re-synced. The
 *    Stripe charge is the source of truth, not the Guesty cache.
 *
 * 2. The pure SCA case: staycapeann.com bookings have total_paid IS NULL
 *    in Guesty (Guesty never sees the money -- payment routes through
 *    RT's Stripe directly). Without a fallback, the matcher would
 *    require `Math.abs(charge.amount - 0) <= 1` which never matches a
 *    real charge. host_payout is populated by the Guesty API sync and
 *    equals the gross-including-taxes that the guest paid.
 *
 *    IMPORTANT: host_payout already includes taxes. Do NOT add
 *    total_taxes on top -- doing so over-targets by the tax amount and
 *    pushes every SCA booking out of the $1 tolerance band. Confirmed
 *    via the Antebi sample (host_payout 2702.40 = guesty_rental_income
 *    2356.06 + total_taxes 346.34, exact).
 *
 * Lookup ordering:
 *   - total_paid > 0  → use that. Hancock case.
 *   - else host_payout > 0  → use that. Pure SCA case.
 *   - else target.source='none' → skip Stripe call entirely, return a
 *     "no revenue in Guesty" note (likely a homeowner stay).
 *
 * Only attempts the Stripe lookup for Stripe-channel bookings (Direct,
 * Manual, VRBO/HomeAway). Airbnb / Booking.com process payment on their
 * side, not RT's Stripe.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

type StripeCharge = {
  id: string;
  amount: number;
  amount_refunded: number;
  status: string;
  paid: boolean;
  description: string | null;
  created: number;
};

async function stripeGet<T>(key: string, path: string, params: Record<string, string | string[]>): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => q.append(k, item));
    else q.append(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
  }
  return body as T;
}

async function listChargesAroundCheckIn(key: string, checkInIso: string): Promise<StripeCharge[]> {
  const ci = new Date(checkInIso + 'T00:00:00Z').getTime() / 1000;
  const start = Math.floor(ci - 18 * 30 * 86400);
  const end = Math.floor(ci + 6 * 30 * 86400);
  const charges: StripeCharge[] = [];
  let startingAfter: string | undefined;
  for (let i = 0; i < 20; i++) {
    const params: Record<string, string | string[]> = {
      'created[gte]': String(start),
      'created[lt]': String(end),
      limit: '100',
    };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripeGet<{ data: StripeCharge[]; has_more: boolean }>(key, 'charges', params);
    charges.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return charges;
}

/**
 * Find the Stripe charge that paid for this booking.
 *
 * Three passes, escalating risk:
 *   1. Both dates in description AND amount within $5  (high confidence)
 *   2. Both dates in description (any amount)          (signals Guesty staleness)
 *   3. Amount within $1 in 60d before check-in AND
 *      exactly one such candidate                      (strict, last resort)
 *
 * Pass 3 mirrors stripe-sync's amount-based fallback: $1 tolerance
 * (matches src/lib/stripe-sync.ts line 339 ish) and exactly-one-candidate
 * uniqueness guard. Two SCA stays at the same gross would otherwise
 * silently mis-attribute (e.g. a cancel-and-rebook at the same price).
 */
function pickMatchingCharge(
  charges: StripeCharge[],
  checkInIso: string,
  checkOutIso: string,
  targetAmount: number,
): { charge: StripeCharge; method: 'desc+amount' | 'desc' | 'amount' } | null {
  const succeeded = charges.filter(c => (c.status === 'succeeded' || c.paid) && c.amount_refunded < c.amount);
  const targetCents = Math.round(targetAmount * 100);
  const ciDate = checkInIso.slice(0, 10);
  const coDate = checkOutIso.slice(0, 10);

  for (const c of succeeded) {
    const desc = c.description || '';
    if (desc.includes(ciDate) && desc.includes(coDate) && Math.abs(c.amount - targetCents) <= 500) {
      return { charge: c, method: 'desc+amount' };
    }
  }
  for (const c of succeeded) {
    const desc = c.description || '';
    if (desc.includes(ciDate) && desc.includes(coDate)) {
      return { charge: c, method: 'desc' };
    }
  }
  const ciSec = new Date(checkInIso + 'T00:00:00Z').getTime() / 1000;
  const amountCandidates = succeeded.filter(c => {
    if (c.created > ciSec) return false;
    if (ciSec - c.created > 60 * 86400) return false;
    return Math.abs(c.amount - targetCents) <= 100;
  });
  if (amountCandidates.length === 1) {
    return { charge: amountCandidates[0], method: 'amount' };
  }
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const code = (request.nextUrl.searchParams.get('confirmation_code') || '').trim();
  const propertyId = (request.nextUrl.searchParams.get('property_id') || '').trim();
  if (!code) return NextResponse.json({ error: 'confirmation_code required' }, { status: 400 });
  if (!propertyId) return NextResponse.json({ error: 'property_id required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: booking, error: bookingErr } = await supabase
    .from('guesty_reservations')
    .select('confirmation_code, channel, guesty_channel_id, check_in, check_out, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty, host_payout')
    .eq('confirmation_code', code)
    .maybeSingle();
  if (bookingErr) return NextResponse.json({ error: bookingErr.message }, { status: 500 });
  if (!booking) return NextResponse.json({ error: 'booking not found in guesty_reservations' }, { status: 404 });

  const totalPaid = Number(booking.total_paid || 0);
  const hostPayout = Number(booking.host_payout || 0);
  const guesty = {
    channel: booking.channel as string | null,
    total_paid: totalPaid,
    total_taxes: Number(booking.total_taxes || 0),
    channel_commission: Number(booking.channel_commission || 0),
    owner_net_revenue_guesty: Number(booking.owner_net_revenue_guesty || 0),
    host_payout: hostPayout,
  };

  // Pick the matcher target. total_paid wins when populated (covers the
  // Hancock manual-edit case). host_payout is the fallback for SCA
  // bookings that Guesty never saw the money for (total_paid=NULL).
  // host_payout already includes taxes -- don't add them.
  let target: { amount: number; source: 'total_paid' | 'host_payout' | 'none' };
  if (totalPaid > 0) {
    target = { amount: totalPaid, source: 'total_paid' };
  } else if (hostPayout > 0) {
    target = { amount: hostPayout, source: 'host_payout' };
  } else {
    target = { amount: 0, source: 'none' };
  }

  const platform = ((booking.channel as string) || (booking.guesty_channel_id as string) || '').toLowerCase();
  const isStripeChannel = platform.includes('homeaway') || platform === 'vrbo' || platform === 'manual' || platform === 'direct';
  if (!isStripeChannel) {
    return NextResponse.json({
      guesty,
      stripe: null,
      stripe_status: 'wrong_channel',
      stripe_note: `Channel "${booking.channel}" doesn't process payment through Stripe.`,
      target,
    });
  }

  if (target.source === 'none') {
    return NextResponse.json({
      guesty,
      stripe: null,
      stripe_status: 'no_target',
      stripe_note: 'Guesty has $0 revenue on this booking (total_paid and host_payout both empty). Likely a homeowner stay or a row that hasn’t synced yet.',
      target,
    });
  }

  const keys = getStripeKeysMap();
  const restrictedKey = keys[propertyId];
  if (!restrictedKey) {
    return NextResponse.json({
      guesty,
      stripe: null,
      stripe_status: 'no_key',
      stripe_note: `No Stripe restricted key configured for ${propertyId} in STRIPE_KEYS_JSON.`,
      target,
    });
  }

  try {
    const charges = await listChargesAroundCheckIn(restrictedKey, booking.check_in as string);
    const match = pickMatchingCharge(charges, booking.check_in as string, booking.check_out as string, target.amount);
    if (!match) {
      return NextResponse.json({
        guesty,
        stripe: null,
        stripe_status: 'no_match',
        stripe_note: `Searched ${charges.length} Stripe charges around ${booking.check_in}; no charge matched the booking's dates or target amount ($${target.amount.toFixed(2)} via ${target.source}).`,
        target,
      });
    }
    const stripeTotal = match.charge.amount / 100;
    return NextResponse.json({
      guesty,
      stripe: {
        total: stripeTotal,
        charge_id: match.charge.id,
        description: match.charge.description,
        match_method: match.method,
      },
      stripe_status: 'matched',
      stripe_note: null,
      target,
    });
  } catch (err) {
    return NextResponse.json({
      guesty,
      stripe: null,
      stripe_status: 'error',
      stripe_note: err instanceof Error ? err.message : String(err),
      target,
    });
  }
}
