import 'server-only';

import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap } from '@/lib/stripe-sync';
import { addOnIsTaxable, splitAddOnTax, formatTaxRate } from '@/lib/addon-tax';
import { guestyGet } from '@/lib/guesty';
import { sendMessage, quoFromNumber } from '@/lib/quo';
import {
  buildPaymentLinkNudgeSms,
  firstName,
  helmRequestKey,
  LINK_LOOKBACK_DAYS,
  reservationIdFromRequestKey,
  toE164,
} from '@/lib/payment-links-text';

/**
 * Guest payment links: one module for minting, delivering, and watching them.
 *
 * Two doors mint a link, and both end up here:
 *   - the stay-concierge bridge (/api/payment-links), reactive: the AI
 *     detected a fee the host committed to in a reply;
 *   - the Send lens on /messaging/send, proactive: the operator decides to
 *     charge a guest for a late checkout, a pet, an extra night, and types
 *     the amount herself.
 *
 * Every link lives in the property's OWN Stripe account (per-property
 * restricted key from getStripeKeysMap), so the eventual charge lands in the
 * statements extras queue with no extra plumbing: lib/stripe-sync.ts reads
 * the helm_request_key metadata off the charge and routes it there.
 *
 * Paid-detection is a poll, not a webhook: Stripe webhooks would need one
 * endpoint registered per property account, and the accounts are the
 * owners'. checkPaymentLinkPaid asks the account for the link's checkout
 * sessions and stamps paid_at on the payment_link_requests row. It runs
 * from /api/cron/payment-links every 15 minutes and from the bridge's
 * ?status_key= lookup (which the concierge already polls), so a link minted
 * on either side shows up paid on the home feed within a quarter hour.
 *
 * Stripe writes (POST) live only here and in this module's callers on the
 * server; lib/stripe-sync.ts stays read-only by design.
 */

const STRIPE = 'https://api.stripe.com/v1';

export const PAYMENT_LINK_COLUMNS =
  'request_key, property_id, label, guest_name, amount_cents, base_cents, tax_cents, tax_rate, ' +
  'stripe_link_id, url, created_at, save_card, source, reservation_id, conversation_id, guest_phone, ' +
  'sms_body, sent_at, sent_via, created_by, paid_at, paid_session_id, paid_checked_at, ' +
  'paid_check_error, nudged_at, nudge_count, deactivated_at';

export type PaymentLinkRow = {
  request_key: string;
  property_id: string;
  label: string;
  guest_name: string;
  /** What the card is charged (base + tax). */
  amount_cents: number;
  base_cents: number | null;
  tax_cents: number;
  tax_rate: number;
  stripe_link_id: string;
  url: string;
  created_at: string;
  save_card: boolean;
  source: string;
  reservation_id: string;
  conversation_id: string;
  guest_phone: string;
  sms_body: string;
  sent_at: string | null;
  sent_via: string;
  created_by: string;
  paid_at: string | null;
  paid_session_id: string;
  paid_checked_at: string | null;
  paid_check_error: string;
  nudged_at: string | null;
  nudge_count: number;
  deactivated_at: string | null;
};

// ── Stripe REST ────────────────────────────────────────────────────

export async function stripeGetJson(
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

/** Stripe write helper: POSTs are application/x-www-form-urlencoded. */
export async function stripePost(
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

// ── Rows ───────────────────────────────────────────────────────────

export async function loadPaymentLink(requestKey: string): Promise<PaymentLinkRow | null> {
  if (!isServiceConfigured || !requestKey) return null;
  const { data } = await supabase
    .from('payment_link_requests')
    .select(PAYMENT_LINK_COLUMNS)
    .eq('request_key', requestKey)
    .maybeSingle();
  return (data as unknown as PaymentLinkRow | null) ?? null;
}

/** The ledger: every link minted in the window, newest first. Empty on any
 *  failure (pre-migration schema, no service key) so a page never breaks. */
export async function listRecentPaymentLinks(opts?: { days?: number; limit?: number }): Promise<PaymentLinkRow[]> {
  if (!isServiceConfigured) return [];
  const days = opts?.days ?? 30;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const { data, error } = await supabase
      .from('payment_link_requests')
      .select(PAYMENT_LINK_COLUMNS)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 40);
    if (error) return [];
    return (data ?? []) as unknown as PaymentLinkRow[];
  } catch {
    return [];
  }
}

