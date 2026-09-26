/**
 * One definition per fact, for the two readiness trackers that both test them.
 *
 * A property carries two lists that ask overlapping questions: the 26-step
 * launch checklist (launch-checklist.ts) and the 108-item onboarding catalog
 * (onboarding-catalog.ts). Several facts appear in both, and until now each
 * list hand-rolled its own predicate. They had already drifted:
 *
 *   launch 'bank_last4'                 !!p.bank_last4 && p.bank_last4.length === 4
 *   catalog 'financial.chase_account…'  has(p.bank_last4)
 *
 * So a malformed three-digit bank_last4 resolved the catalog item and not
 * the launch step, and the two lists disagreed about the same column. The
 * strict one is right: bank_last4 keys the statement bank-matching, and a
 * three-digit value matches nothing.
 *
 * This is deliberately NOT a merge of the two lists. They ask different
 * questions at different depths and that split is a product decision, not a
 * bug. What must not differ is what a shared fact MEANS, so both import
 * these and neither restates them.
 */
import type { HelmPropertyRow } from '@/lib/properties';

/** Non-empty after trimming. The ordinary "somebody filled this in" test. */
export const filled = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

/**
 * The bank account's last four, and exactly four.
 *
 * Anything shorter cannot match a Chase deposit, so a partial value is not
 * partial progress; it is a field that still needs doing.
 */
export function hasBankLast4(p: Pick<HelmPropertyRow, 'bank_last4'>): boolean {
  return !!p.bank_last4 && p.bank_last4.trim().length === 4;
}

/** MassTaxConnect room-occupancy certificate id recorded. */
export function hasTaxCert(p: Pick<HelmPropertyRow, 'tax_cert_id'>): boolean {
  return filled(p.tax_cert_id);
}

/** The guest-facing title exists (the "Stay at ..." name, not the internal one). */
export function hasExternalTitle(p: Pick<HelmPropertyRow, 'title'>): boolean {
  return filled(p.title);
}

/**
 * A real Guesty listing id on the row.
 *
 * The legacy `listing_match` substring in lib/properties.ts is a fallback for
 * matching names in a CSV, never evidence that the listing is mapped.
 */
export function hasGuestyListing(p: Pick<HelmPropertyRow, 'guesty_listing_id'>): boolean {
  return filled(p.guesty_listing_id);
}

/**
 * Dynamic pricing is actually reaching the calendar.
 *
 * One distinct forward price means a flat base rate on every night, which is
 * the listing-live-on-defaults state that underpriced 3 Windward's launch.
 * Two or more means real variation is flowing.
 */
export function pricingIsFlowing(forwardDistinctPrices: number): boolean {
  return forwardDistinctPrices >= 2;
}

/** The staycapeann page is published. Says nothing about whether it can take money. */
export function scaIsLive(status: string | null | undefined): boolean {
  return status === 'live';
}

/**
 * The property's own Stripe keys are wired, per the book-probe.
 *
 * Distinct from scaIsLive and never interchangeable with it: a demo-mode
 * listing is live and collects nothing, which is how 84 Thatcher took four
 * bookings worth $41,917 with no payment path.
 */
export function scaPaymentWired(signal: string | null | undefined): boolean {
  return signal === 'wired';
}
