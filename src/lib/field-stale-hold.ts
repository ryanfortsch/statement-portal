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
export type HoldDay = {
  block_type: string | null;
  block_start: string | null;
  block_ref_id: string | null;
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
