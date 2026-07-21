import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap } from '@/lib/stripe-sync';

/**
 * Stay-concierge bridge: create a Stripe Payment Link for a guest add-on
 * charge (Tesla charger, pet fee, early check-in fee) in the PROPERTY'S OWN
 * Stripe account, so the eventual payment flows through the statements
 * extras queue (bank_deposit_attributions) with zero extra plumbing.
 *
 * POST /api/payment-links?key=<STAY_CONCIERGE_KEY>
 *   { property_id, label, amount_cents, guest_name?, request_key }
 *
 * Naming contract with lib/stripe-sync.ts (the statements ingest):
 *   - Product name is "<label> - <guest name> - <property name>". It must
 *     NEVER begin with "Stay at" (dropped as an SCA principal payment) nor
 *     with a Guesty-code-shaped token (HM.../HA-/GY-/BC-). The guest's full
 *     name in the text drives the suggested-reservation preselect; label
 *     keywords (early check-in / late checkout / extra night / pet) drive
 *     the default label chip.
 *   - Payment Link charges often carry no charge.description; the sync
 *     recovers the Checkout Session line-item name, so the Product name IS
 *     the description for queueing purposes.
 *
 * Idempotent on request_key via payment_link_requests: a retry (webhook
 * redelivery, coach regen re-detect) returns the SAME link, deduped:true.
 *
 * Degradation contract (the caller renders these on the card):
 *   - {ok:false, error:'no_key'}: property has no entry in STRIPE_KEYS_JSON
 *     (personal units, not-yet-onboarded properties).
 *   - {ok:false, error:'stripe_permission'}: the property's restricted key
 *     is read-only. Fix: in that property's Stripe dashboard, edit the
 *     restricted key to add WRITE on Payment Links, Products, and Prices,
 *     then update STRIPE_KEYS_JSON in Vercel.
 *   - {ok:false, error:'stripe_error', detail}: anything else from Stripe.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STRIPE = 'https://api.stripe.com/v1';

/** Stripe write helper: POSTs are application/x-www-form-urlencoded. The
 * existing stripeGet in lib/stripe-sync.ts is read-only by design; writes
 * live only here, on the shared-secret plane. */
