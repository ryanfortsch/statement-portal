import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap, perPropertyKeyVars, refusedSecretKeyVars } from '@/lib/stripe-sync';

/**
 * Stay-concierge bridge: create a Stripe Payment Link for a guest add-on
 * charge (Tesla charger, pet fee, early check-in fee) in the PROPERTY'S OWN
 * Stripe account, so the eventual payment flows through the statements
 * extras queue (bank_deposit_attributions) with zero extra plumbing.
 *
 * POST /api/payment-links?key=<STAY_CONCIERGE_KEY>
 *   { property_id, label, amount_cents, guest_name?, request_key, save_card? }
 *
 * save_card is set ONLY by the far-future booking-deposit mints: the link
 * saves the guest's card for the off-session balance charge (see the link
 * params below and /api/balance-charges). Ordinary add-on links never set it.
 *
 * Naming contract with lib/stripe-sync.ts (the statements ingest):
 *   - Product name is "<label> - <guest name> - <external title>". The
 *     guest SEES this on the checkout page, so the property segment is the
 *     marketing title (properties.title, "Stay at Rocky Neck"), never the
 *     internal id or street address (policy 2026-08-20: street addresses
 *     never reach a guest before day-before-check-in). Titles collide
 *     across properties (two "Stay at Good Harbor Beach"s), which is fine:
 *     property identity rides on Stripe METADATA (helm_property_id +
 *     helm_request_key, stamped on the product, the link, AND the eventual
 *     PaymentIntent/charge via payment_intent_data), and the sync runs
 *     per-property Stripe account anyway. Nothing may parse property from
 *     the name text.
 *   - The name must NEVER begin with "Stay at" (dropped as an SCA
 *     principal payment) nor with a Guesty-code-shaped token
 *     (HM.../HA-/GY-/BC-); label is required and leads, and the guard
 *     below backstops. The guest's full name drives the
 *     suggested-reservation preselect (metadata-first in the sync, name
 *     text as fallback for pre-metadata links); label keywords (early
 *     check-in / late checkout / extra night / pet) drive the default
 *     label chip.
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

async function stripeGetJson(
  key: string,
  path: string,
  params: Record<string, string>,
  errOut?: { status?: number; message?: string },
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${STRIPE}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    // Surface WHY Stripe refused (restricted-key scope gaps look identical
    // to transient errors otherwise - 17_beach_rd's paid polling was dead
    // for days with nothing but a bare 'stripe_error' to show for it).
    if (errOut) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      errOut.status = res.status;
      errOut.message = data.error?.message || `HTTP ${res.status}`;
    }
    return null;
  }
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

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

  // Paid-status lookup for the concierge poller: ?status_key=<request_key>.
  // Resolves the minted link via payment_link_requests, then asks the
  // property's own Stripe for the link's checkout sessions - any session
  // with payment_status 'paid' means the guest completed the page.
  //
  // For save_card links (far-future booking deposits) the paid response also
  // carries customer_id + payment_method_id: the checkout attached the card
  // to a Customer in the property's own account (setup_future_usage=
  // off_session), and the concierge stores both ids so the January balance
  // can be charged off-session via /api/balance-charges. The one-level
  // payment_intent expand keeps payment_method a plain pm_ id string.
  const statusKey = searchParams.get('status_key');
  if (statusKey) {
    if (!isConfigured) {
      return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 200 });
    }
    const { data: row } = await supabase
      .from('payment_link_requests')
      .select('property_id, stripe_link_id, amount_cents')
      .eq('request_key', statusKey)
      .maybeSingle();
    if (!row?.stripe_link_id) {
      return NextResponse.json({ ok: false, error: 'unknown_request_key' }, { status: 200 });
    }
    const stripeKey = getStripeKeysMap()[row.property_id as string];
    if (!stripeKey) {
      return NextResponse.json({ ok: false, error: 'no_key' }, { status: 200 });
    }
    let sessions = await stripeGetJson(stripeKey, 'checkout/sessions', {
      payment_link: String(row.stripe_link_id),
      limit: '10',
      'expand[]': 'data.payment_intent',
    });
    if (!sessions) {
      // A restricted key without PaymentIntents READ refuses the expand
      // outright. Paid detection must never depend on the expand: retry
      // plain, and the card ids simply come back '' (the concierge then
      // keeps the mint-a-link flow). Fix per property: add PaymentIntents
      // read+write to the restricted key - write is required for the
      // off-session balance charge anyway.
      const errOut: { status?: number; message?: string } = {};
      sessions = await stripeGetJson(
        stripeKey,
        'checkout/sessions',
        { payment_link: String(row.stripe_link_id), limit: '10' },
        errOut,
      );
      if (!sessions) {
        return NextResponse.json(
          {
            ok: false,
            error: 'stripe_error',
            detail: `${errOut.status ?? ''} ${errOut.message ?? ''}`.trim(),
          },
          { status: 200 },
        );
      }
    }
    const list = (sessions.data as {
      payment_status?: string;
      created?: number;
      customer?: string | null;
      payment_intent?: { payment_method?: string | null } | string | null;
    }[] | undefined) ?? [];
    const paidSession = list.find((s) => s.payment_status === 'paid');
    const pi = paidSession?.payment_intent;
    const paymentMethodId =
      pi && typeof pi === 'object' && typeof pi.payment_method === 'string'
        ? pi.payment_method
        : '';
    return NextResponse.json({
      ok: true,
      paid: !!paidSession,
      paid_at: paidSession?.created ? new Date(paidSession.created * 1000).toISOString() : '',
      customer_id: typeof paidSession?.customer === 'string' ? paidSession.customer : '',
      payment_method_id: paymentMethodId,
      sessions_seen: list.length,
    });
  }

  // ?scopes=1: live per-property scope probe. Two READ-ONLY list calls per
  // key (checkout sessions + payment intents, limit 1) - nothing is created
  // or mutated. Answers "which restricted keys can actually run the
  // saved-card flow": sessions read powers paid detection, payment-intents
  // read powers the card-id expand. PaymentIntents WRITE (the off-session
  // balance charge itself) cannot be probed without creating a real object,
  // so it verifies at first charge; a key that fails the read probes
  // certainly lacks it. Stripe's error text names the missing permission
  // and the dashboard URL to fix it.
  if (searchParams.get('scopes')) {
    const keys = getStripeKeysMap();
    const out: Record<string, { checkout_sessions_read: string; payment_intents_read: string }> = {};
    for (const [propId, key] of Object.entries(keys)) {
      const result = { checkout_sessions_read: 'ok', payment_intents_read: 'ok' };
      const sErr: { status?: number; message?: string } = {};
      if (!(await stripeGetJson(key, 'checkout/sessions', { limit: '1' }, sErr))) {
        result.checkout_sessions_read = `${sErr.status ?? ''} ${sErr.message ?? 'error'}`.trim();
      }
      const pErr: { status?: number; message?: string } = {};
      if (!(await stripeGetJson(key, 'payment_intents', { limit: '1' }, pErr))) {
        result.payment_intents_read = `${pErr.status ?? ''} ${pErr.message ?? 'error'}`.trim();
      }
      out[propId] = result;
    }
    return NextResponse.json({ probed: Object.keys(out).length, scopes: out });
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
    // Per-property STRIPE_KEY_<ID> vars - the standard for new properties.
    per_property_ids: Object.keys(perPropertyKeyVars()),
    // sk_ pastes are refused (Helm never holds full-access keys); listing
    // them here makes a wrong-key paste visible instead of silently dead.
    refused_secret_key_ids: refusedSecretKeyVars(),
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
    save_card?: boolean;
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
  const saveCard = body.save_card === true;
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

  // Guest-facing property text = the external marketing title, never the
  // internal id / street (policy 2026-08-20). No title row -> omit the
  // property segment entirely rather than leak the address form.
  let propertyTitle = '';
  const { data: propRow } = await supabase
    .from('properties')
    .select('title')
    .eq('id', propertyId)
    .maybeSingle();
  if (propRow?.title && String(propRow.title).trim()) {
    propertyTitle = String(propRow.title).trim();
  }

  // Product name = the statements-facing description. Guard the two prefixes
  // the ingest treats specially (SCA principal / Guesty code shapes).
  let productName = [label, guestName, propertyTitle].filter(Boolean).join(' - ');
  if (/^stay at\b/i.test(productName) || /^(HM|HA-|GY-|BC-)[A-Za-z0-9-]/.test(productName)) {
    productName = `Add-on: ${productName}`;
  }

  const price = await stripePost(stripeKey, 'prices', {
    'unit_amount': String(amountCents),
    'currency': 'usd',
    'product_data[name]': productName.slice(0, 250),
    'product_data[metadata][helm_property_id]': propertyId,
    'product_data[metadata][helm_request_key]': requestKey,
  });
  if (!price.ok) {
    const permission = price.status === 401 || price.status === 403;
    return NextResponse.json(
      { ok: false, error: permission ? 'stripe_permission' : 'stripe_error', detail: price.message },
      { status: 200 },
    );
  }

  // Link-level metadata identifies the link object itself;
  // payment_intent_data propagates the same keys onto the PaymentIntent and
  // its charge, which is what lib/stripe-sync.ts reads when classifying
  // charges (a helm_request_key on a charge = bridge-minted add-on, routed
  // to the extras queue, never matched as a stay's principal payment).
  //
  // save_card (far-future booking deposits ONLY): setup_future_usage=
  // off_session makes Stripe's checkout page show its card-save
  // authorization and attach the card for later merchant-initiated charges;
  // customer_creation=always gives the card a Customer to attach to in the
  // property's own account (payment links default to no Customer). The paid
  // deposit then carries customer + payment_method ids on the status lookup
  // above, and the January balance charges off-session from
  // /statements/balance-charges - no second link, no guest chasing.
  const linkParams: Record<string, string> = {
    'line_items[0][price]': String(price.data.id),
    'line_items[0][quantity]': '1',
    'metadata[helm_request_key]': requestKey,
    'metadata[helm_property_id]': propertyId,
    'payment_intent_data[metadata][helm_request_key]': requestKey,
    'payment_intent_data[metadata][helm_property_id]': propertyId,
  };
  if (saveCard) {
    linkParams['customer_creation'] = 'always';
    linkParams['payment_intent_data[setup_future_usage]'] = 'off_session';
  }
  const link = await stripePost(stripeKey, 'payment_links', linkParams);
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
    save_card: saveCard,
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