/** Fields the mint only writes for Helm-minted links. Kept out of the bridge
 *  insert so the concierge keeps working the instant this deploys, before the
 *  tracking migration is applied. */
type HelmMintExtras = {
  source: 'helm';
  reservationId: string;
  conversationId: string;
  guestPhone: string;
  createdBy: string;
};

export type MintInput = {
  propertyId: string;
  label: string;
  /** The fee as quoted to the guest, before occupancy tax. */
  amountCents: number;
  guestName: string;
  requestKey: string;
  saveCard?: boolean;
  taxable?: boolean;
  extras?: HelmMintExtras;
};

export type MintResult =
  | {
      ok: true;
      url: string;
      link_id: string;
      deduped: boolean;
      base_cents: number;
      tax_cents: number;
      total_cents: number;
      tax_rate: number;
    }
  | {
      ok: false;
      error: 'no_key' | 'stripe_permission' | 'stripe_error' | 'amount_out_of_range' | 'not_configured';
      detail?: string;
    };

/**
 * Create a Stripe Payment Link in the property's own account and record it.
 * Idempotent on request_key: a retry returns the SAME link, deduped:true,
 * with the split it was minted at, so a retry quotes the guest the same
 * total as the first attempt.
 *
 * Naming contract with lib/stripe-sync.ts (the statements ingest): the
 * product name is "<label> - <guest name> - <external title>". The guest
 * SEES it on the checkout page, so the property segment is the marketing
 * title, never the internal id or street address (policy 2026-08-20).
 * Property identity rides on Stripe METADATA (helm_property_id +
 * helm_request_key on the product, the link, and the eventual charge via
 * payment_intent_data); nothing may parse property from the name text. The
 * name must never begin with "Stay at" (dropped as an SCA principal
 * payment) nor with a Guesty-code-shaped token; the guard below backstops.
 */
