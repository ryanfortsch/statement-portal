/**
 * One store for house policy.
 *
 * The nine House policy columns on `properties` are the only home for a
 * home's checkout time, pets, quiet hours, max occupancy, cancellation and
 * house rules. Until 2026-10-18 the rate plan (property_rate_plans) and the
 * listing record (property_listing_content) each carried their own copy, with
 * hints pointing at each other, and a new hire could not tell which one the
 * guest AI, the automations or staycapeann.com would read.
 *
 * So the rate plan and the listing record READ these columns: every loader
 * overlays them here, and the forms that edited the duplicates no longer
 * show those fields. The old columns stay in the database for one release
 * (migration 20261018160000_house_policy_one_store.sql backfilled properties
 * from them where properties was blank) and nothing reads them.
 *
 * Check-in is the exception, and it is two values, not one: the GUEST's
 * check-in is the rate plan's `checkin_time` (what a guest is told), and
 * `properties.default_checkin_time` is the CLEANER deadline (when the home
 * must be ready, an hour of margin before the guest). Never swap them.
 *
 * Pure and import-free so node:test loads it directly.
 */

/** The properties columns the overlay reads. */
export const HOUSE_POLICY_COLS =
  'id, default_checkout_time, max_occupancy, pet_policy, quiet_hours, cancellation_policy, house_rules';

export type HousePolicy = {
  id: string;
  default_checkout_time: string | null;
  max_occupancy: number | null;
  pet_policy: string | null;
  quiet_hours: string | null;
  cancellation_policy: string | null;
  house_rules: string | null;
};

/** The defaults a reader falls back to when a home has no value, as before. */
export const DEFAULT_GUEST_CHECKIN = '16:00';
export const DEFAULT_GUEST_CHECKOUT = '11:00';

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/**
 * Loose clock text to "HH:MM" 24h, or null. The edit form takes free text
 * ("10:00 AM", "10am", "16:00"); every reader wants one shape.
 */
export function clockHHMM(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  const mer = m[3]?.replace(/\./g, '');
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/** The hour of a clock value, for a reader that works in whole hours (climate). */
export function clockHour(hhmm: string): number {
  return Number(hhmm.slice(0, 2));
}

/**
 * Whether a pet policy sentence allows pets. The policy is a sentence read
 * to a guest ("two dogs under 40lb, $250 non-refundable"), so only a clear
 * refusal reads as no; anything else written down reads as yes. Blank is no,
 * matching the old rate plan default.
 */
export function petsAllowedBy(policy: string | null | undefined): boolean {
  const t = blank(policy);
  if (!t) return false;
  return !/^(no|none|not allowed)[.!]?$|^no (pets|dogs|cats|animals)\b|\bno pets\b|\bpets? (are |is )?not (allowed|permitted)\b|\bnot pet[- ]friendly\b/i.test(t);
}

/** The rate plan's policy fields, as properties holds them. */
type PlanPolicyFields = {
  checkout_time: string;
  max_occupancy: number | null;
  pets_allowed: boolean;
  quiet_hours: string | null;
  cancellation_policy_key: string;
  cancellation_terms: string | null;
  house_rules: string | null;
};

/**
 * A rate plan as every reader sees it: its own pricing and its guest
 * check-in, with the house policy read from properties. A home with no
 * properties row read (a failed read) keeps the plan as stored, so a read
 * failure never blanks a quote.
 */
export function applyHousePolicy<T extends PlanPolicyFields>(plan: T, policy: HousePolicy | null): T {
  if (!policy) return plan;
  const cancellation = blank(policy.cancellation_policy);
  return {
    ...plan,
    checkout_time: clockHHMM(policy.default_checkout_time) ?? DEFAULT_GUEST_CHECKOUT,
    max_occupancy: policy.max_occupancy ?? null,
    pets_allowed: petsAllowedBy(policy.pet_policy),
    quiet_hours: blank(policy.quiet_hours),
    // The free-text policy is what a guest is told. The key only named one
    // of staycapeann.com's canned wordings, and is no longer edited.
    cancellation_policy_key: cancellation ? 'custom' : plan.cancellation_policy_key,
    cancellation_terms: cancellation,
    house_rules: blank(policy.house_rules),
  };
}

/** The listing record's two policy fields, read from properties the same way. */
export function applyHousePolicyToListing<T extends { house_rules: string | null; accommodates: number | null }>(
  content: T,
  policy: HousePolicy | null,
): T {
  if (!policy) return content;
  return { ...content, house_rules: blank(policy.house_rules), accommodates: policy.max_occupancy ?? null };
}
