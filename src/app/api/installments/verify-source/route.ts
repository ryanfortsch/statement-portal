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
 *     guesty: { total_paid, total_taxes, channel_commission, owner_net_revenue_guesty, channel },
 *     stripe: { total: number, charge_id: string, description: string } | null,
 *     stripe_status: 'matched' | 'no_key' | 'wrong_channel' | 'no_match' | 'error',
 *     stripe_note: string | null,
 *   }
 *
 * Helps catch the "Guesty had a glitch one-off adjustment" case Dotti
 * hit with Hancock (Guesty cached $29,343.60; she updated Guesty to
 * $32,000 in their UI; Helm's guesty_reservations row hadn't re-synced).
 * If Stripe disagrees with Guesty, the operator knows to re-sync Guesty
 * before splitting.
 *
 * Only attempts the Stripe lookup for Stripe-channel bookings (Direct,
 * Manual, VRBO/HomeAway). Airbnb / Booking.com process payment on their
 * side, not RT's Stripe, so there's nothing to verify there.
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

/**
 * List succeeded Stripe charges in a window around the booking's check-in
 * date. Wide window because guests can book up to a year ahead. Cap pages
 * at 20 (~2000 charges) -- way more than any single property generates.
 */
async function listChargesAroundCheckIn(key: string, checkInIso: string): Promise<StripeCharge[]> {
  const ci = new Date(checkInIso + 'T00:00:00Z').getTime() / 1000;
  // 18 months before check-in (long lead bookings) through 6 months after
  // (in case the charge processed late, refunds, etc.).
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
 * Find the Stripe charge that paid for this booking. Prefers a charge
 * whose description contains the check-in date string (SCA Payment Link
 * format) and whose amount is within $5 of guesty.total_paid. Falls back
 * to amount-only match (within $5) if the description doesn't contain
 * either date.
 */
function pickMatchingCharge(
  charges: StripeCharge[],
  checkInIso: string,
  checkOutIso: string,
  guestyTotal: number,
): { charge: StripeCharge; method: 'desc+amount' | 'desc' | 'amount' } | null {
  const succeeded = charges.filter(c => (c.status === 'succeeded' || c.paid) && c.amount_refunded < c.amount);
  const targetCents = Math.round(guestyTotal * 100);
  const ciDate = checkInIso.slice(0, 10);
  const coDate = checkOutIso.slice(0, 10);

  // Pass 1: description contains both dates AND amount matches within $5.
  for (const c of succeeded) {
    const desc = c.description || '';
    if (desc.includes(ciDate) && desc.includes(coDate) && Math.abs(c.amount - targetCents) <= 500) {
      return { charge: c, method: 'desc+amount' };
    }
  }
  // Pass 2: description contains BOTH dates -- the canonical SCA Payment
  // Link format -- even if amount differs (which is exactly the "Guesty
  // glitch" signal we want to surface).
  for (const c of succeeded) {
    const desc = c.description || '';
    if (desc.includes(ciDate) && desc.includes(coDate)) {
      return { charge: c, method: 'desc' };
    }
  }
  // Pass 3: amount-only match within $5, in a tight window around check-in
  // (60 days before). Risky if the property has two same-amount stays,
  // so only used as a last resort.
  const ciSec = new Date(checkInIso + 'T00:00:00Z').getTime() / 1000;
  for (const c of succeeded) {
    if (c.created > ciSec) continue;
    if (ciSec - c.created > 60 * 86400) continue;
    if (Math.abs(c.amount - targetCents) <= 500) {
      return { charge: c, method: 'amount' };
    }
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
    .select('confirmation_code, channel, guesty_channel_id, check_in, check_out, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty')
    .eq('confirmation_code', code)
    .maybeSingle();
  if (bookingErr) return NextResponse.json({ error: bookingErr.message }, { status: 500 });
  if (!booking) return NextResponse.json({ error: 'booking not found in guesty_reservations' }, { status: 404 });

  const guesty = {
    channel: booking.channel as string | null,
    total_paid: Number(booking.total_paid || 0),
    total_taxes: Number(booking.total_taxes || 0),
    channel_commission: Number(booking.channel_commission || 0),
    owner_net_revenue_guesty: Number(booking.owner_net_revenue_guesty || 0),
  };

  // Only Stripe channels have a Stripe charge to verify against.
  const platform = ((booking.channel as string) || (booking.guesty_channel_id as string) || '').toLowerCase();
  const isStripeChannel = platform.includes('homeaway') || platform === 'vrbo' || platform === 'manual' || platform === 'direct';
  if (!isStripeChannel) {
    return NextResponse.json({
      guesty,
      stripe: null,
      stripe_status: 'wrong_channel',
      stripe_note: `Channel "${booking.channel}" doesn't process payment through Stripe.`,
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
    });
  }

  try {
    const charges = await listChargesAroundCheckIn(restrictedKey, booking.check_in as string);
    const match = pickMatchingCharge(charges, booking.check_in as string, booking.check_out as string, guesty.total_paid);
    if (!match) {
      return NextResponse.json({
        guesty,
        stripe: null,
        stripe_status: 'no_match',
        stripe_note: `Searched ${charges.length} Stripe charges around ${booking.check_in}; no charge matched the booking's dates or amount.`,
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
    });
  } catch (err) {
    return NextResponse.json({
      guesty,
      stripe: null,
      stripe_status: 'error',
      stripe_note: err instanceof Error ? err.message : String(err),
    });
  }
}