export async function mintPaymentLink(input: MintInput): Promise<MintResult> {
  if (!isServiceConfigured) return { ok: false, error: 'not_configured' };
  const propertyId = input.propertyId.trim();
  const label = input.label.trim();
  const guestName = (input.guestName || '').trim();
  const requestKey = input.requestKey.trim();
  const saveCard = input.saveCard === true;
  const amountCents = Math.round(Number(input.amountCents));

  // Sanity bounds: an add-on is a small fee, not a booking - $2,000 catches a
  // mis-extracted amount (e.g. the AI reading a $4,500 stay total as the
  // add-on) before a wrong link ever exists. A save_card booking deposit is a
  // full 50% of a far-future stay, so it gets the same high ceiling the
  // off-session balance charge uses ($100k), still catching a 100x unit slip.
  const maxCents = saveCard ? 10_000_000 : 200_000;
  if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > maxCents) {
    return { ok: false, error: 'amount_out_of_range', detail: `${amountCents} cents` };
  }

  // Replay? Hand back the existing link, with the split it was minted at.
  const { data: existing } = await supabase
    .from('payment_link_requests')
    .select('url, stripe_link_id, amount_cents, base_cents, tax_cents, tax_rate')
    .eq('request_key', requestKey)
    .maybeSingle();
  if (existing?.url) {
    return {
      ok: true,
      url: existing.url,
      link_id: existing.stripe_link_id,
      deduped: true,
      base_cents: existing.base_cents ?? existing.amount_cents,
      tax_cents: existing.tax_cents ?? 0,
      total_cents: existing.amount_cents,
      tax_rate: Number(existing.tax_rate ?? 0),
    };
  }

  const stripeKey = getStripeKeysMap()[propertyId];
  if (!stripeKey) return { ok: false, error: 'no_key' };

  const propertyTitle = await loadPropertyTitle(propertyId);

  // Product name = the statements-facing description. Guard the two prefixes
  // the ingest treats specially (SCA principal / Guesty code shapes).
  let productName = [label, guestName, propertyTitle].filter(Boolean).join(' - ');
  if (/^stay at\b/i.test(productName) || /^(HM|HA-|GY-|BC-)[A-Za-z0-9-]/.test(productName)) {
    productName = `Add-on: ${productName}`;
  }

  // Occupancy tax on top of the quoted fee (2026-08-27): an add-on is rent,
  // so the tax is owed on it. The split goes in the product NAME, which is
  // the line the guest reads on the checkout page (Stripe's price
  // product_data has no description field; sending one 400s the call).
  const taxable = addOnIsTaxable({ requestKey, saveCard, taxable: input.taxable });
  const split = splitAddOnTax({
    propertyId,
    baseCents: amountCents,
    chargeCreatedIso: new Date().toISOString().slice(0, 10),
    taxable,
  });
  const priceParams: Record<string, string> = {
    unit_amount: String(split.totalCents),
    currency: 'usd',
    'product_data[name]': productName.slice(0, 250),
    'product_data[metadata][helm_property_id]': propertyId,
    'product_data[metadata][helm_request_key]': requestKey,
  };
  if (split.taxCents > 0) {
    const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
    const breakdown = `${dollars(split.baseCents)} + ${dollars(split.taxCents)} occupancy tax (${formatTaxRate(split.rate)})`;
    priceParams['product_data[name]'] = `${productName} - ${breakdown}`.slice(0, 250);
    priceParams['product_data[metadata][helm_base_cents]'] = String(split.baseCents);
    priceParams['product_data[metadata][helm_tax_cents]'] = String(split.taxCents);
  }
  const price = await stripePost(stripeKey, 'prices', priceParams);
  if (!price.ok) {
    const permission = price.status === 401 || price.status === 403;
    return { ok: false, error: permission ? 'stripe_permission' : 'stripe_error', detail: price.message };
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
  // customer_creation=always gives the card a Customer to attach to.
  const linkParams: Record<string, string> = {
    'line_items[0][price]': String(price.data.id),
    'line_items[0][quantity]': '1',
    'metadata[helm_request_key]': requestKey,
    'metadata[helm_property_id]': propertyId,
    'payment_intent_data[metadata][helm_request_key]': requestKey,
    'payment_intent_data[metadata][helm_property_id]': propertyId,
  };
  if (split.taxCents > 0) {
    linkParams['metadata[helm_tax_cents]'] = String(split.taxCents);
    linkParams['payment_intent_data[metadata][helm_tax_cents]'] = String(split.taxCents);
    linkParams['payment_intent_data[metadata][helm_base_cents]'] = String(split.baseCents);
  }
  if (saveCard) {
    linkParams['customer_creation'] = 'always';
    linkParams['payment_intent_data[setup_future_usage]'] = 'off_session';
  }
  const link = await stripePost(stripeKey, 'payment_links', linkParams);
  if (!link.ok) {
    const permission = link.status === 401 || link.status === 403;
    return { ok: false, error: permission ? 'stripe_permission' : 'stripe_error', detail: link.message };
  }

  const url = String(link.data.url || '');
  const linkId = String(link.data.id || '');

  // Record for idempotency. A lost race (concurrent identical request) means
  // two live Stripe links exist but only one URL is ever handed out; the
  // orphan is inert. Insert-or-read-winner mirrors work-slips.
  const row: Record<string, unknown> = {
    request_key: requestKey,
    property_id: propertyId,
    label,
    guest_name: guestName,
    // amount_cents stays "what the card is charged", which is what the paid
    // sweep and the balance-charge flow read it as. base/tax carry the split.
    amount_cents: split.totalCents,
    base_cents: split.baseCents,
    tax_cents: split.taxCents,
    tax_rate: split.rate,
    stripe_link_id: linkId,
    url,
    save_card: saveCard,
  };
  if (input.extras) {
    row.source = input.extras.source;
    row.reservation_id = input.extras.reservationId;
    row.conversation_id = input.extras.conversationId;
    row.guest_phone = input.extras.guestPhone;
    row.created_by = input.extras.createdBy;
  }
  const { error: insErr } = await supabase.from('payment_link_requests').insert(row);
  if (insErr && insErr.code === '23505') {
    const { data: winner } = await supabase
      .from('payment_link_requests')
      .select('url, stripe_link_id, amount_cents, base_cents, tax_cents, tax_rate')
      .eq('request_key', requestKey)
      .maybeSingle();
    if (winner?.url) {
      return {
        ok: true,
        url: winner.url,
        link_id: winner.stripe_link_id,
        deduped: true,
        base_cents: winner.base_cents ?? winner.amount_cents,
        tax_cents: winner.tax_cents ?? 0,
        total_cents: winner.amount_cents,
        tax_rate: Number(winner.tax_rate ?? 0),
      };
    }
  } else if (insErr) {
    // The Stripe link exists but Helm lost the record of it. Say so rather
    // than hand out a URL nothing will ever track.
    return { ok: false, error: 'stripe_error', detail: `link minted but not recorded: ${insErr.message}` };
  }

  return {
    ok: true,
    url,
    link_id: linkId,
    deduped: false,
    base_cents: split.baseCents,
    tax_cents: split.taxCents,
    total_cents: split.totalCents,
    tax_rate: split.rate,
  };
}

