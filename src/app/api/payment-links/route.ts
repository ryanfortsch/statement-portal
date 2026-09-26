import { NextResponse } from 'next/server';
import { isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap, perPropertyKeyVars, refusedSecretKeyVars } from '@/lib/stripe-sync';
import {
  checkPaymentLinkPaid,
  deactivatePaymentLink,
  deactivatePaymentLinkById,
  listLinksForReservation,
  listRemindersDue,
  loadPaymentLinkLite,
  mintPaymentLink,
  recordLinkDelivery,
  recordLinkNudge,
  stripeGetJson,
} from '@/lib/payment-links';

/**
 * Stay-concierge bridge: create a Stripe Payment Link for a guest add-on
 * charge (Tesla charger, pet fee, early check-in fee) in the PROPERTY'S OWN
 * Stripe account, so the eventual payment flows through the statements
 * extras queue (bank_deposit_attributions) with zero extra plumbing.
 *
 * The minting, paid-detection and deactivation logic lives in
 * src/lib/payment-links.ts since 2026-09-14, shared with the operator's own
 * proactive links on /messaging/send. This route is the concierge's door to
 * it: auth, request parsing, and the wire shapes below, which are unchanged.
 *
 * Auth: STAY_CONCIERGE_KEY shared secret, HEADER ONLY
 * (x-stay-concierge-key), matching /api/achieved-rates. No ?key= form:
 * query-string secrets leak through URL logging (the 8/20 rotation was
 * traced to exactly that in httpx). Non-secret query params (?status_key=,
 * ?reservation_id=, ?reminders_due=1, ?scopes=1) still ride the query string.
 *
 * POST /api/payment-links     (secret in the x-stay-concierge-key header)
 *   { property_id, label, amount_cents, guest_name?, request_key, save_card?, taxable? }
 *   or { deactivate_link_id, property_id }         (turn one link off)
 *   or { deactivate_request_key }                  (turn off by request_key)
 *
 * save_card is set ONLY by the far-future booking-deposit mints: the link
 * saves the guest's card for the off-session balance charge (see
 * /api/balance-charges). Ordinary add-on links never set it.
 *
 * OCCUPANCY TAX (2026-08-27, Dotti after the July close). `amount_cents` is
 * the fee as QUOTED to the guest; the card is charged that fee PLUS MA room
 * occupancy excise for the property (11.7%, or 14.7% where the Community
 * Impact Fee applies). The response carries base_cents / tax_cents /
 * total_cents / tax_rate so the caller's SMS can state the real number the
 * guest will be charged. Stay principal (save_card, ffdeposit:/ffbalcharge:
 * keys) is NOT grossed up: the Stay Cape Ann quote behind it already
 * includes tax. `taxable: false` opts a non-rent charge out.
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
  if (req.headers.get('x-stay-concierge-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);

  // Links already minted for one stay: ?reservation_id=<guesty id>. The
  // concierge asks before it cards a fee we promised a guest who had not
  // booked yet (fee_promises.py), so a stay the operator already charged by
  // hand is never sent a second link. ok:false means "could not look", which
  // the caller treats as a reason to wait, never as "none".
  const reservationId = searchParams.get('reservation_id');
  if (reservationId !== null) {
    if (!/^[0-9a-f]{24}$/i.test(reservationId)) {
      return NextResponse.json({ ok: false, error: 'bad_reservation_id' }, { status: 200 });
    }
    const links = await listLinksForReservation(reservationId);
    if (!links) return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 200 });
    return NextResponse.json({
      ok: true,
      links: links.map((r) => ({
        request_key: r.request_key,
        label: r.label,
        base_cents: r.base_cents,
        amount_cents: r.amount_cents,
        source: r.source,
        created_at: r.created_at,
        sent_at: r.sent_at,
        paid_at: r.paid_at,
        deactivated_at: r.deactivated_at,
      })),
    });
  }

  // Paid-status lookup for the concierge poller: ?status_key=<request_key>.
  // Resolves the minted link via payment_link_requests, then asks the
  // property's own Stripe for the link's checkout sessions - any session
  // with payment_status 'paid' means the guest completed the page. The
  // answer is also stamped onto the row (paid_at), which is what feeds the
  // Helm ledger and the home-feed "paid" card for concierge-minted links.
  const statusKey = searchParams.get('status_key');
  if (statusKey) {
    if (!isConfigured) {
      return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 200 });
    }
    const row = await loadPaymentLinkLite(statusKey);
    if (!row?.stripe_link_id) {
      return NextResponse.json({ ok: false, error: 'unknown_request_key' }, { status: 200 });
    }
    const r = await checkPaymentLinkPaid({
      request_key: statusKey,
      property_id: row.property_id,
      stripe_link_id: String(row.stripe_link_id),
    });
    if (!r.ok) {
      if (r.error === 'no_key') return NextResponse.json({ ok: false, error: 'no_key' }, { status: 200 });
      return NextResponse.json({ ok: false, error: 'stripe_error', detail: r.detail }, { status: 200 });
    }
    return NextResponse.json({
      ok: true,
      paid: r.paid,
      paid_at: r.paid_at,
      customer_id: r.customer_id,
      payment_method_id: r.payment_method_id,
      sessions_seen: r.sessions_seen,
      // For the reminder cards: a cancelled link, or one somebody already
      // nudged by hand, takes its open reminder off the queue.
      deactivated: !!row.deactivated_at,
      nudge_count: row.nudge_count ?? 0,
    });
  }

  // Unpaid links due a reminder card in the Guests queue: ?reminders_due=1.
  // The concierge files one guest-text card per due reminder (Dotti,
  // 2026-09-26). ok:false means "could not look", never "none due".
  if (searchParams.get('reminders_due')) {
    const reminders = await listRemindersDue();
    if (!reminders) return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 200 });
    return NextResponse.json({ ok: true, reminders });
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
  if (req.headers.get('x-stay-concierge-key') !== expected) {
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
    deactivate_request_key?: string;
    save_card?: boolean;
    taxable?: boolean;
    delivered_request_key?: string;
    delivered_via?: string;
    delivered_phone?: string;
    nudged_request_key?: string;
    nudged_phone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // Delivery mode: the concierge texted a link it minted. Without this the
  // row keeps an empty sent_at forever, and Helm cannot tell a link that
  // reached the guest from one still attached to an unapproved draft. That
  // gap had the feed reporting guests as not having paid for links nobody
  // ever sent them (2026-09-21).
  if (body.delivered_request_key) {
    const key = body.delivered_request_key.trim();
    if (!key) return NextResponse.json({ error: 'delivered_request_key required' }, { status: 400 });
    const via = body.delivered_via === 'copied' ? 'copied' : 'sms';
    await recordLinkDelivery(key, {
      via,
      phone: (body.delivered_phone || '').trim() || undefined,
    });
    return NextResponse.json({ ok: true, recorded: key });
  }

  // Reminder mode: an approved reminder card in the Guests queue texted the
  // guest. Counted exactly like a nudge from Helm, so the next reminder
  // waits its turn and the ledger shows the link was chased.
  if (body.nudged_request_key) {
    const key = body.nudged_request_key.trim();
    if (!key) return NextResponse.json({ error: 'nudged_request_key required' }, { status: 400 });
    const ok = await recordLinkNudge(key, (body.nudged_phone || '').trim());
    return NextResponse.json({ ok, recorded: ok ? key : undefined, error: ok ? undefined : 'unknown_request_key' });
  }

  // Deactivate mode: turn an existing link off (guest can no longer pay it).
  // Used by verification sweeps to leave no litter, and available for a
  // future reject-path cleanup. Requires only property_id + the plink id.
  if (body.deactivate_link_id) {
    const propId = (body.property_id || '').trim();
    const linkId = body.deactivate_link_id.trim();
    if (!getStripeKeysMap()[propId]) return NextResponse.json({ ok: false, error: 'no_key' }, { status: 200 });
    if (!/^plink_[A-Za-z0-9]+$/.test(linkId)) {
      return NextResponse.json({ error: 'invalid link id' }, { status: 400 });
    }
    const res = await deactivatePaymentLinkById(propId, linkId);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: 'stripe_error', detail: res.detail }, { status: 200 });
    }
    return NextResponse.json({ ok: true, deactivated: res.deactivated });
  }

  // Deactivate-by-request_key: the concierge's stale-deposit-link sweep knows
  // only the request_key it minted with, not the plink id. Resolve the link
  // (and its property) from payment_link_requests, then turn it off. Used to
  // retire a never-paid deposit link whose stay window has passed so a guest
  // can't pay a dead booking. Idempotent: an already-inactive link re-POSTs
  // active=false without error.
  if (body.deactivate_request_key) {
    const rk = body.deactivate_request_key.trim();
    const res = await deactivatePaymentLink(rk);
    if (!res.ok) {
      if (res.error === 'stripe_error') {
        return NextResponse.json({ ok: false, error: 'stripe_error', detail: res.detail }, { status: 200 });
      }
      return NextResponse.json({ ok: false, error: res.error }, { status: 200 });
    }
    return NextResponse.json({ ok: true, deactivated: res.deactivated, request_key: rk });
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

  const result = await mintPaymentLink({
    propertyId,
    label,
    amountCents,
    guestName,
    requestKey,
    saveCard: body.save_card === true,
    taxable: body.taxable,
  });
  if (!result.ok) {
    if (result.error === 'not_configured') {
      return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: result.error, detail: result.detail }, { status: 200 });
  }
  return NextResponse.json(result);
}
