/**
 * Which calendar facts mean a home is actually HELD on a night, versus
 * Guesty's own availability-rule artifacts that only look like holds.
 *
 * Guesty's advance-notice rule exports TONIGHT as a one-night block on every
 * empty listing that carries the rule, and its booking-window rule exports a
 * multi-year block at the bookable horizon. Neither is a person in the house.
 * The iCal aggregate feed flattens both to "Blocked by Guesty" rows in
 * `bookings` (status='block'); the per-day mirror (`property_calendar_days`,
 * see calendar-days.ts) keeps them apart, because only a deliberate hold gets
 * a block ref stamped onto the day.
 *
 * Two tells, used together:
 *   - the iCal uid of an artifact carries the rule type between the listing
 *     id and the dates: `<listing>_an_2026-09-15_2026-09-15@guesty.com_...`.
 *     A manual block's uid has no tag at all: `<id>@guesty.com_...`.
 *   - the mirror day is `unavailable` with no real block_type.
 *
 * Pure, so the rule is unit-tested (calendar-holds.test.ts). The 8 AM shoot
 * go/no-go text, the shoot page verdict, the shoot brief and the maintenance
 * work-order email all read it through dayClearReport (maintenance-runs.ts).
 * On 2026-09-15 the advance-notice artifact told a creator to hold on an
 * empty 21 Horton; that is the case this module exists to prevent.
 */

/** Guesty block-ref types that represent a deliberate hold on the calendar
 *  (vs an availability-rule artifact). 'm' manual and 'o' owner-portal are
 *  the ones observed in Rising Tide's account; 'sr'/'abl'/'pt' are rare but
 *  deliberate, so they count too. */
export const REAL_HOLD_TYPES: ReadonlySet<string> = new Set(['m', 'o', 'sr', 'abl', 'pt']);

/** Rule artifacts Guesty writes into its calendar and iCal export: advance
 *  notice ('an'), booking window ('bw'/'bd') and the reservation-adjacent
 *  padding types ('b'/'a'). Never a person in the house. */
const RULE_ARTIFACT_TYPES: ReadonlySet<string> = new Set(['an', 'bw', 'bd', 'b', 'a']);

export function isRealHoldType(t: string | null | undefined): boolean {
  return !!t && REAL_HOLD_TYPES.has(t);
}

/** Does this iCal uid belong to one of Guesty's rule artifacts? Only a
 *  recognized artifact tag says yes. An untagged uid, an unknown tag, or no
 *  uid at all reads as a real hold, because the check fails closed: a wrong
 *  "clear" sends a contractor into an occupied house, a wrong "held" costs
 *  one text and a look at the calendar. */
export function isGuestyRuleArtifactUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  const m = /^[0-9a-f]+_([a-z]+)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}@guesty\.com/i.exec(uid);
  return !!m && RULE_ARTIFACT_TYPES.has(m[1].toLowerCase());
}

export type MirrorDayLite = {
  status: string;
  block_type: string | null;
  block_note?: string | null;
};

export type BlockRowLite = { ical_uid: string | null };

/**
 * Is the night actually held? Returns the reason in operator words, or null
 * when nothing deliberate closes it. Either source can hold the night on its
 * own; only the artifacts are discounted:
 *   - a mirror day `unavailable` carrying a real block ref (named, so the
 *     office reads "the owner has the home" rather than a bare "blocked")
 *   - a mirror day in any other non-available state ('booked' is a
 *     reservation the bookings table missed; an unknown state fails closed)
 *   - an iCal block row whose uid is not a rule artifact (a manual block the
 *     mirror may not have synced yet)
 */
export function heldNightReason(
  mirror: MirrorDayLite | null | undefined,
  blockRowsCoveringNight: BlockRowLite[],
): string | null {
  const icalHeld = blockRowsCoveringNight.some((b) => !isGuestyRuleArtifactUid(b.ical_uid));
  if (mirror && mirror.status !== 'available') {
    if (mirror.status !== 'unavailable') return `the Guesty calendar shows the night as ${mirror.status}`;
    if (isRealHoldType(mirror.block_type)) {
      const note = mirror.block_note?.trim();
      const suffix = note ? ` (${note})` : '';
      return mirror.block_type === 'o' ? `the owner has the home that night${suffix}` : `the calendar is blocked that night${suffix}`;
    }
  }
  return icalHeld ? 'the calendar is blocked that night' : null;
}