/** Guest-facing property text = the external marketing title, never the
 *  internal id / street (policy 2026-08-20). '' when there is no title row,
 *  so the caller omits the property rather than leak the address form. */
export async function loadPropertyTitle(propertyId: string): Promise<string> {
  if (!isServiceConfigured || !propertyId) return '';
  const { data } = await supabase.from('properties').select('title').eq('id', propertyId).maybeSingle();
  const t = data?.title ? String(data.title).trim() : '';
  return t;
}

export type LinkProperty = { id: string; name: string; title: string; hasKey: boolean };

/** Every property with its internal name, external title, and whether Helm
 *  holds a Stripe key for it (no key = no link can be minted there). */
export async function loadLinkProperties(): Promise<LinkProperty[]> {
  if (!isServiceConfigured) return [];
  const keys = getStripeKeysMap();
  const { data } = await supabase.from('properties').select('id, name, title').order('name');
  return ((data ?? []) as Array<{ id: string; name: string | null; title: string | null }>).map((p) => ({
    id: p.id,
    name: (p.name || p.id).trim(),
    title: (p.title || '').trim(),
    hasKey: !!keys[p.id],
  }));
}

// ── Paid detection ─────────────────────────────────────────────────

export type PaidCheck =
  | {
      ok: true;
      paid: boolean;
      paid_at: string;
      session_id: string;
      customer_id: string;
      payment_method_id: string;
      sessions_seen: number;
    }
  | { ok: false; error: 'no_key' | 'stripe_error'; detail: string };

/**
 * Ask the property's own Stripe whether anyone completed this link's
 * checkout page. Any session with payment_status 'paid' means the guest
 * paid. For save_card links (far-future deposits) the paid response also
 * carries customer_id + payment_method_id so the balance can be charged
 * off-session later; the one-level payment_intent expand keeps
 * payment_method a plain pm_ id string.
 *
 * Stamps the row (paid_at / paid_checked_at / paid_check_error) as a side
 * effect, swallowing schema errors so the bridge response never changes
 * because a migration is pending.
 */
