/**
 * A checkout that is not a checkout: the same guest checks back in the
 * same day at the same house.
 *
 * Guesty lets an owner block their own home as a run of one-night
 * reservations under their own name. Simon Prudenzi on 53 Rocky Neck
 * Downstairs, 2026-09-04 to 09-08, is four rows and one stay. Every row
 * ends with a checkout, so the schedule brain listed a cleaning each
 * morning, the cleanings page flagged "nothing booked" each day, and
 * Rosa's digest carried a turnover nobody was doing. Nobody leaves until
 * the LAST row's checkout, and that is the only one the crew needs.
 *
 * The rule: a stay whose effective checkout day has an arrival at the
 * same property on that day under the same REAL guest name is a
 * continuation, and is not listed. Placeholder names ("Reservation",
 * "Blocked") never match: two placeholders in a row could be two
 * different guests, and a redundant cleaning beats a missed one. A
 * different real name on the arrival is a same-day turnover, exactly as
 * before.
 *
 * On live data the rule touched three rows in two months (Aug 1 to Sep 30
 * 2026), all of them that one stay. It is narrow by design.
 *
 * Import-free so `npm test` covers it without a bundler. The guest-name
 * helpers moved here from checkout-schedule.ts unchanged; that module
 * re-imports them.
 */

/** Same placeholder test as the turnover rail (operations.ts guestNameScore):
 *  the first token gives an ical placeholder away. */
export const PLACEHOLDER_FIRST_TOKEN = /^(reservation|tbd|guest|n\/a|hold|blocked|airbnb|vrbo|not)$/i;

/** 0 = empty, 1 = placeholder, 2 = a real guest name. */
export function guestNameScore(name: string | null | undefined): number {
  const t = (name ?? '').trim();
  if (!t) return 0;
  return PLACEHOLDER_FIRST_TOKEN.test(t.split(/\s+/)[0]) ? 1 : 2;
}

/** The name as a human surface shows it: real names only, placeholders blank. */
export function displayGuestName(name: string | null | undefined): string {
  return guestNameScore(name) === 2 ? (name ?? '').trim() : '';
}

/** Case- and whitespace-insensitive identity for a real guest name.
 *  Empty for a placeholder or a blank, so those can never match anything. */
export function guestNameKey(name: string | null | undefined): string {
  return displayGuestName(name).toLowerCase().replace(/\s+/g, ' ');
}

export type ContinuationStay = {
  propertyId: string;
  guestName: string | null | undefined;
  /** The day the stay's checkout falls on after any adjustment. */
  effectiveCheckOut: string;
};

/**
 * True when the same real guest checks back in at the same house on the
 * stay's checkout day. `arrivalGuestNameAt` answers "who arrives at this
 * property on this date", or undefined when nobody does.
 */
export function isContinuation(
  stay: ContinuationStay,
  arrivalGuestNameAt: (propertyId: string, date: string) => string | null | undefined,
): boolean {
  const key = guestNameKey(stay.guestName);
  if (!key) return false;
  const arriving = arrivalGuestNameAt(stay.propertyId, stay.effectiveCheckOut);
  if (arriving === undefined) return false;
  return guestNameKey(arriving) === key;
}
