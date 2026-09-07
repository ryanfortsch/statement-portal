/**
 * Which Guesty guests the nightly guests sync should actually ask Guesty
 * about. One decision per guest, in words, so the loop in
 * guests-guesty-sync.ts stays a loop.
 *
 * The sync used to fetch every guest of the last two years, ~700 calls,
 * every day, to rediscover ~170 contacts it already had and ~400 guests
 * it already knew carry no email. It outgrew the function and died at the
 * 300s ceiling three days running (2026-09-04 to 06) without recording a
 * thing. The first cut (#1502) skipped known contacts and guests whose
 * last stay was long past; this adds the memory of "asked, no email" so
 * the same 400 are not asked again every morning.
 *
 * Import-free so `npm test` covers the policy without a database.
 */

export type GuestDecision =
  /** Already a contact: merge tags from our own rows, no Guesty call. */
  | 'known'
  /** No contact and no stay inside the recheck window: nothing new to learn. */
  | 'stale'
  /** Asked recently and Guesty had no email for them: ask again later, not today. */
  | 'recently_checked'
  /** Ask Guesty. */
  | 'fetch';

export type GuestFacts = {
  /** The guest already has an audience_contacts row (by guesty_guest_id). */
  known: boolean;
  /** Most recent checkout on file for this guest, YYYY-MM-DD, or null. */
  latestCheckOut: string | null;
  /** When we last asked Guesty and found no email, ISO, or null if never / had email. */
  lastNoEmailCheckAt: string | null;
};

export type GuestPolicy = {
  /** Guests whose last stay ended before this date are not re-fetched. YYYY-MM-DD. */
  recheckCutoff: string;
  /** A "no email" answer older than this is worth asking again. ISO. */
  noEmailRecheckBefore: string;
};

export function decideGuest(facts: GuestFacts, policy: GuestPolicy): GuestDecision {
  if (facts.known) return 'known';
  if ((facts.latestCheckOut ?? '') < policy.recheckCutoff) return 'stale';
  if (facts.lastNoEmailCheckAt && facts.lastNoEmailCheckAt >= policy.noEmailRecheckBefore) return 'recently_checked';
  return 'fetch';
}