export async function checkPaymentLinkPaid(row: {
  request_key: string;
  property_id: string;
  stripe_link_id: string;
  paid_at?: string | null;
}): Promise<PaidCheck> {
  const stripeKey = getStripeKeysMap()[row.property_id];
  if (!stripeKey) {
    await stampPaidCheck(row.request_key, { error: 'no Stripe key for this property' });
    return { ok: false, error: 'no_key', detail: 'no Stripe key for this property' };
  }
  let sessions = await stripeGetJson(stripeKey, 'checkout/sessions', {
    payment_link: String(row.stripe_link_id),
    limit: '10',
    'expand[]': 'data.payment_intent',
  });
  if (!sessions) {
    // A restricted key without PaymentIntents READ refuses the expand
    // outright. Paid detection must never depend on the expand: retry
    // plain, and the card ids simply come back ''.
    const errOut: { status?: number; message?: string } = {};
    sessions = await stripeGetJson(
      stripeKey,
      'checkout/sessions',
      { payment_link: String(row.stripe_link_id), limit: '10' },
      errOut,
    );
    if (!sessions) {
      const detail = `${errOut.status ?? ''} ${errOut.message ?? ''}`.trim();
      await stampPaidCheck(row.request_key, { error: detail || 'stripe error' });
      return { ok: false, error: 'stripe_error', detail };
    }
  }
  const list =
    (sessions.data as
      | {
          id?: string;
          payment_status?: string;
          created?: number;
          customer?: string | null;
          payment_intent?: { payment_method?: string | null } | string | null;
        }[]
      | undefined) ?? [];
  const paidSession = list.find((s) => s.payment_status === 'paid');
  const pi = paidSession?.payment_intent;
  const paymentMethodId =
    pi && typeof pi === 'object' && typeof pi.payment_method === 'string' ? pi.payment_method : '';
  const paidAt = paidSession?.created ? new Date(paidSession.created * 1000).toISOString() : '';
  await stampPaidCheck(row.request_key, {
    paid: !!paidSession,
    paidAt: paidAt || (paidSession ? new Date().toISOString() : ''),
    sessionId: paidSession?.id || '',
    alreadyPaid: !!row.paid_at,
  });
  return {
    ok: true,
    paid: !!paidSession,
    paid_at: paidAt,
    session_id: paidSession?.id || '',
    customer_id: typeof paidSession?.customer === 'string' ? paidSession.customer : '',
    payment_method_id: paymentMethodId,
    sessions_seen: list.length,
  };
}

async function stampPaidCheck(
  requestKey: string,
  r: { error: string } | { paid: boolean; paidAt: string; sessionId: string; alreadyPaid: boolean },
): Promise<void> {
  if (!isServiceConfigured || !requestKey) return;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { paid_checked_at: now };
  if ('error' in r) {
    patch.paid_check_error = r.error.slice(0, 500);
  } else {
    patch.paid_check_error = '';
    if (r.paid && !r.alreadyPaid) {
      patch.paid_at = r.paidAt || now;
      patch.paid_session_id = r.sessionId;
    }
  }
  try {
    await supabase.from('payment_link_requests').update(patch).eq('request_key', requestKey);
  } catch {
    // Pre-migration schema or a transient DB error: the caller's answer is
    // still right, it just is not remembered.
  }
}

export type SweepSummary = { checked: number; newly_paid: number; errors: number; no_key: number };

/**
 * The poll behind /api/cron/payment-links: every open link minted in the
 * lookback window, one Stripe read each. Single-digit volume in practice.
 * Older unpaid links are dead deals and stop being polled, matching the
 * concierge's own sweep.
 */
