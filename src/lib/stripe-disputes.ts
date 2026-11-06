/**
 * Disputes across every home's own Stripe account, and whether each
 * account's payment links carry the terms checkbox. STRICTLY READ-ONLY: GETs
 * through stripeGet and Supabase selects. The rules live in
 * stripe-disputes-core.ts.
 *
 * Reading disputes needs Disputes: Read on the home's restricted key. A key
 * without it is reported per home, never treated as "no disputes".
 */

import { getStripeKeysMap } from '@/lib/stripe-sync';
import { stripeGet } from '@/lib/stripe-payments-lookup';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { checkoutTermsState, type CheckoutTermsState, type DisputeListing } from '@/lib/stripe-disputes-core';

/** A loosely typed row from a Supabase or Stripe read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

function isoDay(epoch: unknown): string | null {
  const n = Number(epoch);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : null;
}

/** Disputes opened in the last `days` days on every home with a key. */
export async function loadAllDisputes(days = 120): Promise<{
  disputes: DisputeListing[];
  unread: { propertyId: string; error: string }[];
}> {
  const keys = getStripeKeysMap();
  const since = String(Math.floor(Date.now() / 1000) - days * 86_400);
  const reads = await Promise.all(
    Object.entries(keys).map(async ([propertyId, key]) => ({
      propertyId,
      res: await stripeGet(key, 'disputes', { limit: '100', 'created[gte]': since }),
    })),
  );
  const disputes: DisputeListing[] = [];
  const unread: { propertyId: string; error: string }[] = [];
  const seen = new Set<string>();
  for (const { propertyId, res } of reads) {
    if (!res.ok) {
      unread.push({ propertyId, error: res.error });
      continue;
    }
    for (const d of (Array.isArray(res.data.data) ? res.data.data : []) as DbRow[]) {
      const id = String(d.id || '');
      // Two homes on one Stripe account would list the same dispute twice.
      if (!id || seen.has(id)) continue;
      seen.add(id);
      disputes.push({
        propertyId,
        disputeId: id,
        chargeId: String(typeof d.charge === 'string' ? d.charge : d.charge?.id || ''),
        amountCents: Number(d.amount) || 0,
        reason: typeof d.reason === 'string' ? d.reason : null,
        status: typeof d.status === 'string' ? d.status : null,
        dueBy: isoDay(d.evidence_details?.due_by),
        openedOn: isoDay(d.created),
      });
    }
  }
  return { disputes, unread };
}

/** Payment links carry the terms checkbox from this day (payment-links.ts). */
const SAFEGUARDS_SINCE = '2026-10-20';

export type CheckoutTerms = { propertyId: string; state: CheckoutTermsState; linkCreatedAt: string | null };

/** For each home with a key, whether its newest payment link asks the guest to accept terms. */
export async function loadCheckoutTerms(): Promise<CheckoutTerms[]> {
  const keys = getStripeKeysMap();
  const { data, error } = await supabaseAdmin
    .from('payment_link_requests')
    .select('property_id, stripe_link_id, created_at')
    .gte('created_at', SAFEGUARDS_SINCE)
    .order('created_at', { ascending: false })
    .limit(500);
  const newest = new Map<string, { stripe_link_id: string; created_at: string }>();
  for (const r of (data ?? []) as { property_id: string; stripe_link_id: string; created_at: string }[]) {
    if (r.stripe_link_id && !newest.has(r.property_id)) newest.set(r.property_id, r);
  }
  return Promise.all(
    Object.entries(keys).map(async ([propertyId, key]): Promise<CheckoutTerms> => {
      if (error) return { propertyId, state: 'unread', linkCreatedAt: null };
      const row = newest.get(propertyId);
      if (!row) return { propertyId, state: checkoutTermsState(null, 'none'), linkCreatedAt: null };
      const link = await stripeGet(key, `payment_links/${row.stripe_link_id}`, {});
      return {
        propertyId,
        state: checkoutTermsState(link.ok ? link.data : null, link.ok ? 'ok' : 'failed'),
        linkCreatedAt: row.created_at,
      };
    }),
  );
}
