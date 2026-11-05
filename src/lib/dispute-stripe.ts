/**
 * The disputed charge, read live from the home's own Stripe account for the
 * dispute packet (src/app/payments/disputes). STRICTLY READ-ONLY: every call
 * is a GET through stripeGet, and Helm never submits dispute evidence. The
 * packet is uploaded by a person in the Stripe dashboard.
 *
 * Each read is optional. A restricted key without the disputes or checkout
 * permission still yields the charge; the packet then says what it could not
 * read instead of guessing, and the reason code can be picked by hand.
 */

import { getStripeKeysMap } from '@/lib/stripe-sync';
import { stripeGet } from '@/lib/stripe-payments-lookup';

export type DisputeRefund = { cents: number; date: string | null; note: string | null };

export type DisputeFacts = {
  propertyId: string;
  chargeId: string;
  paymentIntent: string | null;
  amountCents: number;
  currency: string;
  /** YYYY-MM-DD, UTC. */
  chargedOn: string | null;
  description: string | null;
  statementDescriptor: string | null;
  cardholderName: string | null;
  email: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  metadata: Record<string, string>;
  /** helm_request_key on the charge: Helm minted it as an add-on. */
  requestKey: string | null;
  refunds: DisputeRefund[];
  /** The payment page's line item, as the guest saw it. */
  item: string | null;
  paymentLinkId: string | null;
  /** The text the guest read beside Pay (10/20 links onward). */
  approvalText: string | null;
  termsAccepted: boolean | null;
  dispute: {
    id: string;
    reason: string | null;
    networkCode: string | null;
    status: string | null;
    disputedCents: number;
    /** YYYY-MM-DD the evidence is due, from Stripe. */
    dueBy: string | null;
  } | null;
  /** Reads that failed, in plain words, for the packet to show. */
  unread: string[];
};

function isoDay(epoch: unknown): string | null {
  const n = Number(epoch);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : null;
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

export async function loadDisputeFacts(
  propertyId: string,
  chargeId: string,
): Promise<{ ok: true; facts: DisputeFacts } | { ok: false; error: string }> {
  const key = getStripeKeysMap()[propertyId];
  if (!key) return { ok: false, error: 'No Stripe key is set up for this home.' };
  if (!/^(ch|py)_[A-Za-z0-9]+$/.test(chargeId)) return { ok: false, error: 'That is not a Stripe charge id.' };

  const charge = await stripeGet(key, `charges/${chargeId}`, { 'expand[]': 'refunds' });
  if (!charge.ok) return { ok: false, error: `Could not read the charge: ${charge.error}` };
  const c = charge.data;
  const unread: string[] = [];

  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries((c.metadata || {}) as Record<string, unknown>)) {
    if (typeof v === 'string') metadata[k] = v;
  }
  const refundList = Array.isArray(c.refunds?.data) ? c.refunds.data : [];
  const refunds: DisputeRefund[] = refundList
    .filter((r: Record<string, any>) => r?.status !== 'failed' && r?.status !== 'canceled')
    .map((r: Record<string, any>) => ({
      cents: Number(r.amount) || 0,
      date: isoDay(r.created),
      note: str(r.metadata?.note) || str(r.metadata?.reason) || str(r.description),
    }));

  const facts: DisputeFacts = {
    propertyId,
    chargeId,
    paymentIntent: str(c.payment_intent),
    amountCents: Number(c.amount) || 0,
    currency: str(c.currency) || 'usd',
    chargedOn: isoDay(c.created),
    description: str(c.description),
    statementDescriptor: str(c.calculated_statement_descriptor) || str(c.statement_descriptor),
    cardholderName: str(c.billing_details?.name),
    email: str(c.billing_details?.email) || str(c.receipt_email),
    cardLast4: str(c.payment_method_details?.card?.last4),
    cardBrand: str(c.payment_method_details?.card?.brand) || str(c.payment_method_details?.type),
    metadata,
    requestKey: metadata.helm_request_key || null,
    refunds,
    item: null,
    paymentLinkId: null,
    approvalText: null,
    termsAccepted: null,
    dispute: null,
    unread,
  };

  const disputes = await stripeGet(key, 'disputes', { charge: chargeId, limit: '5' });
  if (disputes.ok) {
    const d = (Array.isArray(disputes.data.data) ? disputes.data.data : [])[0];
    if (d) {
      facts.dispute = {
        id: String(d.id),
        reason: str(d.reason),
        networkCode: str(d.network_reason_code) || str(d.payment_method_details?.card?.network_reason_code),
        status: str(d.status),
        disputedCents: Number(d.amount) || 0,
        dueBy: isoDay(d.evidence_details?.due_by),
      };
    }
  } else {
    unread.push(`the dispute itself (${disputes.error})`);
  }

  if (facts.paymentIntent) {
    const sessions = await stripeGet(key, 'checkout/sessions', {
      payment_intent: facts.paymentIntent,
      'expand[]': 'data.line_items',
      limit: '1',
    });
    if (sessions.ok) {
      const s = (Array.isArray(sessions.data.data) ? sessions.data.data : [])[0];
      if (s) {
        facts.item = str(s.line_items?.data?.[0]?.description);
        facts.paymentLinkId = str(s.payment_link);
        facts.approvalText = str(s.custom_text?.submit?.message);
        facts.termsAccepted = s.consent?.terms_of_service === 'accepted' ? true : s.consent_collection ? false : null;
      }
    } else {
      unread.push(`the payment page (${sessions.error})`);
    }
  }

  return { ok: true, facts };
}