async function stripePost(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string }> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${STRIPE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data as { error?: { message?: string } }).error;
    return { ok: false, status: res.status, message: err?.message || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

/**
 * Diagnostic: which property ids the RUNTIME key map actually contains, and
 * whether each env var parsed. Ids and booleans only - key values never leave
 * the server. Exists because both vars are Sensitive (write-only) in Vercel,
 * so a bad paste (smart quotes, missing braces) is otherwise undebuggable.
 */
export async function GET(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('key') ?? req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const probe = (name: string) => {
    const raw = process.env[name] || '';
    if (!raw.trim()) return { present: false, parses: false, ids: [] as string[] };
    try {
      const parsed = JSON.parse(raw);
      const ok = !!parsed && typeof parsed === 'object';
      return {
        present: true,
        parses: ok,
        ids: ok ? Object.keys(parsed as Record<string, unknown>) : [],
        length: raw.length,
      };
    } catch {
      return { present: true, parses: false, ids: [] as string[], length: raw.length };
    }
  };
  return NextResponse.json({
    base: probe('STRIPE_KEYS_JSON'),
    extra: probe('STRIPE_KEYS_JSON_EXTRA'),
    merged_ids: Object.keys(getStripeKeysMap()),
  });
}

export async function POST(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('key') ?? req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isConfigured) {
    return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  }

  let body: {
    property_id?: string;
    label?: string;
    amount_cents?: number;
    guest_name?: string;
    request_key?: string;
    deactivate_link_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // Deactivate mode: turn an existing link off (guest can no longer pay it).
  // Used by verification sweeps to leave no litter, and available for a
  // future reject-path cleanup. Requires only property_id + the plink id.
  if (body.deactivate_link_id) {
    const propId = (body.property_id || '').trim();
    const linkId = body.deactivate_link_id.trim();
    const key = getStripeKeysMap()[propId];
    if (!key) return NextResponse.json({ ok: false, error: 'no_key' }, { status: 200 });
    if (!/^plink_[A-Za-z0-9]+$/.test(linkId)) {
      return NextResponse.json({ error: 'invalid link id' }, { status: 400 });
    }
    const res = await stripePost(key, `payment_links/${linkId}`, { active: 'false' });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'stripe_error', detail: res.message },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, deactivated: linkId });
  }

  const propertyId = (body.property_id || '').trim();
  const label = (body.label || '').trim();
  const guestName = (body.guest_name || '').trim();
  const requestKey = (body.request_key || '').trim();
  const amountCents = Math.round(Number(body.amount_cents));
  if (!propertyId || !label || !requestKey || !Number.isFinite(amountCents)) {
    return NextResponse.json(
      { error: 'property_id, label, amount_cents, request_key are required' },
      { status: 400 },
    );
  }
  // Sanity bounds: an add-on is a small fee, not a booking. Catches a
  // mis-extracted amount (e.g. the AI reading a $4,500 stay total as the
  // add-on) before a wrong link ever exists.
  if (amountCents < 100 || amountCents > 200_000) {
    return NextResponse.json(
      { ok: false, error: 'amount_out_of_range', detail: `${amountCents} cents` },
      { status: 200 },
    );
  }

  // Replay? Hand back the existing link.
  const { data: existing } = await supabase
    .from('payment_link_requests')
    .select('url, stripe_link_id')
    .eq('request_key', requestKey)
    .maybeSingle();
  if (existing?.url) {
    return NextResponse.json({ ok: true, url: existing.url, link_id: existing.stripe_link_id, deduped: true });
  }

  const keys = getStripeKeysMap();
  const stripeKey = keys[propertyId];
  if (!stripeKey) {
    return NextResponse.json({ ok: false, error: 'no_key' }, { status: 200 });
  }

  // Product name = the statements-facing description. Guard the two prefixes
  // the ingest treats specially (SCA principal / Guesty code shapes).
  let productName = [label, guestName, propertyId.replace(/_/g, ' ')].filter(Boolean).join(' - ');
  if (/^stay at\b/i.test(productName) || /^(HM|HA-|GY-|BC-)[A-Za-z0-9-]/.test(productName)) {
    productName = `Add-on: ${productName}`;
  }

  const price = await stripePost(stripeKey, 'prices', {
    'unit_amount': String(amountCents),
    'currency': 'usd',
    'product_data[name]': productName.slice(0, 250),
  });
  if (!price.ok) {
    const permission = price.status === 401 || price.status === 403;
    return NextResponse.json(
      { ok: false, error: permission ? 'stripe_permission' : 'stripe_error', detail: price.message },
      { status: 200 },
    );
  }

  const link = await stripePost(stripeKey, 'payment_links', {
    'line_items[0][price]': String(price.data.id),
    'line_items[0][quantity]': '1',
    'metadata[helm_request_key]': requestKey,
    'metadata[helm_property_id]': propertyId,
  });
  if (!link.ok) {
    const permission = link.status === 401 || link.status === 403;
    return NextResponse.json(
      { ok: false, error: permission ? 'stripe_permission' : 'stripe_error', detail: link.message },
      { status: 200 },
    );
  }

  const url = String(link.data.url || '');
  const linkId = String(link.data.id || '');

  // Record for idempotency. A lost race (concurrent identical request) means
  // two live Stripe links exist but only one URL is ever handed out; the
  // orphan is inert. Insert-or-read-winner mirrors work-slips.
  const { error: insErr } = await supabase.from('payment_link_requests').insert({
    request_key: requestKey,
    property_id: propertyId,
    label,
    guest_name: guestName,
    amount_cents: amountCents,
    stripe_link_id: linkId,
    url,
  });
  if (insErr && insErr.code === '23505') {
    const { data: winner } = await supabase
      .from('payment_link_requests')
      .select('url, stripe_link_id')
      .eq('request_key', requestKey)
      .maybeSingle();
    if (winner?.url) {
      return NextResponse.json({ ok: true, url: winner.url, link_id: winner.stripe_link_id, deduped: true });
    }
  }

  return NextResponse.json({ ok: true, url, link_id: linkId, deduped: false });
}