export async function sweepPaymentLinkStatus(opts?: { limit?: number }): Promise<SweepSummary> {
  const out: SweepSummary = { checked: 0, newly_paid: 0, errors: 0, no_key: 0 };
  if (!isServiceConfigured) return out;
  const cutoff = new Date(Date.now() - LINK_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('payment_link_requests')
    .select('request_key, property_id, stripe_link_id, paid_at')
    .is('paid_at', null)
    .is('deactivated_at', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(opts?.limit ?? 100);
  if (error) throw new Error(`payment_link_requests read failed: ${error.message}`);
  for (const row of (data ?? []) as Array<{ request_key: string; property_id: string; stripe_link_id: string; paid_at: string | null }>) {
    if (!row.stripe_link_id) continue;
    out.checked++;
    const r = await checkPaymentLinkPaid(row);
    if (!r.ok) {
      if (r.error === 'no_key') out.no_key++;
      else out.errors++;
      continue;
    }
    if (r.paid) out.newly_paid++;
  }
  return out;
}

// ── Deactivation ───────────────────────────────────────────────────

export type DeactivateResult =
  | { ok: true; deactivated: string }
  | { ok: false; error: 'no_key' | 'bad_link_id' | 'stripe_error' | 'unknown_request_key'; detail?: string };

/** Turn a link off in Stripe by id. Idempotent: an already-inactive link
 *  re-POSTs active=false without error. */
export async function deactivatePaymentLinkById(propertyId: string, linkId: string): Promise<DeactivateResult> {
  const key = getStripeKeysMap()[propertyId];
  if (!key) return { ok: false, error: 'no_key' };
  if (!/^plink_[A-Za-z0-9]+$/.test(linkId)) return { ok: false, error: 'bad_link_id' };
  const res = await stripePost(key, `payment_links/${linkId}`, { active: 'false' });
  if (!res.ok) return { ok: false, error: 'stripe_error', detail: res.message };
  return { ok: true, deactivated: linkId };
}

/** Turn a link off by its request_key and remember that Helm did it. */
export async function deactivatePaymentLink(requestKey: string): Promise<DeactivateResult> {
  const row = await loadPaymentLinkLite(requestKey);
  if (!row?.stripe_link_id) return { ok: false, error: 'unknown_request_key' };
  const res = await deactivatePaymentLinkById(row.property_id, String(row.stripe_link_id));
  if (res.ok) {
    try {
      await supabase
        .from('payment_link_requests')
        .update({ deactivated_at: new Date().toISOString() })
        .eq('request_key', requestKey);
    } catch {
      // Pre-migration schema: the Stripe side is off, which is what matters.
    }
  }
  return res;
}

/** The three columns every status/deactivate path needs, readable on the
 *  pre-migration schema too. */
export async function loadPaymentLinkLite(
  requestKey: string,
): Promise<{ property_id: string; stripe_link_id: string; amount_cents: number } | null> {
  if (!isServiceConfigured || !requestKey) return null;
  const { data } = await supabase
    .from('payment_link_requests')
    .select('property_id, stripe_link_id, amount_cents')
    .eq('request_key', requestKey)
    .maybeSingle();
  return (data as { property_id: string; stripe_link_id: string; amount_cents: number } | null) ?? null;
}

// ── Guest phone ────────────────────────────────────────────────────

type GuestyReservationGuest = {
  guest?: {
    phone?: string | null;
    phones?: Array<string | { number?: string; phone?: string } | null> | null;
    fullName?: string | null;
    firstName?: string | null;
  };
};

/** The guest's real phone from the Guesty reservation, E.164, '' when none
 *  on file. Best-effort: a Guesty hiccup means "no phone", never a throw. */
export async function fetchGuestyGuestPhone(
  reservationId: string,
): Promise<{ phone: string; fullName: string }> {
  if (!reservationId) return { phone: '', fullName: '' };
  try {
    const res = await guestyGet<GuestyReservationGuest>(`/v1/reservations/${encodeURIComponent(reservationId)}`);
    const guest = res?.guest || {};
    const candidates: string[] = [];
    if (guest.phone) candidates.push(String(guest.phone));
    for (const p of guest.phones || []) {
      if (!p) continue;
      if (typeof p === 'string') candidates.push(p);
      else candidates.push(String(p.number || p.phone || ''));
    }
    const phone = candidates.map(toE164).find((p) => !!p) || '';
    return { phone, fullName: String(guest.fullName || '').trim() };
  } catch {
    return { phone: '', fullName: '' };
  }
}

// ── Delivery ───────────────────────────────────────────────────────

/** Text a guest from the GUESTS line. Anything guest-facing sends from
 *  2575 and nothing else (quo-lines.ts). Throws on a Quo failure so the
 *  caller can report it; a link that never reached the guest must be loud. */
export async function sendGuestSms(to: string, body: string): Promise<void> {
  await sendMessage({ from: quoFromNumber('guests'), to, content: body });
}

/** Remember how a Helm-minted link reached the guest. */
export async function recordLinkDelivery(
  requestKey: string,
  a: { via: 'sms' | 'copied'; phone?: string; body?: string },
): Promise<void> {
  if (!isServiceConfigured) return;
  const patch: Record<string, unknown> = { sent_at: new Date().toISOString(), sent_via: a.via };
  if (a.phone) patch.guest_phone = a.phone;
  if (a.body) patch.sms_body = a.body;
  try {
    await supabase.from('payment_link_requests').update(patch).eq('request_key', requestKey);
  } catch {
    // Pre-migration schema; the text went out, which is what matters.
  }
}

export type NudgeResult =
  | { ok: true; to: string }
  | { ok: false; error: 'unknown_request_key' | 'closed' | 'no_phone' | 'send_failed'; detail?: string };

/**
 * Re-text an open link. The phone comes from the row when Helm minted it,
 * otherwise from the Guesty reservation the key was minted against (which
 * is how concierge-minted links get a nudge too). The learned phone is
 * saved back so the next nudge is a single write.
 */
export async function nudgePaymentLink(requestKey: string): Promise<NudgeResult> {
  const row = await loadPaymentLink(requestKey);
  if (!row) return { ok: false, error: 'unknown_request_key' };
  if (row.paid_at || row.deactivated_at) return { ok: false, error: 'closed' };
  let phone = toE164(row.guest_phone);
  let guestName = row.guest_name;
  if (!phone) {
    const resId = row.reservation_id || reservationIdFromRequestKey(row.request_key);
    const g = await fetchGuestyGuestPhone(resId);
    phone = g.phone;
    if (!guestName && g.fullName) guestName = g.fullName;
  }
  if (!phone) return { ok: false, error: 'no_phone' };
  const title = await loadPropertyTitle(row.property_id);
  const body = buildPaymentLinkNudgeSms({
    guestFirst: firstName(guestName),
    label: row.label,
    totalCents: row.amount_cents,
    propertyTitle: title,
    url: row.url,
  });
  try {
    await sendGuestSms(phone, body);
  } catch (e) {
    return { ok: false, error: 'send_failed', detail: e instanceof Error ? e.message : String(e) };
  }
  try {
    await supabase
      .from('payment_link_requests')
      .update({
        nudged_at: new Date().toISOString(),
        nudge_count: (row.nudge_count || 0) + 1,
        guest_phone: phone,
        // A concierge link nudged from Helm is now known to have reached
        // the guest by text.
        ...(row.sent_via ? {} : { sent_via: 'sms', sent_at: row.sent_at || row.created_at }),
      })
      .eq('request_key', requestKey);
  } catch {
    // The text went out; the count is bookkeeping.
  }
  return { ok: true, to: phone };
}

// ── Operator-minted keys ───────────────────────────────────────────

/**
 * The request_key an operator mint should use. Reservation-keyed so a
 * double click lands on the same link; but a stay can legitimately be
 * charged the same thing twice (a second late checkout on a re-extended
 * stay), so a key whose earlier link is already paid or cancelled rolls to
 * a numbered suffix instead of being replayed. An OPEN earlier link is
 * returned as-is: the operator is told she already made it.
 */
export async function pickHelmRequestKey(a: {
  reservationId: string;
  conversationId: string;
  propertyId: string;
  label: string;
  amountCents: number;
}): Promise<{ requestKey: string; existing: PaymentLinkRow | null }> {
  for (let suffix = 1; suffix <= 9; suffix++) {
    const key = helmRequestKey({ ...a, suffix });
    const row = await loadPaymentLink(key);
    if (!row) return { requestKey: key, existing: null };
    if (!row.paid_at && !row.deactivated_at) return { requestKey: key, existing: row };
  }
  // Nine closed links for the same charge on one stay: fall through to a
  // time-stamped key rather than refuse.
  const key = `${helmRequestKey(a)}:${Date.now()}`;
  return { requestKey: key, existing: null };
}

/** property id -> internal name, for ledger and feed rows. */
export async function loadPropertyNameMap(): Promise<Map<string, string>> {
  if (!isServiceConfigured) return new Map();
  try {
    const { data } = await supabase.from('properties').select('id, name');
    return new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, (p.name || p.id).trim()]));
  } catch {
    return new Map();
  }
}
