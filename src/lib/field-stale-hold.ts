/**
 * Does a Guesty calendar hold make a home OCCUPIED during a visit day?
 *
 * Pure, so the rule is testable without a database. The packet staleness
 * check (stopPresence in field-packets.ts) used to treat ANY owner hold on
 * the visit date as "someone is in the house all day".
 * Guesty writes an owner stay (and a manual block) as a hold that BEGINS on
 * the arrival date, so the pre-arrival inspection for an owner's own visit
 * was exactly the stop that got deleted, silently, at publish and again at
 * claim (19 Rackliffe 2026-09-07, 53 Rocky Neck 2026-09-08).
 *
 * The rule now mirrors the booking test: a hold that begins on the visit
 * day is an arrival, and the morning before it is the visit window. Only a
 * hold that began EARLIER and still covers the day means the house is
 * occupied. A mirror row with no start date (an older sync) falls back to
 * "did the same hold cover the night before".
 */
import { isOwnerNight } from './owner-hold-checkouts.ts';

export type HoldDay = {
  block_type: string | null;
  block_start: string | null;
  block_ref_id: string | null;
};

/** A mirror row with the two columns that say WHOSE hold it is. */
export type HoldDayRow = HoldDay & {
  block_reason?: string | null;
  block_note?: string | null;
};

export function holdOccupiesDay(
  visitDate: string,
  day: HoldDay | null | undefined,
  dayBefore: HoldDay | null | undefined,
): boolean {
  if (!day?.block_type) return false;
  if (day.block_start) return day.block_start < visitDate;
  if (!dayBefore?.block_type) return false;
  // No start on the row: mid-hold only if the previous night carried the
  // same hold (or neither row can say which hold it was).
  return dayBefore.block_ref_id == null || day.block_ref_id == null || dayBefore.block_ref_id === day.block_ref_id;
}

/**
 * The owner-only version of holdOccupiesDay, for stopPresence.
 *
 * stopPresence used to fetch rows with `block_type = 'o'` and feed them
 * straight in. Verified on the live mirror on 2026-10-08: an owner stay the
 * OFFICE enters in Guesty arrives as type 'm' with block_reason 'Owner
 * block' and a note like "Owner use"; only an owner-portal block is 'o'.
 * So the old filter missed nearly every owner stay. The shared predicate
 * (isOwnerNight, from the cleaner schedule's owner-checkout work, #1762)
 * decides per row here instead, and a row that is not the owner's is
 * treated as no hold at all: an office or manual non-owner hold still
 * reports nothing, exactly as before (Dotti, 2026-09-07).
 */
export function ownerHoldOccupiesDay(
  visitDate: string,
  day: HoldDayRow | null | undefined,
  dayBefore: HoldDayRow | null | undefined,
): boolean {
  const ownerOnly = (row: HoldDayRow | null | undefined): HoldDayRow | null =>
    row && isOwnerNight(row) ? row : null;
  return holdOccupiesDay(visitDate, ownerOnly(day), ownerOnly(dayBefore));
}
