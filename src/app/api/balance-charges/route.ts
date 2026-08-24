import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';

/**
 * Stay-concierge bridge: register a saved-card balance charge for a
 * far-future direct booking.
 *
 * When a booking deposit paid through a save_card payment link (see
 * /api/payment-links), the guest's card is attached to a Customer in the
 * property's own Stripe account. The concierge's deposit-paid sweep POSTs
 * the balance plan here; the row surfaces on /statements/balance-charges
 * once charge_after arrives, where the operator's one click fires the
 * off-session PaymentIntent. Nothing in this route touches Stripe - it only
 * records the plan.
 *
 * Auth: STAY_CONCIERGE_KEY shared secret, HEADER ONLY
 * (x-stay-concierge-key), same plane as /api/work-slips and matching
 * /api/achieved-rates. No ?key= form: query-string secrets leak through URL
 * logging (the 8/20 rotation was traced to exactly that in httpx).
 * Allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
 *
 *   POST /api/balance-charges     (secret in the x-stay-concierge-key header)
 *   { request_key, property_id, balance_cents, stripe_customer_id,
 *     stripe_payment_method_id, charge_after, guest_name?, guest_email?,
 *     window_start?, window_end?, slip_request_key? }
 *
 * Idempotent on request_key: a replay (sweep re-run after a partial
 * failure) returns the existing row, deduped:true, and never overwrites an
 * operator outcome (charged/failed rows are immutable here).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Payload = {
  request_key?: string;
  property_id?: string;
  guest_name?: string;
  guest_email?: string;
  window_start?: string;
  window_end?: string;
  balance_cents?: number;
  stripe_customer_id?: string;
  stripe_payment_method_id?: string;
  charge_after?: string;
  slip_request_key?: string;
};

export async function POST(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  if (req.headers.get('x-stay-concierge-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const requestKey = (body.request_key ?? '').trim();
  const propertyId = (body.property_id ?? '').trim();
  const customerId = (body.stripe_customer_id ?? '').trim();
  const paymentMethodId = (body.stripe_payment_method_id ?? '').trim();
  const chargeAfter = (body.charge_after ?? '').trim();
  const balanceCents = Math.round(Number(body.balance_cents));
  if (!requestKey || !propertyId || !customerId || !paymentMethodId || !chargeAfter) {
    return NextResponse.json(
      {
        error:
          'request_key, property_id, balance_cents, stripe_customer_id, ' +
          'stripe_payment_method_id, charge_after are required',
      },
      { status: 400 },
    );
  }
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId) || !/^(pm|card)_[A-Za-z0-9]+$/.test(paymentMethodId)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_stripe_ids' },
      { status: 200 },
    );
  }
  if (!DATE_RE.test(chargeAfter)) {
    return NextResponse.json({ error: 'charge_after must be YYYY-MM-DD' }, { status: 400 });
  }
  // The bound of the eventual charge IS this recorded balance - no $2,000
  // link-mint cap here, far-future stays run well past it. The ceiling only
  // catches a unit slip (a 100x cents error reads as $1M+ and is refused).
  if (!Number.isFinite(balanceCents) || balanceCents < 100 || balanceCents > 10_000_000) {
    return NextResponse.json(
      { ok: false, error: 'balance_out_of_range', detail: `${balanceCents} cents` },
      { status: 200 },
    );
  }

  // Same clean-skip as /api/work-slips: an unknown property (slug drift)
  // gets a typed response the caller can escalate, not a raw insert error.
  const { data: prop } = await supabase
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .maybeSingle();
  if (!prop) {
    return NextResponse.json(
      { ok: false, skipped: true, error: `unknown property_id ${propertyId}` },
      { status: 200 },
    );
  }

  // Replay? Hand back the existing row untouched - operator outcomes
  // (charged/failed) must survive a sweep re-run.
  const { data: existing } = await supabase
    .from('balance_charges')
    .select('id, status')
    .eq('request_key', requestKey)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, status: existing.status, deduped: true });
  }

  const insert = await supabase
    .from('balance_charges')
    .insert({
      request_key: requestKey,
      property_id: propertyId,
      guest_name: (body.guest_name ?? '').trim(),
      guest_email: (body.guest_email ?? '').trim(),
      window_start: DATE_RE.test(body.window_start ?? '') ? body.window_start : null,
      window_end: DATE_RE.test(body.window_end ?? '') ? body.window_end : null,
      balance_cents: balanceCents,
      stripe_customer_id: customerId,
      stripe_payment_method_id: paymentMethodId,
      charge_after: chargeAfter,
      slip_request_key: (body.slip_request_key ?? '').trim(),
    })
    .select('id')
    .single();

  if (insert.error) {
    // Unique race: a concurrent replay inserted first - hand back the winner.
    if (insert.error.code === '23505') {
      const { data: winner } = await supabase
        .from('balance_charges')
        .select('id, status')
        .eq('request_key', requestKey)
        .maybeSingle();
      if (winner) {
        return NextResponse.json({ ok: true, id: winner.id, status: winner.status, deduped: true });
      }
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  revalidatePath('/statements/balance-charges');
  return NextResponse.json({ ok: true, id: (insert.data as { id: string }).id, deduped: false });
}
