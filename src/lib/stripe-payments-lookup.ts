/**
 * "Has this guest actually paid?" answered from Stripe, per property.
 *
 * Nothing in Helm asked this before. Statements reconcile Stripe AFTER the
 * fact, and Guesty's `totalPaid` is always 0 for a Stay Cape Ann booking
 * because the money never passes through Guesty: the guest pays the
 * property's OWN Stripe account via a payment link. So the only honest
 * answer lived in nineteen separate Stripe dashboards, one per property.
 *
 * On 2026-09-20 that gap cost real trust. An operator was told three times
 * that guests who had in fact paid in full had paid nothing, because the
 * answer was read off Guesty's zero, and a first-look hold was released on
 * the strength of it. This module exists so that question has a single,
 * checkable answer. Figures and names stay out of the source; the incident
 * is recorded in the project notes.
 *
 * STRICTLY READ-ONLY. Every Stripe call here is a GET. Nothing in this file
 * writes to Stripe, Supabase, reservations, statements, or any payout math,
 * and it must stay that way: it is a lookup, not a ledger.
 *
 * Keys come from getStripeKeysMap() (the same three-source merge every other
 * reader uses). A key is never returned, logged, or included in an error.
 */

import { getStripeKeysMap } from '@/lib/stripe-sync';
import {
  DEFAULT_WINDOW_DAYS,
  MAX_PAGES,
  PAGE_SIZE,
  dayEndEpoch,
  dayStartEpoch,
  matchesFilters,
  normalizeCharge,
  resolveWindow,
  type LookupInput,
  type LookupResult,
  type PaymentRow,
  type PropertyLookup,
} from '@/lib/payments-lookup-core';

export type { LookupInput, LookupResult, PaymentRow, PropertyLookup };
export { DEFAULT_WINDOW_DAYS, MAX_PAGES, PAGE_SIZE, matchesFilters, normalizeCharge, resolveWindow };

const STRIPE = 'https://api.stripe.com/v1';
/** Per-request ceiling. A fleet scan runs accounts in parallel, so this
 *  bounds the whole lookup at roughly one slow account, not the sum. */
const REQUEST_TIMEOUT_MS = 15_000;

async function stripeGet(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: true; data: Record<string, any> } | { ok: false; error: string }> {
  const qs = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(`${STRIPE}/${path}?${qs}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      // One unreachable account must never hang the whole lookup.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const message = (err as Error)?.name === 'TimeoutError'
      ? `no response in ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`
      : (err as Error)?.message || 'network error';
    return { ok: false, error: message };
  }
  if (!res.ok) {
    // Stripe names the missing restricted-key permission here, which is
    // exactly what the operator needs. The key itself is never echoed.
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, error: `${res.status} ${body?.error?.message || res.statusText}`.trim() };
  }
  try {
    return { ok: true, data: (await res.json()) as Record<string, any> };
  } catch {
    // A 2xx that is not JSON is still a failure to read this account, and
    // must be reported as one rather than thrown into the caller's face.
    return { ok: false, error: 'unreadable response from Stripe' };
  }
}

/** Every charge in the window for one account, paging until exhausted or
 *  capped. Read-only; returns the error rather than throwing. */
async function listCharges(
  key: string,
  from: string,
  to: string,
): Promise<{ raw: Record<string, any>[]; truncated: boolean; error: string | null }> {
  const raw: Record<string, any>[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      'created[gte]': String(dayStartEpoch(from)),
      'created[lte]': String(dayEndEpoch(to)),
    };
    if (startingAfter) params.starting_after = startingAfter;
    const res = await stripeGet(key, 'charges', params);
    if (!res.ok) return { raw, truncated: false, error: res.error };
    const data = Array.isArray(res.data.data) ? res.data.data : [];
    raw.push(...data);
    if (!res.data.has_more || data.length === 0) {
      return { raw, truncated: false, error: null };
    }
    startingAfter = String(data[data.length - 1]?.id || '');
    if (!startingAfter) return { raw, truncated: false, error: null };
  }
  return { raw, truncated: true, error: null };
}

/**
 * Look up real payments across the configured Stripe accounts.
 *
 * `today` is injected so the default window is deterministic for tests.
 */
export async function lookupPayments(
  input: LookupInput,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<LookupResult> {
  const keys = getStripeKeysMap();
  const window = resolveWindow(input.from, input.to, today);

  const wanted = (input.propertyIds || []).map((p) => p.trim()).filter(Boolean);
  const roster = (input.rosterIds || []).map((p) => p.trim()).filter(Boolean);
  // Deriving the target list FROM the key map makes "unconfigured"
  // structurally impossible to report, which is the exact absence-read-as-fact
  // this module exists to stop. Measure against the roster the caller believes
  // it is searching, and scan the union so a keyed account outside the roster
  // is still read.
  const targets =
    wanted.length > 0
      ? wanted
      : Array.from(new Set([...roster, ...Object.keys(keys)])).sort();
  const unconfigured = targets.filter((p) => !keys[p]);
  const configured = targets.filter((p) => !!keys[p]);

  const properties = await Promise.all(
    configured.map(async (propertyId): Promise<PropertyLookup> => {
      const { raw, truncated, error } = await listCharges(keys[propertyId], window.from, window.to);
      if (error) {
        return { property_id: propertyId, rows: [], scanned: raw.length, truncated, error };
      }
      const rows = raw
        .map((c) => normalizeCharge(propertyId, c))
        .filter((r) => matchesFilters(r, input))
        .sort((a, b) => (a.created < b.created ? 1 : -1));
      return { property_id: propertyId, rows, scanned: raw.length, truncated, error: null };
    }),
  );

  return {
    properties: properties.sort((a, b) => a.property_id.localeCompare(b.property_id)),
    unconfigured,
    searched: configured,
    degraded: properties.some((p) => !!p.error),
    window,
    matched: properties.reduce((n, p) => n + p.rows.length, 0),
  };
}
